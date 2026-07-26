-- Company Settings Foundation (DEV-051)
-- Standalone single-company configuration + get/update RPCs.
--
-- Table:
--   company_settings (exactly one row)
--
-- RPCs:
--   get_company_settings
--   update_company_settings
--
-- Does NOT:
--   - implement authentication, login, JWT, or permissions
--   - enable RLS
--   - modify Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Users & Roles
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- company_settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Enforces a single configuration row for this deployment.
  singleton boolean NOT NULL DEFAULT true,

  company_name text NOT NULL,
  legal_name text,
  vat_number text,
  kvk_number text,
  address text,
  postal_code text,
  city text,
  country text,
  phone text,
  email text,
  website text,
  currency_code text NOT NULL DEFAULT 'EUR',
  timezone text NOT NULL DEFAULT 'Europe/Amsterdam',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT company_settings_singleton_key UNIQUE (singleton),
  CONSTRAINT company_settings_singleton_true CHECK (singleton IS TRUE),
  CONSTRAINT company_settings_company_name_not_blank
    CHECK (length(btrim(company_name)) > 0),
  CONSTRAINT company_settings_currency_code_not_blank
    CHECK (length(btrim(currency_code)) > 0),
  CONSTRAINT company_settings_timezone_not_blank
    CHECK (length(btrim(timezone)) > 0)
);

COMMENT ON TABLE company_settings IS
  'Single-company configuration. Exactly one row; no multi-company support yet.';

-- Seed the singleton row when missing.
INSERT INTO company_settings (
  company_name,
  currency_code,
  timezone
)
SELECT
  'Crepe''n Roll',
  'EUR',
  'Europe/Amsterdam'
WHERE NOT EXISTS (
  SELECT 1 FROM company_settings
);

-- ---------------------------------------------------------------------------
-- Shared JSON projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION company_settings_to_jsonb(
  p_row company_settings
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'company_name', p_row.company_name,
    'legal_name', p_row.legal_name,
    'vat_number', p_row.vat_number,
    'kvk_number', p_row.kvk_number,
    'address', p_row.address,
    'postal_code', p_row.postal_code,
    'city', p_row.city,
    'country', p_row.country,
    'phone', p_row.phone,
    'email', p_row.email,
    'website', p_row.website,
    'currency_code', p_row.currency_code,
    'timezone', p_row.timezone,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at
  );
$$;

COMMENT ON FUNCTION company_settings_to_jsonb(company_settings) IS
  'Internal JSON projection for company_settings RPC responses.';

-- ---------------------------------------------------------------------------
-- get_company_settings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_company_settings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings company_settings%ROWTYPE;
BEGIN
  SELECT *
  INTO v_settings
  FROM company_settings
  WHERE singleton IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company settings were not found.';
  END IF;

  RETURN company_settings_to_jsonb(v_settings);
END;
$$;

COMMENT ON FUNCTION get_company_settings() IS
  'Return the single company_settings row. No auth/permissions.';

GRANT EXECUTE ON FUNCTION get_company_settings() TO authenticated;

-- ---------------------------------------------------------------------------
-- update_company_settings
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_company_settings(
  p_company_name text DEFAULT NULL,
  p_legal_name text DEFAULT NULL,
  p_vat_number text DEFAULT NULL,
  p_kvk_number text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_postal_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_currency_code text DEFAULT NULL,
  p_timezone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings company_settings%ROWTYPE;
  v_company_name text;
  v_legal_name text;
  v_vat_number text;
  v_kvk_number text;
  v_address text;
  v_postal_code text;
  v_city text;
  v_country text;
  v_phone text;
  v_email text;
  v_website text;
  v_currency_code text;
  v_timezone text;
  v_now timestamptz := now();
BEGIN
  SELECT *
  INTO v_settings
  FROM company_settings
  WHERE singleton IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company settings were not found.';
  END IF;

  -- NULL argument means "leave unchanged". Blank string clears nullable fields.
  IF p_company_name IS NULL THEN
    v_company_name := v_settings.company_name;
  ELSE
    v_company_name := NULLIF(btrim(p_company_name), '');
    IF v_company_name IS NULL THEN
      RAISE EXCEPTION 'Company name is required.';
    END IF;
  END IF;

  IF p_legal_name IS NULL THEN
    v_legal_name := v_settings.legal_name;
  ELSE
    v_legal_name := NULLIF(btrim(p_legal_name), '');
  END IF;

  IF p_vat_number IS NULL THEN
    v_vat_number := v_settings.vat_number;
  ELSE
    v_vat_number := NULLIF(btrim(p_vat_number), '');
  END IF;

  IF p_kvk_number IS NULL THEN
    v_kvk_number := v_settings.kvk_number;
  ELSE
    v_kvk_number := NULLIF(btrim(p_kvk_number), '');
  END IF;

  IF p_address IS NULL THEN
    v_address := v_settings.address;
  ELSE
    v_address := NULLIF(btrim(p_address), '');
  END IF;

  IF p_postal_code IS NULL THEN
    v_postal_code := v_settings.postal_code;
  ELSE
    v_postal_code := NULLIF(btrim(p_postal_code), '');
  END IF;

  IF p_city IS NULL THEN
    v_city := v_settings.city;
  ELSE
    v_city := NULLIF(btrim(p_city), '');
  END IF;

  IF p_country IS NULL THEN
    v_country := v_settings.country;
  ELSE
    v_country := NULLIF(btrim(p_country), '');
  END IF;

  IF p_phone IS NULL THEN
    v_phone := v_settings.phone;
  ELSE
    v_phone := NULLIF(btrim(p_phone), '');
  END IF;

  IF p_email IS NULL THEN
    v_email := v_settings.email;
  ELSE
    v_email := NULLIF(btrim(p_email), '');
  END IF;

  IF p_website IS NULL THEN
    v_website := v_settings.website;
  ELSE
    v_website := NULLIF(btrim(p_website), '');
  END IF;

  IF p_currency_code IS NULL THEN
    v_currency_code := v_settings.currency_code;
  ELSE
    v_currency_code := NULLIF(btrim(p_currency_code), '');
    IF v_currency_code IS NULL THEN
      RAISE EXCEPTION 'Currency code is required.';
    END IF;
    v_currency_code := upper(v_currency_code);
  END IF;

  IF p_timezone IS NULL THEN
    v_timezone := v_settings.timezone;
  ELSE
    v_timezone := NULLIF(btrim(p_timezone), '');
    IF v_timezone IS NULL THEN
      RAISE EXCEPTION 'Timezone is required.';
    END IF;
  END IF;

  UPDATE company_settings
  SET
    company_name = v_company_name,
    legal_name = v_legal_name,
    vat_number = v_vat_number,
    kvk_number = v_kvk_number,
    address = v_address,
    postal_code = v_postal_code,
    city = v_city,
    country = v_country,
    phone = v_phone,
    email = v_email,
    website = v_website,
    currency_code = v_currency_code,
    timezone = v_timezone,
    updated_at = v_now
  WHERE id = v_settings.id
  RETURNING * INTO v_settings;

  RETURN company_settings_to_jsonb(v_settings);
END;
$$;

COMMENT ON FUNCTION update_company_settings(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'Update the single company_settings row. NULL args leave fields unchanged; blank clears nullable fields. No auth/permissions.';

GRANT EXECUTE ON FUNCTION update_company_settings(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
