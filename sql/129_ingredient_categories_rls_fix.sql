-- Role-guard writes on ingredient_categories (SELECT stays open to
-- authenticated). Same shape as sql/124 for ingredients.
--
-- Run in Supabase SQL editor after sql/128_get_btw_report_role_guard.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's
-- money-critical / access-control protocol:
--   Part 1 dry run (BEGIN...ROLLBACK, self-contained, proves itself and
--          leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone post-commit verification queries run OUTSIDE any
--          transaction
--
-- Why this exists:
--   sql/075 added ingredient_categories_authenticated_all
--     FOR ALL TO authenticated USING (true) WITH CHECK (true).
--   No later sql/*.sql DROPs or replaces that policy (sql/124
--   explicitly left ingredient_categories alone). Any authenticated
--   session can POST/PATCH/DELETE any category over PostgREST.
--
-- Current policy (verified): sql/075 is the only CREATE POLICY on this
-- table. Exact text:
--   CREATE POLICY ingredient_categories_authenticated_all
--     ON ingredient_categories FOR ALL TO authenticated
--     USING (true) WITH CHECK (true);
--
-- Decision (same as sql/124):
--   SELECT remains open to every authenticated role (inventory /
--   purchases / recipes join categories by id). INSERT/UPDATE/DELETE
--   require get_my_role() IN ('owner', 'partner'). NOT owner-only.
--
-- Style: get_my_role() IN ('owner', 'partner') in USING / WITH CHECK.
-- ALTER POLICY cannot change FOR ALL into FOR SELECT, so DROP + CREATE.
--
-- GRANT (same gap sql/124 found for ingredients): no sql/*.sql file
-- GRANT/REVOKE on ingredient_categories. sql/000 CREATE TABLE does not
-- GRANT. sql/075 only ENABLE RLS + policy. sql/074 does not touch
-- tables. Live authenticated table rights exist only as an untracked
-- database default, same as ingredients before sql/124. This file adds
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ingredient_categories
--     TO authenticated
-- in Part 1 and Part 2 (idempotent).
--
-- SECURITY DEFINER writers: repo-wide grep of sql/*.sql function bodies
-- finds no INSERT/UPDATE/DELETE on ingredient_categories (only
-- tests/sql/*.sql, which run as the SQL-editor role). The app only
-- SELECTs (inventory-service getCategories / fetchReferenceData).
-- Scenario D proves the same from the live catalog: no public function
-- definition contains those DML strings. There is no DEFINER path to
-- keep unblocked — RLS is the write gate.
--
-- Does NOT:
--   - change ingredients RLS (sql/124)
--   - change inventory-service.ts
--   - add require_role inside a new categories RPC
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back). Copy everything between "-- >>> DRY RUN START" and
-- "-- <<< DRY RUN END" into the Supabase SQL Editor and run it FIRST.
--
--   (A) owner  — SELECT, INSERT, UPDATE, DELETE succeed under role
--       authenticated
--   (B) partner — same (real partner row, or temporary flip of the
--       owner row; rolled back)
--   (C) seller (temporary flip) — SELECT succeeds; UPDATE/DELETE
--       row_count=0; INSERT raises RLS
--   (D) catalog: no public function body writes ingredient_categories
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

DROP POLICY IF EXISTS ingredient_categories_authenticated_all
  ON ingredient_categories;

CREATE POLICY ingredient_categories_authenticated_select
  ON ingredient_categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ingredient_categories_owner_partner_insert
  ON ingredient_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredient_categories_owner_partner_update
  ON ingredient_categories
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredient_categories_owner_partner_delete
  ON ingredient_categories
  FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredient_categories TO authenticated;

DO $test$
DECLARE
  v_owner uuid;
  v_partner uuid;
  v_actor uuid;
  v_flipped_owner_to_partner boolean := false;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_cat uuid;
  v_name text;
  v_name_updated text;
  v_seen integer;
  v_updated integer;
  v_deleted integer;
  v_err text;
  v_writer_count integer;
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

  SELECT p.auth_user_id
  INTO v_partner
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'partner'
    AND p.auth_user_id IS DISTINCT FROM v_owner
  ORDER BY p.auth_user_id
  LIMIT 1;

  -- ----------------------------------------------------------------------
  -- Helper: emulate JWT for v_actor, then run as authenticated so RLS
  -- applies (postgres BYPASSRLS; SET LOCAL ROLE is required).
  -- ----------------------------------------------------------------------
  v_actor := v_owner;
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
  -- SCENARIO A: owner SELECT + INSERT + UPDATE + DELETE
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO A FAIL: get_my_role() is % — expected owner.',
      get_my_role();
  END IF;

  v_name := '__sql129_a_' || v_suffix;
  INSERT INTO ingredient_categories (name)
  VALUES (v_name)
  RETURNING id INTO v_cat;

  SELECT count(*) INTO v_seen
  FROM ingredient_categories
  WHERE id = v_cat;

  IF v_seen <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'SCENARIO A FAIL: owner SELECT missed the inserted row';
  END IF;

  v_name_updated := v_name || '_upd';
  UPDATE ingredient_categories
  SET name = v_name_updated
  WHERE id = v_cat;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO A FAIL: owner UPDATE row_count=% (expected 1)',
      v_updated;
  END IF;

  DELETE FROM ingredient_categories WHERE id = v_cat;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RESET ROLE;

  IF v_deleted <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: owner DELETE row_count=% (expected 1)',
      v_deleted;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: owner SELECT + INSERT + UPDATE + DELETE';

  -- ----------------------------------------------------------------------
  -- SCENARIO B: partner SELECT + INSERT + UPDATE + DELETE
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

  v_name := '__sql129_b_' || v_suffix;
  INSERT INTO ingredient_categories (name)
  VALUES (v_name)
  RETURNING id INTO v_cat;

  SELECT count(*) INTO v_seen
  FROM ingredient_categories
  WHERE id = v_cat;

  UPDATE ingredient_categories
  SET name = v_name || '_upd'
  WHERE id = v_cat;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  DELETE FROM ingredient_categories WHERE id = v_cat;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RESET ROLE;

  IF v_flipped_owner_to_partner THEN
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := false;
  END IF;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: partner SELECT missed the inserted row';
  END IF;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: partner UPDATE row_count=% (expected 1)',
      v_updated;
  END IF;

  IF v_deleted <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: partner DELETE row_count=% (expected 1)',
      v_deleted;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: partner SELECT + INSERT + UPDATE + DELETE';

  -- ----------------------------------------------------------------------
  -- SCENARIO C: seller — SELECT ok; UPDATE/DELETE 0 rows; INSERT RLS
  -- ----------------------------------------------------------------------
  v_actor := v_owner;
  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  SET LOCAL ROLE authenticated;

  v_name := '__sql129_c_' || v_suffix;
  INSERT INTO ingredient_categories (name)
  VALUES (v_name)
  RETURNING id INTO v_cat;

  RESET ROLE;

  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_owner;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner::text,
      'role', 'authenticated'
    )::text,
    true
  );

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO C FAIL: flip did not stick (get_my_role=%)',
      get_my_role();
  END IF;

  SELECT count(*) INTO v_seen
  FROM ingredient_categories
  WHERE id = v_cat;

  UPDATE ingredient_categories
  SET name = v_name || '_seller'
  WHERE id = v_cat;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  DELETE FROM ingredient_categories WHERE id = v_cat;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  BEGIN
    INSERT INTO ingredient_categories (name)
    VALUES ('__sql129_c_should_fail_' || v_suffix);
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

  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller SELECT missed the row';
  END IF;

  IF v_updated <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: seller UPDATE row_count=% (expected 0)',
      v_updated;
  END IF;

  IF v_deleted <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: seller DELETE row_count=% (expected 0)',
      v_deleted;
  END IF;

  IF (
    SELECT name FROM ingredient_categories WHERE id = v_cat
  ) IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: category name changed after seller UPDATE/DELETE';
  END IF;

  DELETE FROM ingredient_categories WHERE id = v_cat;

  RAISE NOTICE
    'SCENARIO C PASS: seller SELECT rows=1 UPDATE/DELETE row_count=0';

  -- ----------------------------------------------------------------------
  -- SCENARIO D: catalog — no function writes ingredient_categories
  -- ----------------------------------------------------------------------
  SELECT count(*)
  INTO v_writer_count
  FROM pg_proc p
  JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public'
    AND p.prokind = 'f'
    AND (
      pg_get_functiondef(p.oid) ~* 'insert[[:space:]]+into[[:space:]]+ingredient_categories'
      OR pg_get_functiondef(p.oid) ~* 'update[[:space:]]+ingredient_categories'
      OR pg_get_functiondef(p.oid) ~* 'delete[[:space:]]+from[[:space:]]+ingredient_categories'
    );

  IF v_writer_count <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: % public function(s) DML ingredient_categories — re-check DEFINER+BYPASSRLS before applying',
      v_writer_count;
  END IF;

  RAISE NOTICE
    'SCENARIO D PASS: no public function body inserts/updates/deletes ingredient_categories; RLS is the write gate (no DEFINER exception to preserve)';

  RAISE NOTICE 'sql/129 dry run: all 4 scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- THE MIGRATION (apply this for real, after Part 1 has passed)
-- Copy everything between "-- >>> MIGRATION START" and
-- "-- <<< MIGRATION END" into the SQL Editor and run it.
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

DROP POLICY IF EXISTS ingredient_categories_authenticated_all
  ON ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_authenticated_select
  ON ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_owner_partner_insert
  ON ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_owner_partner_update
  ON ingredient_categories;
DROP POLICY IF EXISTS ingredient_categories_owner_partner_delete
  ON ingredient_categories;

CREATE POLICY ingredient_categories_authenticated_select
  ON ingredient_categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ingredient_categories_owner_partner_insert
  ON ingredient_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredient_categories_owner_partner_update
  ON ingredient_categories
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

CREATE POLICY ingredient_categories_owner_partner_delete
  ON ingredient_categories
  FOR DELETE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredient_categories TO authenticated;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run AFTER Part 2
-- has committed, in a fresh SQL Editor tab, NOT inside a transaction).
-- Catalog-only: proves the four new policies exist, the old FOR ALL
-- policy is gone, and authenticated has table GRANT. Does not re-run
-- the scenarios (those are Part 1).
-- ============================================================================

SELECT pol.polname, pol.polcmd
FROM pg_policy pol
JOIN pg_class c ON c.oid = pol.polrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'public'
  AND c.relname = 'ingredient_categories'
ORDER BY pol.polname;
-- Expect four rows:
--   ingredient_categories_authenticated_select          r
--   ingredient_categories_owner_partner_delete          d
--   ingredient_categories_owner_partner_insert          a
--   ingredient_categories_owner_partner_update          w
-- and no ingredient_categories_authenticated_all.

SELECT
  NOT EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = 'ingredient_categories'
      AND pol.polname = 'ingredient_categories_authenticated_all'
  ) AS old_for_all_policy_gone;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'ingredient_categories'
  AND grantee = 'authenticated'
ORDER BY privilege_type;
-- Expect SELECT, INSERT, UPDATE, DELETE (possibly also others from
-- live defaults; those four must be present).
