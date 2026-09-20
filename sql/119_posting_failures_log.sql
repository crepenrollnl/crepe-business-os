-- Durable log of non-fatal accounting posting failures (audit finding #8).
--
-- Run in Supabase SQL editor after sql/118_sale_idempotency_guard.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's
-- money-critical / access-control protocol:
--   Part 1 dry run (BEGIN...ROLLBACK, self-contained, proves itself and
--          leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone post-commit verification queries run OUTSIDE any
--          transaction (3a–3f catalog; 3g real REST curl with the anon key)
--
-- Why this exists:
--   Purchases / Sales / Quick Sale / POS / Production / Write-offs commit
--   the physical operation first and never roll it back if the following
--   Accounting post fails. The failure surfaces as postingError inside an
--   ok(...) TypeScript result. Until this migration that string lived only
--   in React state and vanished on navigate. posting_failures is the
--   durable, owner/partner-visible record of those failures.
--
-- Additive only:
--   table:    posting_failures
--   function: record_posting_failure(...) RETURNS uuid
--   function: resolve_posting_failure(...) RETURNS void
--
-- Does NOT:
--   - change journal_entries / ledger_entries / the physical-vs-posting
--     two-step pattern
--   - grant INSERT/UPDATE/DELETE on posting_failures to any role
--     (writes go only through the two SECURITY DEFINER RPCs)
--   - create UI, hooks, or services (TypeScript follow-up in the same
--     application change, not this SQL file)
--
-- RLS: SELECT restricted to owner/partner via get_my_role() (sql/097).
-- No INSERT/UPDATE/DELETE policy. Direct table writes by authenticated
-- are denied by RLS even if a GRANT were added later; production does
-- not GRANT those privileges either.
--
-- GRANT/REVOKE: anon holds its own independent grant on this project and
-- does not lose access when PUBLIC does (sql/074). Both are revoked
-- explicitly, separately, on the two new functions and on the table.
--
-- Known dry-run limit (same class as sql/117): the SQL Editor connects as
-- postgres (BYPASSRLS). Direct INSERT as `authenticated` is therefore
-- tested by SET LOCAL ROLE authenticated after a temporary INSERT GRANT
-- that exists only inside the rolled-back dry run — not in Part 2.

-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back). Copy everything between "-- >>> DRY RUN START" and
-- "-- <<< DRY RUN END" into the Supabase SQL Editor and run it FIRST.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE TABLE IF NOT EXISTS posting_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_flow text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  business_event_id uuid,
  error_message text NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolution_note text,
  CONSTRAINT posting_failures_source_flow_check CHECK (
    source_flow IN (
      'purchase_receive',
      'sale_confirm',
      'quick_sale_confirm',
      'pos_confirm',
      'production_complete',
      'write_off_record'
    )
  ),
  CONSTRAINT posting_failures_error_message_not_blank CHECK (
    char_length(btrim(error_message)) > 0
  )
);

CREATE INDEX IF NOT EXISTS posting_failures_unresolved_occurred_at_idx
  ON posting_failures (occurred_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE posting_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posting_failures_select_owner_partner ON posting_failures;
CREATE POLICY posting_failures_select_owner_partner
  ON posting_failures
  FOR SELECT
  USING (get_my_role() IN ('owner', 'partner'));

REVOKE ALL ON TABLE posting_failures FROM PUBLIC;
REVOKE ALL ON TABLE posting_failures FROM anon;
REVOKE ALL ON TABLE posting_failures FROM authenticated;
GRANT SELECT ON TABLE posting_failures TO authenticated;

CREATE OR REPLACE FUNCTION record_posting_failure(
  p_source_flow text,
  p_entity_type text,
  p_entity_id uuid,
  p_business_event_id uuid,
  p_error_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_message text;
BEGIN
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity_id is required.';
  END IF;

  v_message := btrim(COALESCE(p_error_message, ''));
  IF v_message = '' THEN
    RAISE EXCEPTION 'error_message is required.';
  END IF;

  IF btrim(COALESCE(p_entity_type, '')) = '' THEN
    RAISE EXCEPTION 'entity_type is required.';
  END IF;

  INSERT INTO posting_failures (
    source_flow,
    entity_type,
    entity_id,
    business_event_id,
    error_message
  )
  VALUES (
    p_source_flow,
    btrim(p_entity_type),
    p_entity_id,
    p_business_event_id,
    v_message
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_posting_failure(
  p_id uuid,
  p_resolution_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing posting_failures%ROWTYPE;
  v_updated uuid;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Posting failure id is required.';
  END IF;

  SELECT *
  INTO v_existing
  FROM posting_failures
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posting failure % was not found.', p_id;
  END IF;

  IF v_existing.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Posting failure % is already resolved.', p_id;
  END IF;

  UPDATE posting_failures
  SET
    resolved_at = now(),
    resolved_by = auth.uid(),
    resolution_note = NULLIF(btrim(COALESCE(p_resolution_note, '')), '')
  WHERE id = p_id
    AND resolved_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Posting failure % is already resolved.', p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION resolve_posting_failure(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_posting_failure(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_posting_failure(uuid, text) TO authenticated;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_entity uuid := gen_random_uuid();
  v_failure_id uuid;
  v_resolved_at timestamptz;
  v_resolved_by uuid;
  v_resolution_note text;
  v_err text;
  v_direct_insert_blocked boolean := false;
BEGIN
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles — cannot emulate require_role.';
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

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION
      'get_my_role() after JWT emulation is % — require_role would fail first.',
      get_my_role();
  END IF;

  -- 1. record_posting_failure as an authenticated owner/partner succeeds.
  v_failure_id := record_posting_failure(
    'sale_confirm',
    'sale',
    v_entity,
    NULL,
    'Sale confirmed but accounting posting failed.'
  );

  IF v_failure_id IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: record_posting_failure returned NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM posting_failures
    WHERE id = v_failure_id
      AND source_flow = 'sale_confirm'
      AND entity_type = 'sale'
      AND entity_id = v_entity
      AND resolved_at IS NULL
  ) THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: inserted row missing or unexpected';
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: record_posting_failure inserted %', v_failure_id;

  -- 2. Direct INSERT as authenticated is blocked by RLS.
  -- Temporary INSERT grant exists only in this rolled-back dry run so the
  -- failure is RLS (policy), not a missing table GRANT. Part 2 does not
  -- GRANT INSERT.
  GRANT INSERT ON TABLE posting_failures TO authenticated;

  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO posting_failures (
      source_flow,
      entity_type,
      entity_id,
      error_message
    )
    VALUES (
      'sale_confirm',
      'sale',
      gen_random_uuid(),
      'should be blocked by RLS'
    );
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO B FAIL: direct INSERT as authenticated succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      v_direct_insert_blocked := true;
      RAISE NOTICE 'SCENARIO B PASS (privilege): %', SQLERRM;
    WHEN others THEN
      RESET ROLE;
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%row-level security%'
         AND v_err NOT ILIKE '%new row violates%' THEN
        RAISE EXCEPTION 'SCENARIO B unexpected error: %', v_err;
      END IF;
      v_direct_insert_blocked := true;
      RAISE NOTICE 'SCENARIO B PASS (RLS): %', v_err;
  END;

  IF NOT v_direct_insert_blocked THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: direct INSERT was not blocked';
  END IF;

  -- 3. resolve_posting_failure as a non-owner/partner raises.
  UPDATE profiles
  SET role = 'seller'
  WHERE auth_user_id = v_actor;

  BEGIN
    PERFORM resolve_posting_failure(v_failure_id, 'should not work');
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION
      'SCENARIO C FAIL: resolve_posting_failure succeeded for seller';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION 'SCENARIO C unexpected error: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO C PASS: %', v_err;
  END;

  -- 4. resolve_posting_failure as owner/partner succeeds and stamps columns.
  PERFORM resolve_posting_failure(v_failure_id, 'Posted manually after the fact.');

  SELECT resolved_at, resolved_by, resolution_note
  INTO v_resolved_at, v_resolved_by, v_resolution_note
  FROM posting_failures
  WHERE id = v_failure_id;

  IF v_resolved_at IS NULL THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: resolved_at is NULL';
  END IF;

  IF v_resolved_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: resolved_by is % (expected %)',
      v_resolved_by, v_actor;
  END IF;

  IF v_resolution_note IS DISTINCT FROM 'Posted manually after the fact.' THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: resolution_note is %',
      v_resolution_note;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS: resolved_at=% resolved_by=%', v_resolved_at, v_resolved_by;

  -- 5. Second resolve on an already-resolved row raises.
  BEGIN
    PERFORM resolve_posting_failure(v_failure_id, 'again');
    RAISE EXCEPTION
      'SCENARIO E FAIL: second resolve_posting_failure succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%already resolved%' THEN
        RAISE EXCEPTION 'SCENARIO E unexpected error: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO E PASS: %', v_err;
  END;

  RAISE NOTICE 'sql/119 dry run: all scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- THE MIGRATION (apply this for real, after Part 1 has passed)
-- Copy everything between "-- >>> MIGRATION START" and
-- "-- <<< MIGRATION END" into the SQL Editor and run it inside
-- BEGIN; ... COMMIT;  (or run this whole block, which already wraps itself).
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

CREATE TABLE IF NOT EXISTS posting_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_flow text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  business_event_id uuid,
  error_message text NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users (id),
  resolution_note text,
  CONSTRAINT posting_failures_source_flow_check CHECK (
    source_flow IN (
      'purchase_receive',
      'sale_confirm',
      'quick_sale_confirm',
      'pos_confirm',
      'production_complete',
      'write_off_record'
    )
  ),
  CONSTRAINT posting_failures_error_message_not_blank CHECK (
    char_length(btrim(error_message)) > 0
  )
);

COMMENT ON TABLE posting_failures IS
  'Durable log of non-fatal Accounting posting failures after a physical operation already committed. Written only via record_posting_failure / resolve_posting_failure. SELECT is owner/partner only.';

CREATE INDEX IF NOT EXISTS posting_failures_unresolved_occurred_at_idx
  ON posting_failures (occurred_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE posting_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posting_failures_select_owner_partner ON posting_failures;
CREATE POLICY posting_failures_select_owner_partner
  ON posting_failures
  FOR SELECT
  USING (get_my_role() IN ('owner', 'partner'));

REVOKE ALL ON TABLE posting_failures FROM PUBLIC;
REVOKE ALL ON TABLE posting_failures FROM anon;
REVOKE ALL ON TABLE posting_failures FROM authenticated;
GRANT SELECT ON TABLE posting_failures TO authenticated;

CREATE OR REPLACE FUNCTION record_posting_failure(
  p_source_flow text,
  p_entity_type text,
  p_entity_id uuid,
  p_business_event_id uuid,
  p_error_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_message text;
BEGIN
  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity_id is required.';
  END IF;

  v_message := btrim(COALESCE(p_error_message, ''));
  IF v_message = '' THEN
    RAISE EXCEPTION 'error_message is required.';
  END IF;

  IF btrim(COALESCE(p_entity_type, '')) = '' THEN
    RAISE EXCEPTION 'entity_type is required.';
  END IF;

  INSERT INTO posting_failures (
    source_flow,
    entity_type,
    entity_id,
    business_event_id,
    error_message
  )
  VALUES (
    p_source_flow,
    btrim(p_entity_type),
    p_entity_id,
    p_business_event_id,
    v_message
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) IS
  'Insert one posting_failures row for a non-fatal Accounting posting failure. Callable by authenticated; bypasses RLS as SECURITY DEFINER. Does not require owner/partner — sellers may confirm sales whose journals fail.';

CREATE OR REPLACE FUNCTION resolve_posting_failure(
  p_id uuid,
  p_resolution_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing posting_failures%ROWTYPE;
  v_updated uuid;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Posting failure id is required.';
  END IF;

  SELECT *
  INTO v_existing
  FROM posting_failures
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posting failure % was not found.', p_id;
  END IF;

  IF v_existing.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Posting failure % is already resolved.', p_id;
  END IF;

  UPDATE posting_failures
  SET
    resolved_at = now(),
    resolved_by = auth.uid(),
    resolution_note = NULLIF(btrim(COALESCE(p_resolution_note, '')), '')
  WHERE id = p_id
    AND resolved_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Posting failure % is already resolved.', p_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION resolve_posting_failure(uuid, text) IS
  'Mark a posting_failures row resolved. Owner/partner only (require_role). Raises if the id is missing or already resolved.';

REVOKE ALL ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_posting_failure(text, text, uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION resolve_posting_failure(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_posting_failure(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION resolve_posting_failure(uuid, text) TO authenticated;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run AFTER Part 2
-- has committed, in a fresh SQL Editor tab, NOT inside a transaction).
-- 3a–3f are catalog queries (postgres / SQL Editor). They prove schema,
-- RLS policy text, GRANT/REVOKE catalog state, and that require_role is
-- in the committed function body. They do not prove REST-level anon
-- denial — that is 3g, a real curl with the anon/publishable key.
-- ============================================================================

-- 3a. Table shape
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'posting_failures'
ORDER BY ordinal_position;
-- Expect 10 rows, in this order:
--   id                 uuid         NO   gen_random_uuid()
--   occurred_at        timestamptz  NO   now()
--   source_flow        text         NO   null
--   entity_type        text         NO   null
--   entity_id          uuid         NO   null
--   business_event_id  uuid         YES  null
--   error_message      text         NO   null
--   resolved_at        timestamptz  YES  null
--   resolved_by        uuid         YES  null
--   resolution_note    text         YES  null

-- 3b. CHECK + FK constraints
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.posting_failures'::regclass
ORDER BY conname;
-- Expect posting_failures_source_flow_check listing the six source_flow
-- values, posting_failures_error_message_not_blank, a PK on id, and an
-- FK from resolved_by to auth.users(id).

-- 3c. RLS enabled + SELECT policy text
SELECT c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'posting_failures';
-- Expect: relrowsecurity = true.

SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check
FROM pg_policy
WHERE polrelid = 'public.posting_failures'::regclass;
-- Expect: exactly one policy, posting_failures_select_owner_partner,
-- polcmd = 'r' (SELECT), using_expr contains get_my_role() IN
-- ('owner', 'partner') (Postgres may normalize IN to = ANY (ARRAY[...])),
-- with_check IS NULL. No INSERT/UPDATE/DELETE policies.

-- 3d. Table grants — SELECT for authenticated only; no INSERT/UPDATE/DELETE
--     for PUBLIC, anon, or authenticated
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'posting_failures'
ORDER BY grantee, privilege_type;
-- Expect: authenticated + SELECT, and nothing else (no INSERT/UPDATE/
-- DELETE for PUBLIC, anon, or authenticated). postgres/supabase_admin
-- owner grants may also appear; ignore those.

-- 3e. Function EXECUTE — blocked for anon/PUBLIC, allowed for authenticated
SELECT
  'record_posting_failure' AS fn,
  has_function_privilege(
    'anon',
    'record_posting_failure(text, text, uuid, uuid, text)',
    'EXECUTE'
  ) AS anon_can_execute,
  has_function_privilege(
    'authenticated',
    'record_posting_failure(text, text, uuid, uuid, text)',
    'EXECUTE'
  ) AS authenticated_can_execute
UNION ALL
SELECT
  'resolve_posting_failure',
  has_function_privilege(
    'anon',
    'resolve_posting_failure(uuid, text)',
    'EXECUTE'
  ),
  has_function_privilege(
    'authenticated',
    'resolve_posting_failure(uuid, text)',
    'EXECUTE'
  );
-- Expect two rows: anon_can_execute = false, authenticated_can_execute =
-- true.

SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('record_posting_failure', 'resolve_posting_failure')
  AND grantee = 'PUBLIC';
-- Expect 0 rows.

-- 3f. Structural proof that require_role('owner', 'partner') is in the
-- committed body of resolve_posting_failure. Catalog-only; does not prove
-- the gate fires at runtime (that is Part 1 scenarios C/D).
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  position('require_role' in pg_get_functiondef(p.oid)) > 0 AS has_require_role
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'resolve_posting_failure';
-- Expect: one row, args = 'p_id uuid, p_resolution_note text',
-- has_require_role = true.

-- 3g. Real REST-level anon denial (sql/074 / CLAUDE_WORKFLOW.md). The SQL
-- Editor always runs as postgres, so 3e cannot prove PostgREST actually
-- rejects anon. Run these from a shell against the SAME database Part 2
-- was applied to. Use the project's anon/publishable key as BOTH apikey
-- and Authorization Bearer (that is an unauthenticated anon request).
--
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/record_posting_failure" \
--     -H "apikey: $SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_source_flow":"sale_confirm","p_entity_type":"sale","p_entity_id":"00000000-0000-4000-8000-000000000000","p_business_event_id":null,"p_error_message":"anon probe"}'
--
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/resolve_posting_failure" \
--     -H "apikey: $SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_id":"00000000-0000-4000-8000-000000000000","p_resolution_note":"anon probe"}'
--
-- Expect both: HTTP 401/403 with a JSON body like
-- {"code":"42501","message":"permission denied for function ..."}
-- (or PostgREST's equivalent permission-denied wrapper). NOT HTTP 200.
-- A 200 would mean EXECUTE is still granted to anon and Part 2's
-- REVOKE FROM anon did not take effect.
