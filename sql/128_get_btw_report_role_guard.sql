-- Role-guard get_btw_report (deferred in sql/099).
--
-- Run in Supabase SQL editor after sql/127_record_write_off_reject_zero_cost.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's
-- money-critical / access-control protocol:
--   Part 1 dry run (BEGIN...ROLLBACK, self-contained, proves itself and
--          leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone post-commit verification queries run OUTSIDE any
--          transaction
--
-- Why this exists:
--   sql/095 created get_btw_report as SECURITY DEFINER with
--   GRANT EXECUTE TO authenticated and no require_role. sql/099
--   explicitly did not add a role check on this read-only report RPC
--   ("Does NOT: add role checks to read-only report RPCs
--   (get_btw_report, ...)"). Any authenticated session, including a
--   seller, can call rpc/get_btw_report and read VAT declaration
--   figures. DEFINER bypasses journal_entries RLS (sql/117).
--
-- Live body: sql/095 is the only CREATE OR REPLACE FUNCTION
-- get_btw_report in the repo. Nothing after 095 replaces it. This file
-- is that body plus one first statement:
--   PERFORM require_role('owner', 'partner');
-- same placement as get_profit_and_loss (sql/121). Year/quarter
-- validation and the jsonb_build_object keys are unchanged.
--
-- GRANT/REVOKE (verified in repo, not by querying a live catalog in
-- this session): sql/095 is the last (and only) file that sets ACLs on
-- this function:
--   REVOKE ALL FROM PUBLIC
--   REVOKE ALL FROM anon
--   GRANT EXECUTE TO authenticated
-- No later sql/*.sql GRANT/REVOKE or CREATE OR REPLACE on
-- get_btw_report. CREATE OR REPLACE does not reset ACL when the
-- signature is unchanged; Part 1 and Part 2 restate the same three
-- statements so a replay on a fresh database matches live.
--
-- Does NOT:
--   - change the report JSON keys, types, or formulas
--   - write journal_entries / journal_lines / ledger_entries
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back). Copy everything between "-- >>> DRY RUN START" and
-- "-- <<< DRY RUN END" into the Supabase SQL Editor and run it FIRST.
--
--   (A) owner  — get_btw_report returns a jsonb report for the current
--       quarter
--   (B) partner — same (real partner row, or temporary flip of the
--       owner row; rolled back)
--   (C) seller (temporary flip) — 42501 /
--       "Insufficient permissions for this action (role: seller)."
--       and no payload
--   (D) owner success payload has exactly the sql/095 key set and
--       types (no extra/missing columns)
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION get_btw_report(
  p_year integer,
  p_quarter integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_rubriek_1a_revenue numeric(12, 2) := 0;
  v_rubriek_1a_vat numeric(12, 2) := 0;
  v_rubriek_1b_revenue numeric(12, 2);
  v_rubriek_1b_vat numeric(12, 2);
  v_rubriek_5a numeric(12, 2);
  v_rubriek_5b numeric(12, 2);
  v_rubriek_5c numeric(12, 2);
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'Year must be a valid year.';
  END IF;
  IF p_quarter IS NULL OR p_quarter NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Quarter must be 1, 2, 3, or 4.';
  END IF;

  v_start := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end := (v_start + interval '3 months' - interval '1 day')::date;

  -- Rubriek 1b: 9% sales revenue + output VAT, from posted journal_lines
  -- on Sales Revenue (4000) and VAT Output (2100) accounts.
  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_revenue
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '4000'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_vat
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '2100'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  -- Rubriek 5b: deductible input VAT, from posted journal_lines on
  -- VAT Input (1200). Input VAT is a debit-normal asset account, so the
  -- deductible amount is debit minus credit (mirrors 1b's credit-minus-debit
  -- for the liability-normal VAT Output account).
  SELECT COALESCE(SUM(jl.debit_transaction - jl.credit_transaction), 0)
  INTO v_rubriek_5b
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '1200'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  v_rubriek_5a := round(v_rubriek_1a_vat + v_rubriek_1b_vat, 2);
  v_rubriek_5c := round(v_rubriek_5a - v_rubriek_5b, 2);

  RETURN jsonb_build_object(
    'year', p_year,
    'quarter', p_quarter,
    'period_start', v_start,
    'period_end', v_end,
    'rubriek_1a_revenue', v_rubriek_1a_revenue,
    'rubriek_1a_vat', v_rubriek_1a_vat,
    'rubriek_1b_revenue', round(v_rubriek_1b_revenue, 2),
    'rubriek_1b_vat', round(v_rubriek_1b_vat, 2),
    'rubriek_5a_total_vat_due', v_rubriek_5a,
    'rubriek_5b_input_vat_deductible', round(v_rubriek_5b, 2),
    'rubriek_5c_balance', v_rubriek_5c,
    'balance_direction', CASE
      WHEN v_rubriek_5c > 0 THEN 'to_pay'
      WHEN v_rubriek_5c < 0 THEN 'to_receive'
      ELSE 'zero'
    END
  );
END;
$$;

COMMENT ON FUNCTION get_btw_report(integer, integer) IS
  'Quarterly NL BTW declaration aggregate (rubrieken 1a/1b/5a/5b/5c) from posted journal_lines. Read-only, always a live recompute, no persisted history. Requires owner/partner (sql/128).';

REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_btw_report(integer, integer) TO authenticated;

CREATE FUNCTION assert_btw_report_shape_128(
  p_payload jsonb,
  p_year integer,
  p_quarter integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_keys text[];
  v_expected text[] := ARRAY[
    'balance_direction',
    'period_end',
    'period_start',
    'quarter',
    'rubriek_1a_revenue',
    'rubriek_1a_vat',
    'rubriek_1b_revenue',
    'rubriek_1b_vat',
    'rubriek_5a_total_vat_due',
    'rubriek_5b_input_vat_deductible',
    'rubriek_5c_balance',
    'year'
  ];
  v_start date := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end date := (v_start + interval '3 months' - interval '1 day')::date;
  v_direction text;
  v_numeric_key text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'BTW report payload is not a jsonb object (%)', p_payload;
  END IF;

  SELECT array_agg(k ORDER BY k)
  INTO v_keys
  FROM jsonb_object_keys(p_payload) AS k;

  IF v_keys IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      'BTW report keys changed (got %; expected %)',
      v_keys, v_expected;
  END IF;

  IF (p_payload ->> 'year')::integer IS DISTINCT FROM p_year
     OR (p_payload ->> 'quarter')::integer IS DISTINCT FROM p_quarter THEN
    RAISE EXCEPTION
      'BTW report year/quarter mismatch (got %/%; expected %/%)',
      p_payload ->> 'year', p_payload ->> 'quarter', p_year, p_quarter;
  END IF;

  IF (p_payload ->> 'period_start')::date IS DISTINCT FROM v_start
     OR (p_payload ->> 'period_end')::date IS DISTINCT FROM v_end THEN
    RAISE EXCEPTION
      'BTW report period mismatch (got %..%; expected %..%)',
      p_payload ->> 'period_start', p_payload ->> 'period_end',
      v_start, v_end;
  END IF;

  v_direction := p_payload ->> 'balance_direction';
  IF v_direction IS DISTINCT FROM 'to_pay'
     AND v_direction IS DISTINCT FROM 'to_receive'
     AND v_direction IS DISTINCT FROM 'zero' THEN
    RAISE EXCEPTION 'BTW report balance_direction is invalid (%)', v_direction;
  END IF;

  FOREACH v_numeric_key IN ARRAY ARRAY[
    'rubriek_1a_revenue',
    'rubriek_1a_vat',
    'rubriek_1b_revenue',
    'rubriek_1b_vat',
    'rubriek_5a_total_vat_due',
    'rubriek_5b_input_vat_deductible',
    'rubriek_5c_balance'
  ]
  LOOP
    IF jsonb_typeof(p_payload -> v_numeric_key) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION
        'BTW report % is not a number (%)',
        v_numeric_key, p_payload -> v_numeric_key;
    END IF;
  END LOOP;
END;
$$;

DO $test$
DECLARE
  v_actor uuid;
  v_partner uuid;
  v_original_role text;
  v_claims text;
  v_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_quarter integer := EXTRACT(QUARTER FROM CURRENT_DATE)::integer;
  v_result jsonb;
  v_err text;
  v_sqlstate text;
  v_raised boolean;
  v_expected_seller text :=
    'Insufficient permissions for this action (role: seller).';
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

  RAISE NOTICE 'JWT emulated auth.uid()=% get_my_role()=%', auth.uid(), get_my_role();

  -- ========================================================================
  -- SCENARIO A: owner (or the preferred owner/partner row) gets a report
  -- ========================================================================
  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_actor;
  END IF;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: could not emulate owner (role=%)', get_my_role();
  END IF;

  v_result := get_btw_report(v_year, v_quarter);

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: get_btw_report returned NULL';
  END IF;

  PERFORM assert_btw_report_shape_128(v_result, v_year, v_quarter);

  RAISE NOTICE 'SCENARIO A PASS: owner get_btw_report % Q% → %',
    v_year, v_quarter, v_result ->> 'balance_direction';

  -- ========================================================================
  -- SCENARIO D: same owner payload — exact sql/095 key set (no extras)
  -- ========================================================================
  PERFORM assert_btw_report_shape_128(v_result, v_year, v_quarter);

  RAISE NOTICE 'SCENARIO D PASS: 12 keys, types, and period bounds unchanged';

  -- ========================================================================
  -- SCENARIO B: partner — real partner JWT, or temporary flip
  -- ========================================================================
  SELECT p.auth_user_id
  INTO v_partner
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'partner'
    AND p.auth_user_id IS DISTINCT FROM v_actor
  ORDER BY p.auth_user_id
  LIMIT 1;

  IF v_partner IS NOT NULL THEN
    v_claims := json_build_object(
      'sub', v_partner::text,
      'role', 'authenticated'
    )::text;
    PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', v_claims, true);

    IF auth.uid() IS DISTINCT FROM v_partner
       OR get_my_role() IS DISTINCT FROM 'partner' THEN
      RAISE EXCEPTION
        'SCENARIO B FAIL: partner JWT emulation failed (uid=% role=%)',
        auth.uid(), get_my_role();
    END IF;
  ELSE
    UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_actor;
    IF get_my_role() IS DISTINCT FROM 'partner' THEN
      RAISE EXCEPTION
        'SCENARIO B FAIL: could not emulate partner (role=%)', get_my_role();
    END IF;
  END IF;

  v_result := get_btw_report(v_year, v_quarter);

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: get_btw_report returned NULL';
  END IF;

  PERFORM assert_btw_report_shape_128(v_result, v_year, v_quarter);

  RAISE NOTICE 'SCENARIO B PASS: partner get_btw_report % Q%', v_year, v_quarter;

  -- Restore owner JWT / role before the seller flip.
  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ========================================================================
  -- SCENARIO C: seller is rejected; no payload
  -- ========================================================================
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  v_result := NULL;
  v_raised := false;
  BEGIN
    v_result := get_btw_report(v_year, v_quarter);
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION 'SCENARIO C FAIL: seller-role caller unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err IS DISTINCT FROM v_expected_seller THEN
        RAISE EXCEPTION
          'SCENARIO C unexpected error (sqlstate=%): % (expected 42501 / %)',
          v_sqlstate, v_err, v_expected_seller;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO C PASS (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller-role caller was not blocked';
  END IF;

  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: get_btw_report returned data for seller (%)', v_result;
  END IF;

  IF (SELECT role FROM profiles WHERE auth_user_id = v_actor)
     IS DISTINCT FROM v_original_role THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: profiles.role was not restored';
  END IF;

  RAISE NOTICE 'sql/128 dry run: all scenarios passed';
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

CREATE OR REPLACE FUNCTION get_btw_report(
  p_year integer,
  p_quarter integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_rubriek_1a_revenue numeric(12, 2) := 0;
  v_rubriek_1a_vat numeric(12, 2) := 0;
  v_rubriek_1b_revenue numeric(12, 2);
  v_rubriek_1b_vat numeric(12, 2);
  v_rubriek_5a numeric(12, 2);
  v_rubriek_5b numeric(12, 2);
  v_rubriek_5c numeric(12, 2);
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'Year must be a valid year.';
  END IF;
  IF p_quarter IS NULL OR p_quarter NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Quarter must be 1, 2, 3, or 4.';
  END IF;

  v_start := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end := (v_start + interval '3 months' - interval '1 day')::date;

  -- Rubriek 1b: 9% sales revenue + output VAT, from posted journal_lines
  -- on Sales Revenue (4000) and VAT Output (2100) accounts.
  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_revenue
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '4000'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_vat
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '2100'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  -- Rubriek 5b: deductible input VAT, from posted journal_lines on
  -- VAT Input (1200). Input VAT is a debit-normal asset account, so the
  -- deductible amount is debit minus credit (mirrors 1b's credit-minus-debit
  -- for the liability-normal VAT Output account).
  SELECT COALESCE(SUM(jl.debit_transaction - jl.credit_transaction), 0)
  INTO v_rubriek_5b
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '1200'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  v_rubriek_5a := round(v_rubriek_1a_vat + v_rubriek_1b_vat, 2);
  v_rubriek_5c := round(v_rubriek_5a - v_rubriek_5b, 2);

  RETURN jsonb_build_object(
    'year', p_year,
    'quarter', p_quarter,
    'period_start', v_start,
    'period_end', v_end,
    'rubriek_1a_revenue', v_rubriek_1a_revenue,
    'rubriek_1a_vat', v_rubriek_1a_vat,
    'rubriek_1b_revenue', round(v_rubriek_1b_revenue, 2),
    'rubriek_1b_vat', round(v_rubriek_1b_vat, 2),
    'rubriek_5a_total_vat_due', v_rubriek_5a,
    'rubriek_5b_input_vat_deductible', round(v_rubriek_5b, 2),
    'rubriek_5c_balance', v_rubriek_5c,
    'balance_direction', CASE
      WHEN v_rubriek_5c > 0 THEN 'to_pay'
      WHEN v_rubriek_5c < 0 THEN 'to_receive'
      ELSE 'zero'
    END
  );
END;
$$;

COMMENT ON FUNCTION get_btw_report(integer, integer) IS
  'Quarterly NL BTW declaration aggregate (rubrieken 1a/1b/5a/5b/5c) from posted journal_lines. Read-only, always a live recompute, no persisted history. Requires owner/partner (sql/128).';

REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_btw_report(integer, integer) TO authenticated;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run AFTER Part 2
-- has committed, in a fresh SQL Editor tab, NOT inside a transaction).
-- Catalog-only: proves require_role is in the committed body. Does not
-- re-run the scenarios (those are Part 1).
-- ============================================================================

SELECT
  pg_get_functiondef('public.get_btw_report'::regproc)
    LIKE '%require_role%'
    AS has_require_role,
  pg_get_functiondef('public.get_btw_report'::regproc)
    LIKE '%owner%'
    AND pg_get_functiondef('public.get_btw_report'::regproc)
    LIKE '%partner%'
    AS has_owner_partner_args;
-- Expect: true, true.
