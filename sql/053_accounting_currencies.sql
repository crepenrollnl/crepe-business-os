-- Accounting Currencies Foundation (DEV-087)
-- Run in Supabase SQL editor after sql/028_company_settings.sql (recommended).
--
-- SCHEMA ONLY:
--   currencies
--   currency_rates
--
-- Supports multi-currency posting (base vs transaction amounts) and future FX.
-- company_settings.currency_code remains the company base-currency setting.
--
-- Does NOT:
--   - create posting engine / RPCs / automatic postings
--   - create journal, ledger, VAT, or statement objects
--   - modify Inventory / Purchases / Production / Sales / Reporting
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- currencies (ISO currency master)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS currencies (
  code text PRIMARY KEY,

  name text NOT NULL,
  decimal_places integer NOT NULL DEFAULT 2,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT currencies_code_iso4217
    CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT currencies_decimal_places_range
    CHECK (decimal_places >= 0 AND decimal_places <= 6)
);

COMMENT ON TABLE currencies IS
  'ISO 4217 currency master for Accounting multi-currency. Base currency is chosen in company_settings.';

CREATE INDEX IF NOT EXISTS currencies_is_active_idx
  ON currencies (is_active);

CREATE INDEX IF NOT EXISTS currencies_name_idx
  ON currencies (name);

-- Seed common currencies (idempotent).
INSERT INTO currencies (code, name, decimal_places, is_active)
VALUES
  ('EUR', 'Euro', 2, true),
  ('USD', 'US Dollar', 2, true),
  ('GBP', 'Pound Sterling', 2, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- currency_rates (quote -> base conversion)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS currency_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  base_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,
  quote_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,

  -- Multiply quote (transaction) amount by rate to obtain base amount.
  rate numeric(18, 6) NOT NULL
    CHECK (rate > 0),

  rate_date date NOT NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'feed', 'system')),

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT currency_rates_currencies_differ
    CHECK (base_currency <> quote_currency),
  CONSTRAINT currency_rates_unique_key
    UNIQUE (base_currency, quote_currency, rate_date, source)
);

COMMENT ON TABLE currency_rates IS
  'Exchange rates for Accounting. rate converts quote_currency amounts into base_currency.';

COMMENT ON COLUMN currency_rates.rate IS
  'Multiply transaction (quote) amount by this rate to get company base amount.';

CREATE INDEX IF NOT EXISTS currency_rates_base_quote_date_idx
  ON currency_rates (base_currency, quote_currency, rate_date DESC);

CREATE INDEX IF NOT EXISTS currency_rates_rate_date_idx
  ON currency_rates (rate_date DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'currencies'
      AND policyname = 'currencies_authenticated_all'
  ) THEN
    CREATE POLICY currencies_authenticated_all
      ON currencies
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'currency_rates'
      AND policyname = 'currency_rates_authenticated_all'
  ) THEN
    CREATE POLICY currency_rates_authenticated_all
      ON currency_rates
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
