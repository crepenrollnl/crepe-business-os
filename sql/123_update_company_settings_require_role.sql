-- Owner-only gate on update_company_settings (VAT / company identity).
--
-- Run in Supabase SQL editor after sql/122_recipe_cost_report.sql.
-- Do NOT apply to a live database until explicitly approved. This file is
-- investigation + a self-rolling-back dry run + the later apply script.
--
-- Why this exists:
--   sql/028 created update_company_settings as SECURITY DEFINER with
--   GRANT EXECUTE TO authenticated and no role check. sql/074 later
--   revoked PUBLIC/anon EXECUTE (preserved by CREATE OR REPLACE when the
--   signature is unchanged). Any authenticated session can still rewrite
--   the singleton company_settings row, including vat_number.
--
-- Decision (this function only, deliberate):
--   PERFORM require_role('owner');
--   NOT owner+partner. Company / VAT identity is owner-only.
--
-- Source of the current body: sql/028_company_settings.sql is the only
-- CREATE OR REPLACE FUNCTION update_company_settings in the repo. No later
-- sql/*.sql replaces it. The new body is that function with one added
-- first statement; everything else is character-identical.
--
-- GRANT/REVOKE: same rights as today (028 GRANT authenticated + 074
-- REVOKE PUBLIC/anon). CREATE OR REPLACE does not reset ACL when the
-- signature is unchanged. Part 2 restates those grants so a replay on a
-- fresh database matches live. Scenario C only confirms the current
-- REVOKE; it does not add a new privilege rule.
--
-- Does NOT:
--   - change get_company_settings
--   - change company_settings table / RLS (RLS on, no policies; writes
--     remain DEFINER-only)
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--   - touch UI
--
-- ============================================================================
-- PART 1 of 2 — DRY RUN (BEGIN...ROLLBACK). Copy everything between
-- "-- >>> DRY RUN START" and "-- <<< DRY RUN END" into the SQL Editor
-- and run it FIRST. Nothing persists.
--
--   (A) owner — update_company_settings() with all-NULL args succeeds
--       (same as today: NULL = leave unchanged).
--   (B) partner — temporary profiles.role flip of the owner row to
--       'partner' (rolled back). Must raise 42501
--       "Insufficient permissions for this action (role: partner)."
--   (C) anon / PUBLIC — EXECUTE already revoked (sql/074). Confirm only.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

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
  PERFORM require_role('owner');
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

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_err text;
  v_sqlstate text;
  v_result jsonb;
  v_vat_before text;
  v_vat_after text;
  v_name_before text;
  v_name_after text;
  v_fn_oid oid;
  v_anon_execute boolean;
  v_public_execute boolean;
  v_authenticated_execute boolean;
BEGIN
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'owner'
  ORDER BY p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner row in profiles — cannot emulate require_role(''owner'').';
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'auth.uid() emulation failed (got %, expected %).',
      auth.uid(), v_actor;
  END IF;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION
      'get_my_role() after JWT emulation is % — expected owner.',
      get_my_role();
  END IF;

  RAISE NOTICE 'JWT emulated auth.uid()=% (real role=%)', auth.uid(), v_original_role;

  SELECT vat_number, company_name
  INTO v_vat_before, v_name_before
  FROM company_settings
  WHERE singleton IS TRUE;

  -- ------------------------------------------------------------------------
  -- SCENARIO A: owner, all-NULL args — must pass require_role and behave
  -- as today (NULL = leave unchanged). updated_at will tick; ROLLBACK
  -- reverts it.
  -- ------------------------------------------------------------------------
  v_result := update_company_settings();

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: update_company_settings returned NULL';
  END IF;

  IF v_result->>'company_name' IS DISTINCT FROM v_name_before THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: company_name changed (% -> %)',
      v_name_before, v_result->>'company_name';
  END IF;

  IF v_result->>'vat_number' IS DISTINCT FROM v_vat_before THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: vat_number changed (% -> %)',
      v_vat_before, v_result->>'vat_number';
  END IF;

  RAISE NOTICE
    'SCENARIO A PASS: owner call succeeded; company_name=% vat_number=%',
    v_result->>'company_name',
    v_result->>'vat_number';

  -- ------------------------------------------------------------------------
  -- SCENARIO B: same auth.uid(), profiles.role temporarily flipped to
  -- partner. Must raise 42501 before any field write. VAT unchanged.
  -- ------------------------------------------------------------------------
  UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_actor;

  IF get_my_role() IS DISTINCT FROM 'partner' THEN
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION
      'SCENARIO B FAIL: flip did not stick (get_my_role=%)',
      get_my_role();
  END IF;

  BEGIN
    v_result := update_company_settings();
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION
      'SCENARIO B FAIL: partner-role caller unexpectedly succeeded (%)',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err NOT LIKE 'Insufficient permissions for this action (role: partner).' THEN
        UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
        RAISE EXCEPTION
          'SCENARIO B FAIL: expected 42501 / role: partner, got SQLSTATE % / %',
          v_sqlstate, v_err;
      END IF;
      RAISE NOTICE 'SCENARIO B PASS (partner-role rejected): SQLSTATE=% %', v_sqlstate, v_err;
  END;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  SELECT vat_number INTO v_vat_after
  FROM company_settings
  WHERE singleton IS TRUE;

  IF v_vat_after IS DISTINCT FROM v_vat_before THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: vat_number changed after rejected partner call (% -> %)',
      v_vat_before, v_vat_after;
  END IF;

  -- ------------------------------------------------------------------------
  -- SCENARIO C: confirm existing REVOKE. No new GRANT/REVOKE in this
  -- dry run. CREATE OR REPLACE with the same signature does not reset ACL.
  -- ------------------------------------------------------------------------
  SELECT p.oid
  INTO v_fn_oid
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.proname = 'update_company_settings'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_company_name text, p_legal_name text, p_vat_number text, p_kvk_number text, p_address text, p_postal_code text, p_city text, p_country text, p_phone text, p_email text, p_website text, p_currency_code text, p_timezone text';

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: update_company_settings oid not found';
  END IF;

  v_anon_execute := has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  v_public_execute := has_function_privilege('public', v_fn_oid, 'EXECUTE');
  v_authenticated_execute :=
    has_function_privilege('authenticated', v_fn_oid, 'EXECUTE');

  IF v_anon_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: anon still has EXECUTE (has_function_privilege=%)',
      v_anon_execute;
  END IF;

  IF v_public_execute IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: PUBLIC still has EXECUTE (has_function_privilege=%)',
      v_public_execute;
  END IF;

  IF v_authenticated_execute IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: authenticated lost EXECUTE (has_function_privilege=%)',
      v_authenticated_execute;
  END IF;

  RAISE NOTICE
    'SCENARIO C PASS: anon EXECUTE=% PUBLIC EXECUTE=% authenticated EXECUTE=% (REVOKE already in place; nothing new)',
    v_anon_execute, v_public_execute, v_authenticated_execute;

  RAISE NOTICE 'sql/123 dry run: all 3 scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 2 — THE MIGRATION (apply this for real, after Part 1 has passed
-- and after explicit approval). Same body as the dry-run CREATE OR REPLACE.
-- ============================================================================

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
  PERFORM require_role('owner');
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
  'Update the single company_settings row. NULL args leave fields unchanged; blank clears nullable fields. Owner only (require_role).';

REVOKE ALL ON FUNCTION update_company_settings(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_company_settings(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION update_company_settings(
  text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
