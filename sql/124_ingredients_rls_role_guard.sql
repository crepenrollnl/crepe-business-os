-- Role-guard writes on ingredients (SELECT stays open to authenticated).
--
-- Run in Supabase SQL editor after sql/123_update_company_settings_require_role.sql.
-- Do NOT apply to a live database until explicitly approved. This file is
-- investigation + a self-rolling-back dry run + the later apply script.
--
-- Why this exists:
--   sql/075 added ingredients_authenticated_all
--     FOR ALL TO authenticated USING (true) WITH CHECK (true).
--   No later sql/*.sql DROPs or replaces that policy (sql/098 explicitly
--   left ingredients alone). Any authenticated session can PATCH/POST/DELETE
--   any ingredient over PostgREST, including current_stock and cost_per_unit.
--
-- Decision:
--   SELECT remains open to every authenticated role (POS / kitchen / future
--   seller must read on-hand qty). INSERT/UPDATE/DELETE require
--   get_my_role() IN ('owner', 'partner') — same bar as sql/098 / sql/117
--   money-critical table policies. NOT owner-only (that was
--   update_company_settings only).
--
-- Style: get_my_role() IN ('owner', 'partner') in USING / WITH CHECK,
-- matching journal_entries / accounts / purchases. ALTER POLICY cannot
-- change FOR ALL into FOR SELECT, so DROP + CREATE.
--
-- SECURITY DEFINER RPCs that write ingredients.current_stock /
-- cost_per_unit (receive_purchase, confirm_sale, complete_production_session,
-- record_write_off) run as their owner (BYPASSRLS). Nested INVOKER helpers
-- (decrement_ingredient_stock, receive_purchase_line_stock_and_cost) inherit
-- that current_user. Scenario D confirms prosecdef / rolbypassrls from
-- the catalog — it does not receive a real purchase.
--
-- Does NOT:
--   - change ingredient_categories RLS (still authenticated_all)
--   - change inventory-service.ts / the Edit form
--   - add require_role inside a new ingredients RPC
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- ============================================================================
-- PART 1 of 2 — DRY RUN (BEGIN...ROLLBACK). Copy everything between
-- "-- >>> DRY RUN START" and "-- <<< DRY RUN END" into the SQL Editor
-- and run it FIRST. Nothing persists.
--
--   (A) owner  — SELECT and UPDATE succeed under role authenticated
--   (B) partner — SELECT and UPDATE succeed (real partner row, or
--       temporary flip of the owner row; rolled back)
--   (C) seller (temporary flip) — SELECT succeeds; UPDATE is a no-op
--       (USING false); INSERT raises RLS
--   (D) catalog: outer stock-write RPCs are SECURITY DEFINER and their
--       owner has rolbypassrls
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

DROP POLICY IF EXISTS ingredients_authenticated_all ON ingredients;

CREATE POLICY ingredients_authenticated_select
  ON ingredients
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ingredients_owner_partner_insert
  ON ingredients
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredients_owner_partner_update
  ON ingredients
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredients_owner_partner_delete
  ON ingredients
  FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredients TO authenticated;

DO $test$
DECLARE
  v_owner uuid;
  v_partner uuid;
  v_actor uuid;
  v_original_role text;
  v_partner_original_role text;
  v_flipped_owner_to_partner boolean := false;
  v_claims text;
  v_ingredient uuid;
  v_stock_before numeric;
  v_seen integer;
  v_updated integer;
  v_err text;
  v_definer_ok boolean;
  r record;
BEGIN
  SELECT p.auth_user_id
  INTO v_owner
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'owner'
  ORDER BY p.auth_user_id
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION
      'No active owner row in profiles — cannot emulate get_my_role().';
  END IF;

  SELECT p.auth_user_id, p.role
  INTO v_partner, v_partner_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'partner'
    AND p.auth_user_id IS DISTINCT FROM v_owner
  ORDER BY p.auth_user_id
  LIMIT 1;

  SELECT id, current_stock
  INTO v_ingredient, v_stock_before
  FROM ingredients
  ORDER BY id
  LIMIT 1;

  IF v_ingredient IS NULL THEN
    BEGIN
      INSERT INTO ingredients (
        name,
        unit,
        current_stock,
        minimum_stock,
        cost_per_unit
      )
      VALUES (
        '__sql124_dry_run_seed__',
        'kg',
        0,
        0,
        0
      )
      RETURNING id, current_stock
      INTO v_ingredient, v_stock_before;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'No ingredients row — cannot exercise UPDATE RLS. Seed insert failed: %',
          SQLERRM;
    END;
  END IF;

  IF v_ingredient IS NULL THEN
    RAISE EXCEPTION 'No ingredients row — cannot exercise UPDATE RLS.';
  END IF;

  -- ----------------------------------------------------------------------
  -- Helper: emulate JWT for v_actor, then run as authenticated so RLS
  -- applies (postgres BYPASSRLS; SET LOCAL ROLE is required).
  -- ----------------------------------------------------------------------
  v_actor := v_owner;
  v_original_role := 'owner';
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

  -- ----------------------------------------------------------------------
  -- SCENARIO A: owner SELECT + UPDATE
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO A FAIL: get_my_role() is % — expected owner.',
      get_my_role();
  END IF;

  SELECT count(*) INTO v_seen
  FROM ingredients
  WHERE id = v_ingredient;

  IF v_seen <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'SCENARIO A FAIL: owner SELECT missed the row';
  END IF;

  UPDATE ingredients
  SET current_stock = current_stock
  WHERE id = v_ingredient;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RESET ROLE;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: owner UPDATE row_count=% (expected 1)',
      v_updated;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: owner SELECT + UPDATE (row_count=1)';

  -- ----------------------------------------------------------------------
  -- SCENARIO B: partner SELECT + UPDATE
  -- ----------------------------------------------------------------------
  IF v_partner IS NULL THEN
    UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := true;
    v_actor := v_owner;
    RAISE NOTICE
      'SCENARIO B: no real partner row; flipped owner % to partner for this transaction',
      v_owner;
  ELSE
    v_actor := v_partner;
    RAISE NOTICE 'SCENARIO B: using real partner row %', v_partner;
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'partner' THEN
    RESET ROLE;
    IF v_flipped_owner_to_partner THEN
      UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    END IF;
    RAISE EXCEPTION
      'SCENARIO B FAIL: get_my_role() is % — expected partner.',
      get_my_role();
  END IF;

  SELECT count(*) INTO v_seen
  FROM ingredients
  WHERE id = v_ingredient;

  UPDATE ingredients
  SET current_stock = current_stock
  WHERE id = v_ingredient;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RESET ROLE;

  IF v_flipped_owner_to_partner THEN
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := false;
  END IF;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: partner SELECT missed the row';
  END IF;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: partner UPDATE row_count=% (expected 1)',
      v_updated;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: partner SELECT + UPDATE (row_count=1)';

  -- ----------------------------------------------------------------------
  -- SCENARIO C: seller (flip owner) — SELECT ok; UPDATE 0 rows; INSERT RLS
  -- ----------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_owner;

  v_actor := v_owner;
  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO C FAIL: flip did not stick (get_my_role=%)',
      get_my_role();
  END IF;

  SELECT count(*) INTO v_seen
  FROM ingredients
  WHERE id = v_ingredient;

  UPDATE ingredients
  SET current_stock = current_stock + 1
  WHERE id = v_ingredient;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  BEGIN
    INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit)
    VALUES (
      '__sql124_dry_run_should_fail__',
      'kg',
      0,
      0,
      0
    );
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION 'SCENARIO C FAIL: seller INSERT unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%row-level security%'
         AND v_err NOT ILIKE '%new row violates%' THEN
        RESET ROLE;
        UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
        RAISE EXCEPTION
          'SCENARIO C FAIL: seller INSERT expected RLS denial, got: %',
          v_err;
      END IF;
      RAISE NOTICE 'SCENARIO C PASS (seller INSERT rejected): %', v_err;
  END;

  RESET ROLE;
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;

  IF v_seen < 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller SELECT returned no rows';
  END IF;

  IF v_updated <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: seller UPDATE row_count=% (expected 0)',
      v_updated;
  END IF;

  IF (
    SELECT current_stock FROM ingredients WHERE id = v_ingredient
  ) IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: current_stock changed after seller UPDATE';
  END IF;

  RAISE NOTICE
    'SCENARIO C PASS: seller SELECT rows=% UPDATE row_count=0 stock unchanged',
    v_seen;

  -- ----------------------------------------------------------------------
  -- SCENARIO D: catalog — outer writers are SECURITY DEFINER + BYPASSRLS
  -- ----------------------------------------------------------------------
  v_definer_ok := true;

  FOR r IN
    SELECT
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.prosecdef,
      owner.rolname AS owner_name,
      owner.rolbypassrls
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_roles owner ON owner.oid = p.proowner
    WHERE ns.nspname = 'public'
      AND p.proname IN (
        'receive_purchase',
        'confirm_sale',
        'complete_production_session',
        'record_write_off',
        'receive_purchase_line_stock_and_cost',
        'decrement_ingredient_stock',
        'increment_ingredient_stock'
      )
    ORDER BY p.proname, 2
  LOOP
    RAISE NOTICE
      'SCENARIO D fn %(%) prosecdef=% owner=% rolbypassrls=%',
      r.proname, r.args, r.prosecdef, r.owner_name, r.rolbypassrls;

    IF r.proname IN (
      'receive_purchase',
      'confirm_sale',
      'complete_production_session',
      'record_write_off'
    ) THEN
      IF r.prosecdef IS NOT TRUE OR r.rolbypassrls IS NOT TRUE THEN
        v_definer_ok := false;
        RAISE NOTICE
          'SCENARIO D FAIL detail: % is not DEFINER+BYPASSRLS',
          r.proname;
      END IF;
    END IF;
  END LOOP;

  IF NOT v_definer_ok THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: an outer stock-write RPC is not SECURITY DEFINER with a BYPASSRLS owner';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.proname = 'receive_purchase'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: receive_purchase missing or not DEFINER';
  END IF;

  RAISE NOTICE
    'SCENARIO D PASS: receive_purchase / confirm_sale / complete_production_session / record_write_off are SECURITY DEFINER; owner has rolbypassrls. Nested INVOKER helpers inherit that current_user and are not blocked by ingredients RLS.';

  RAISE NOTICE 'sql/124 dry run: all 4 scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 2 — THE MIGRATION (apply this for real, after Part 1 has passed
-- and after explicit approval). Same policies as the dry-run block.
-- ============================================================================

DROP POLICY IF EXISTS ingredients_authenticated_all ON ingredients;
DROP POLICY IF EXISTS ingredients_authenticated_select ON ingredients;
DROP POLICY IF EXISTS ingredients_owner_partner_insert ON ingredients;
DROP POLICY IF EXISTS ingredients_owner_partner_update ON ingredients;
DROP POLICY IF EXISTS ingredients_owner_partner_delete ON ingredients;

CREATE POLICY ingredients_authenticated_select
  ON ingredients
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ingredients_owner_partner_insert
  ON ingredients
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredients_owner_partner_update
  ON ingredients
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredients_owner_partner_delete
  ON ingredients
  FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredients TO authenticated;
