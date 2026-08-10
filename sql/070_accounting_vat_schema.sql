-- Accounting VAT Schema (V1 plan 1.6, step 1/3)
-- Run in Supabase SQL editor.
--
-- Accounting-owned tax configuration schema (per docs/ACCOUNTING_DATA_MODEL.md
-- §3.10 "VAT objects" and docs/ACCOUNTING.md §16 "VAT-Ready Design" — "No
-- parallel Finance or Taxes module. VAT and taxes live inside Accounting.").
--
-- Mirrors the existing country-agnostic TS contracts in
-- src/types/tax-engine.ts (TaxJurisdiction / TaxCategory / TaxType /
-- TaxDefinition / TaxRate / TaxRule) so that adding a new country later is a
-- data-only change (new jurisdiction + definitions + rates + rules), never a
-- change to the calculation RPC (sql/072_calculate_purchase_taxes.sql).
--
-- Country routing: tax_jurisdictions.country_code (ISO alpha-2) replaces the
-- in-code country-pack registry (src/features/tax-integration/registry) as
-- the lookup key.
--
-- Rounding: tax_jurisdictions.rounding_mode / rounding_decimal_places make
-- rounding policy jurisdiction data instead of code choosing a strategy
-- (src/features/tax-packs/*/services/*-tax-pack.ts hardcoding "half_up").
--
-- Additive only:
--   tables: tax_jurisdictions, tax_categories, tax_types, tax_definitions,
--           tax_rates, tax_rules
--
-- Does NOT:
--   - seed data (see sql/071_accounting_vat_netherlands_seed.sql)
--   - create the calculation RPC (see sql/072_calculate_purchase_taxes.sql)
--   - change Purchases / Sales / existing Accounting tables
--   - remove or modify src/features/tax-engine, tax-integration, tax-packs

-- ---------------------------------------------------------------------------
-- tax_jurisdictions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_jurisdictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL UNIQUE,
  -- ISO 3166-1 alpha-2 country code. Routing key for calculate_purchase_taxes:
  -- adding a country is `insert a jurisdiction row`, never an RPC code change.
  country_code text NOT NULL,
  name text NOT NULL,

  parent_jurisdiction_id uuid REFERENCES tax_jurisdictions (id),

  rounding_mode text NOT NULL DEFAULT 'half_up'
    CHECK (
      rounding_mode IN ('half_up', 'half_even', 'floor', 'ceil', 'truncate')
    ),
  rounding_decimal_places integer NOT NULL DEFAULT 2
    CHECK (rounding_decimal_places BETWEEN 0 AND 8),

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tax_jurisdictions IS
  'Accounting-owned VAT jurisdictions. country_code is the routing key used by calculate_purchase_taxes to select applicable definitions/rates/rules without per-country code.';

CREATE INDEX IF NOT EXISTS tax_jurisdictions_country_code_idx
  ON tax_jurisdictions (country_code);

-- ---------------------------------------------------------------------------
-- tax_categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL UNIQUE,
  name text NOT NULL,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tax_categories IS
  'Opaque product/service tax category codes (e.g. goods, services, food) used only for tax_rules.match attribute equality.';

-- ---------------------------------------------------------------------------
-- tax_types
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL UNIQUE,
  name text NOT NULL,
  application_method text NOT NULL
    CHECK (
      application_method IN (
        'percentage_of_base',
        'percentage_of_gross',
        'fixed_amount',
        'amount_per_quantity'
      )
    ),

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tax_types IS
  'Tax calculation mechanics only (application_method) — no regime-specific formulas.';

-- ---------------------------------------------------------------------------
-- tax_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tax_code text NOT NULL,
  category_id uuid NOT NULL REFERENCES tax_categories (id),
  type_id uuid NOT NULL REFERENCES tax_types (id),
  jurisdiction_id uuid NOT NULL REFERENCES tax_jurisdictions (id),
  name text NOT NULL,
  direction text NOT NULL
    CHECK (direction IN ('input', 'output', 'neutral')),

  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_definitions_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE tax_definitions IS
  'Stable, time-bounded VAT definitions per jurisdiction. Uniqueness of tax_code among simultaneously-active definitions is an application-level rule (see validateUniqueTaxCodes), not enforced here.';

CREATE INDEX IF NOT EXISTS tax_definitions_jurisdiction_id_idx
  ON tax_definitions (jurisdiction_id);
CREATE INDEX IF NOT EXISTS tax_definitions_tax_code_idx
  ON tax_definitions (tax_code);

-- ---------------------------------------------------------------------------
-- tax_rates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tax_definition_id uuid NOT NULL REFERENCES tax_definitions (id),
  -- Percentage as a fraction (0.21 = 21%) or fixed/unit amount depending on
  -- the referenced tax_definitions.type_id application_method.
  rate_value numeric(9, 6) NOT NULL,

  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_rates_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE tax_rates IS
  'Time-bounded numeric rate/amount for a tax_definitions row. Latest effective_from wins when multiple rates are effective on the same date.';

CREATE INDEX IF NOT EXISTS tax_rates_tax_definition_id_idx
  ON tax_rates (tax_definition_id);

-- ---------------------------------------------------------------------------
-- tax_rules
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tax_definition_id uuid NOT NULL REFERENCES tax_definitions (id),
  -- Higher priority wins when multiple rules match the same tax_code slot.
  priority integer NOT NULL DEFAULT 100,

  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,

  -- null = any jurisdiction in the calculation context.
  jurisdiction_id uuid REFERENCES tax_jurisdictions (id),

  -- Opaque match attributes (e.g. {"category": "food", "regime": "reduced_vat"}).
  -- Matched by exact key/value equality only — no regime logic here.
  match jsonb NOT NULL DEFAULT '{}'::jsonb,

  description text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tax_rules_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE tax_rules IS
  'Selects which tax_definitions row applies to a request line via opaque attribute-equality matching. No country-specific logic — country differences are expressed entirely as data.';

CREATE INDEX IF NOT EXISTS tax_rules_tax_definition_id_idx
  ON tax_rules (tax_definition_id);
CREATE INDEX IF NOT EXISTS tax_rules_jurisdiction_id_idx
  ON tax_rules (jurisdiction_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE tax_jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_jurisdictions'
      AND policyname = 'tax_jurisdictions_authenticated_all'
  ) THEN
    CREATE POLICY tax_jurisdictions_authenticated_all
      ON tax_jurisdictions FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_categories'
      AND policyname = 'tax_categories_authenticated_all'
  ) THEN
    CREATE POLICY tax_categories_authenticated_all
      ON tax_categories FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_types'
      AND policyname = 'tax_types_authenticated_all'
  ) THEN
    CREATE POLICY tax_types_authenticated_all
      ON tax_types FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_definitions'
      AND policyname = 'tax_definitions_authenticated_all'
  ) THEN
    CREATE POLICY tax_definitions_authenticated_all
      ON tax_definitions FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_rates'
      AND policyname = 'tax_rates_authenticated_all'
  ) THEN
    CREATE POLICY tax_rates_authenticated_all
      ON tax_rates FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tax_rules'
      AND policyname = 'tax_rules_authenticated_all'
  ) THEN
    CREATE POLICY tax_rules_authenticated_all
      ON tax_rules FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;
