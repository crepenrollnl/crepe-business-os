-- Accounting VAT Netherlands Seed (V1 plan 1.6, step 2/3)
-- Run in Supabase SQL editor after sql/070_accounting_vat_schema.sql.
--
-- Line-for-line data port of the existing Netherlands Tax Pack
-- (src/features/tax-packs/netherlands/data/pack-data.ts) into the
-- Accounting-owned VAT schema. No calculation logic here — data only.
--
-- Surrogate ids are freshly generated uuids (gen_random_uuid()); this table
-- set is independent of the TS pack's string ids (e.g. "def-nl-standard-vat"),
-- which are not valid uuids and are not reused. Natural keys (code / tax_code)
-- carry the human-readable identity instead, matching this schema's uuid PK
-- convention used elsewhere in the project.
--
-- Idempotent: every insert is guarded by a NOT EXISTS check on its natural
-- key, safe to re-run.
--
-- Does NOT:
--   - create the calculation RPC (see sql/072_calculate_purchase_taxes.sql)
--   - change src/features/tax-packs/netherlands (kept as-is, unused for now)

-- ---------------------------------------------------------------------------
-- Jurisdiction
-- ---------------------------------------------------------------------------

INSERT INTO tax_jurisdictions (
  code, country_code, name, parent_jurisdiction_id,
  rounding_mode, rounding_decimal_places, is_active
)
SELECT 'NL', 'NL', 'Netherlands', NULL, 'half_up', 2, true
WHERE NOT EXISTS (
  SELECT 1 FROM tax_jurisdictions WHERE code = 'NL'
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

INSERT INTO tax_categories (code, name, is_active)
SELECT v.code, v.name, true
FROM (
  VALUES
    ('goods', 'Goods'),
    ('services', 'Services'),
    ('digital_services', 'Digital Services'),
    ('food', 'Food'),
    ('alcohol', 'Alcohol'),
    ('transport', 'Transport')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM tax_categories c WHERE c.code = v.code
);

-- ---------------------------------------------------------------------------
-- Type
-- ---------------------------------------------------------------------------

INSERT INTO tax_types (code, name, application_method, is_active)
SELECT
  'NL_PERCENTAGE_OF_BASE',
  'Netherlands percentage of taxable base',
  'percentage_of_base',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM tax_types WHERE code = 'NL_PERCENTAGE_OF_BASE'
);

-- ---------------------------------------------------------------------------
-- Definitions
-- ---------------------------------------------------------------------------

INSERT INTO tax_definitions (
  tax_code, category_id, type_id, jurisdiction_id, name, direction,
  is_active, effective_from, effective_to
)
SELECT
  v.tax_code, cat.id, typ.id, jur.id, v.name, v.direction,
  true, v.effective_from::date, NULL
FROM (
  VALUES
    ('NL-VAT-STD-21', 'goods',    'Netherlands Standard VAT',                 'output',  '2012-10-01'),
    ('NL-VAT-RED-9',  'food',     'Netherlands Reduced VAT 9%',               'output',  '2019-01-01'),
    ('NL-VAT-ZERO-0', 'goods',    'Netherlands Zero Rate VAT',                'output',  '2019-01-01'),
    ('NL-VAT-EXEMPT', 'services', 'Netherlands VAT Exempt',                   'output',  '2019-01-01'),
    ('NL-VAT-RC',     'services', 'Netherlands Reverse Charge',               'neutral', '2019-01-01'),
    ('NL-VAT-ICP',    'goods',    'Netherlands Intra-Community Supply (ICP)', 'neutral', '2019-01-01'),
    ('NL-VAT-IMPORT', 'goods',    'Netherlands Import VAT',                   'input',   '2019-01-01'),
    ('NL-VAT-EXPORT', 'goods',    'Netherlands Export (0%)',                  'neutral', '2019-01-01'),
    ('NL-VAT-KOR',    'services', 'Netherlands Small Business Scheme (KOR)',  'neutral', '2019-01-01')
) AS v(tax_code, category_code, name, direction, effective_from)
JOIN tax_categories cat ON cat.code = v.category_code
JOIN tax_types typ ON typ.code = 'NL_PERCENTAGE_OF_BASE'
JOIN tax_jurisdictions jur ON jur.code = 'NL'
WHERE NOT EXISTS (
  SELECT 1 FROM tax_definitions d
  WHERE d.tax_code = v.tax_code AND d.jurisdiction_id = jur.id
);

-- ---------------------------------------------------------------------------
-- Rates (standard_vat has two rows: legacy 19% then current 21%)
-- ---------------------------------------------------------------------------

INSERT INTO tax_rates (
  tax_definition_id, rate_value, effective_from, effective_to, is_active
)
SELECT def.id, v.rate_value, v.effective_from::date, v.effective_to::date, true
FROM (
  VALUES
    ('NL-VAT-STD-21', 0.19, '2012-10-01', '2018-12-31'),
    ('NL-VAT-STD-21', 0.21, '2019-01-01', NULL),
    ('NL-VAT-RED-9',  0.09, '2019-01-01', NULL),
    ('NL-VAT-ZERO-0', 0.00, '2019-01-01', NULL),
    ('NL-VAT-EXEMPT', 0.00, '2019-01-01', NULL),
    ('NL-VAT-RC',     0.00, '2019-01-01', NULL),
    ('NL-VAT-ICP',    0.00, '2019-01-01', NULL),
    ('NL-VAT-IMPORT', 0.21, '2019-01-01', NULL),
    ('NL-VAT-EXPORT', 0.00, '2019-01-01', NULL),
    ('NL-VAT-KOR',    0.00, '2019-01-01', NULL)
) AS v(tax_code, rate_value, effective_from, effective_to)
JOIN tax_definitions def ON def.tax_code = v.tax_code
JOIN tax_jurisdictions jur ON jur.code = 'NL' AND def.jurisdiction_id = jur.id
WHERE NOT EXISTS (
  SELECT 1 FROM tax_rates r
  WHERE r.tax_definition_id = def.id
    AND r.effective_from = v.effective_from::date
);

-- ---------------------------------------------------------------------------
-- Rules (regime + category opaque match attributes)
-- ---------------------------------------------------------------------------

INSERT INTO tax_rules (
  tax_definition_id, priority, effective_from, effective_to,
  is_active, jurisdiction_id, match, description
)
SELECT
  def.id, v.priority, v.effective_from::date, NULL, true, jur.id,
  jsonb_build_object('regime', v.regime, 'category', v.category),
  'NL ' || v.regime || ' / ' || v.category
FROM (
  VALUES
    ('NL-VAT-STD-21', 100, '2012-10-01', 'standard_vat',              'goods'),
    ('NL-VAT-STD-21', 100, '2012-10-01', 'standard_vat',              'services'),
    ('NL-VAT-STD-21', 100, '2012-10-01', 'standard_vat',              'digital_services'),
    ('NL-VAT-STD-21', 100, '2012-10-01', 'standard_vat',              'alcohol'),
    ('NL-VAT-STD-21', 100, '2012-10-01', 'standard_vat',              'transport'),
    ('NL-VAT-RED-9',  100, '2019-01-01', 'reduced_vat',               'food'),
    ('NL-VAT-ZERO-0', 100, '2019-01-01', 'zero_rate',                 'goods'),
    ('NL-VAT-EXEMPT', 100, '2019-01-01', 'exempt',                    'services'),
    ('NL-VAT-RC',     200, '2019-01-01', 'reverse_charge',            'services'),
    ('NL-VAT-ICP',    200, '2019-01-01', 'intra_community_supply',    'goods'),
    ('NL-VAT-IMPORT', 200, '2019-01-01', 'import',                    'goods'),
    ('NL-VAT-EXPORT', 200, '2019-01-01', 'export',                    'goods'),
    ('NL-VAT-KOR',    300, '2019-01-01', 'small_business_scheme_kor', 'services'),
    ('NL-VAT-KOR',    300, '2019-01-01', 'small_business_scheme_kor', 'goods')
) AS v(tax_code, priority, effective_from, regime, category)
JOIN tax_definitions def ON def.tax_code = v.tax_code
JOIN tax_jurisdictions jur ON jur.code = 'NL' AND def.jurisdiction_id = jur.id
WHERE NOT EXISTS (
  SELECT 1 FROM tax_rules r
  WHERE r.tax_definition_id = def.id
    AND r.match = jsonb_build_object('regime', v.regime, 'category', v.category)
);
