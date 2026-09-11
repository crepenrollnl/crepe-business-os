-- Atomic Purchases Receive: status transition + all line stock/cost
-- updates in one transaction.
--
-- Run in Supabase SQL editor after sql/111_reject_zero_cost_purchase_receive.sql
-- (and after sql/098_role_guard_purchases_production.sql, which introduced
-- require_role on this module).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Problem this fixes (2026-09-08 system audit, Data integrity &
-- money-correctness, Finding 1 — Critical):
--   receivePurchase() (src/features/purchases/services/purchase-service.ts)
--   ran Receive as a client-orchestrated, non-atomic saga:
--     1. A plain SELECT checked status = 'draft'.
--     2. A separate UPDATE purchases SET status = 'received' ran with no
--        status = 'draft' guard in its own WHERE clause — a check-then-act
--        race letting two concurrent Receive calls (double-click, two
--        tabs, a retried request after a dropped tablet connection) both
--        pass the check and both proceed.
--     3. The code then looped over purchase lines calling
--        receive_purchase_line_stock_and_cost once PER LINE, sequentially
--        — N separate network round trips, not one transaction.
--     4. On a later-line failure, it manually called
--        reverse_receive_purchase_line_stock_and_cost on already-applied
--        lines, and if THAT failed, returned the literal string "stock
--        and unit cost may now be inconsistent" — an acknowledged,
--        unresolved failure mode.
--     5. Status was then reset back to draft in a fourth, independent
--        statement.
--   Net effect: a real risk of double-incrementing ingredients.current_stock
--   and corrupting the weighted-average cost_per_unit, or leaving a
--   purchase in an indeterminate state after a partial failure.
--
-- Fix: one SECURITY DEFINER function that locks the purchase row, re-checks
-- status under that lock, applies every line inside the same transaction by
-- calling the existing per-line function (not duplicating its formula), and
-- flips status to received only if every line succeeded. Any failure raises
-- and the whole transaction rolls back automatically — no manual per-line
-- reversal is written or needed.
--
-- Does NOT:
--   - change receive_purchase_line_stock_and_cost (sql/105, tightened by
--     sql/111) — reused as-is via a plain function call inside the loop,
--     so the weighted-average formula and the zero-cost guard stay
--     defined in exactly one place
--   - change or drop reverse_receive_purchase_line_stock_and_cost (sql/105)
--     — it becomes unused by the application after this migration (the TS
--     layer no longer calls it) but is left in place; dropping unused
--     functions is a separate, deliberate cleanup, not bundled here
--   - change how purchase header/lines are saved before Receive — the TS
--     layer still calls persistPurchase(input, "draft") first, unchanged,
--     so editing the purchase while receiving it still works exactly as
--     before
--   - post an accounting journal — Purchases still only proposes a journal
--     preview (purchaseAccountingService.proposeJournalForPurchaseReceived);
--     it does not post to journal_entries/ledger_entries. That is a
--     separate, already-tracked audit finding, out of scope here.

-- ============================================================================
-- PART 1 of 3 — DRY RUN (safe to run first; self-contained, self-rolling-back)
-- ----------------------------------------------------------------------------
-- Copy everything between "-- >>> DRY RUN START" and "-- <<< DRY RUN END"
-- into the Supabase SQL Editor and run it FIRST, before Part 2. This block
-- is fully self-contained: it creates receive_purchase() itself (identical
-- to the CREATE OR REPLACE FUNCTION / COMMENT / REVOKE / GRANT statements in
-- Part 2 below), then exercises it against throwaway fixtures, all inside
-- one BEGIN ... ROLLBACK. Nothing persists at the end — including the
-- function definition itself — so this is safe to run against a database
-- that has never seen sql/116 before, and safe to re-run any number of
-- times before deciding to apply Part 2 for real.
--
-- It creates the function, a throwaway supplier, four throwaway
-- ingredients, and two throwaway draft purchases, entirely inside the same
-- transaction.
--
-- SQL Editor runs as postgres with no PostgREST JWT, so auth.uid() would
-- otherwise be NULL and require_role('owner','partner') would immediately
-- reject the call. This script emulates a real owner/partner JWT the same
-- way sql/106_empirical_zero_cost_guard_dev.sql does, by setting the GUCs
-- auth.uid() reads for an existing active owner/partner profile row. It
-- does not patch require_role or auth.uid() themselves.
--
-- Expected output: a sequence of "SCENARIO ... PASS" NOTICEs, then ROLLBACK.
-- Any other error means the harness or the function needs a fix — it does
-- not mean "the fix is fine, ignore it". If the script aborts before
-- ROLLBACK for any reason, run ROLLBACK; manually before doing anything else.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION receive_purchase(
  p_purchase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_item record;
  v_line_count integer := 0;
  v_updated integer;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Purchase id is required.';
  END IF;

  SELECT *
  INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase was not found.';
  END IF;

  IF v_purchase.status = 'received' THEN
    RAISE EXCEPTION 'This purchase has already been received.';
  END IF;

  IF v_purchase.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft purchases can be received.';
  END IF;

  FOR v_item IN
    SELECT ingredient_id, quantity, unit_cost
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
    ORDER BY created_at ASC, id ASC
  LOOP
    -- Reuses sql/105/111 as the single source of truth for the weighted-
    -- average formula and the zero-cost guard. This is a plain function
    -- call inside the current transaction, not a separate client round
    -- trip, so a RAISE here aborts this whole function's transaction —
    -- no partial stock/cost change persists for any line, and no manual
    -- reversal is performed or needed.
    PERFORM receive_purchase_line_stock_and_cost(
      v_item.ingredient_id,
      v_item.quantity,
      v_item.unit_cost
    );
    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'This purchase has no lines to receive.';
  END IF;

  UPDATE purchases
  SET
    status = 'received',
    updated_at = v_now
  WHERE id = p_purchase_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This purchase has already been received.';
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', p_purchase_id,
    'status', 'received',
    'lines_received', v_line_count,
    'received_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION receive_purchase(uuid) IS
  'Purchases Receive: atomically locks the purchase row FOR UPDATE, re-checks status = draft under that lock, applies receive_purchase_line_stock_and_cost (sql/105, tightened by sql/111) for every purchase line inside the same transaction, then flips status to received only if every line succeeded. Any line failure raises and rolls back the whole receive; no manual per-line reversal is needed or performed.';

REVOKE ALL ON FUNCTION receive_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_purchase(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION receive_purchase(uuid) TO authenticated;

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_supplier_id uuid;
  v_ing_a uuid;
  v_ing_b uuid;
  v_ing_c uuid;
  v_ing_d uuid;

  v_purchase_1 uuid;
  v_purchase_2 uuid;

  v_expected_cost_a numeric;
  v_expected_cost_b numeric;

  v_stock numeric;
  v_cost numeric;
  v_status text;

  v_result jsonb;
  v_err text;
BEGIN
  -- --- Emulate an authenticated owner/partner JWT (see header note) -------
  SELECT p.auth_user_id
  INTO v_actor
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

  -- --- Fixtures -------------------------------------------------------------
  INSERT INTO suppliers (code, name)
  VALUES ('TEST-116-' || v_suffix, 'TEST_RECEIVE_ATOMIC_116_supplier_' || v_suffix)
  RETURNING id INTO v_supplier_id;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RECEIVE_ATOMIC_116_ing_A_' || v_suffix, 'kg', 100, 0, 2.00, true)
  RETURNING id INTO v_ing_a;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RECEIVE_ATOMIC_116_ing_B_' || v_suffix, 'kg', 50, 0, 4.00, true)
  RETURNING id INTO v_ing_b;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RECEIVE_ATOMIC_116_ing_C_' || v_suffix, 'kg', 20, 0, 1.50, true)
  RETURNING id INTO v_ing_c;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RECEIVE_ATOMIC_116_ing_D_' || v_suffix, 'kg', 30, 0, 2.50, true)
  RETURNING id INTO v_ing_d;

  -- ------------------------------------------------------------------------
  -- Scenario A: happy path — two lines, verify weighted-average stock/cost
  -- and the status flip, using the SAME formula as receive_purchase_line_
  -- stock_and_cost so this assertion can never drift from the real one.
  -- ------------------------------------------------------------------------
  INSERT INTO purchases (supplier_id, status)
  VALUES (v_supplier_id, 'draft')
  RETURNING id INTO v_purchase_1;

  INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total)
  VALUES
    (v_purchase_1, v_ing_a, 10, 3.00, 30.00),
    (v_purchase_1, v_ing_b, 5, 6.00, 30.00);

  -- Round to 2 decimals, matching ingredients.cost_per_unit's actual column
  -- scale (numeric(12,2), sql/000) — not the 4-decimal precision used inside
  -- receive_purchase_line_stock_and_cost's own round(...) call. That internal
  -- round(...,4) is harmless but moot: Postgres silently re-rounds any value
  -- assigned to a numeric(12,2) column down to 2 decimals on storage, so a
  -- 4-decimal expected value here could never actually match what's stored.
  v_expected_cost_a := round((100 * 2.00 + 10 * 3.00) / (100 + 10), 2);
  v_expected_cost_b := round((50 * 4.00 + 5 * 6.00) / (50 + 5), 2);

  v_result := receive_purchase(v_purchase_1);
  RAISE NOTICE 'SCENARIO A receive_purchase result: %', v_result;

  SELECT status INTO v_status FROM purchases WHERE id = v_purchase_1;
  IF v_status IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: purchase status is % (expected received)', v_status;
  END IF;

  SELECT current_stock, cost_per_unit INTO v_stock, v_cost FROM ingredients WHERE id = v_ing_a;
  IF v_stock IS DISTINCT FROM 110 OR v_cost IS DISTINCT FROM v_expected_cost_a THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: ingredient A stock=% cost=% (expected stock=110 cost=%)',
      v_stock, v_cost, v_expected_cost_a;
  END IF;

  SELECT current_stock, cost_per_unit INTO v_stock, v_cost FROM ingredients WHERE id = v_ing_b;
  IF v_stock IS DISTINCT FROM 55 OR v_cost IS DISTINCT FROM v_expected_cost_b THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: ingredient B stock=% cost=% (expected stock=55 cost=%)',
      v_stock, v_cost, v_expected_cost_b;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: status=received, ingredient A stock=110 cost=%, ingredient B stock=55 cost=%',
    v_expected_cost_a, v_expected_cost_b;

  -- ------------------------------------------------------------------------
  -- Scenario B: the actual bug being fixed — receiving the SAME purchase a
  -- second time (simulating two concurrent Receive calls both reaching the
  -- database) must be rejected, not double-increment stock again.
  -- ------------------------------------------------------------------------
  BEGIN
    v_result := receive_purchase(v_purchase_1);
    RAISE EXCEPTION
      'SCENARIO B FAIL: second receive_purchase call succeeded (%); expected rejection',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%already been received%' THEN
        RAISE EXCEPTION 'SCENARIO B unexpected error: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO B PASS: %', v_err;
  END;

  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing_a;
  IF v_stock IS DISTINCT FROM 110 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: ingredient A stock changed to % on the rejected second receive',
      v_stock;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: ingredient A stock unchanged at 110 after the rejected re-receive';

  -- ------------------------------------------------------------------------
  -- Scenario C: whole-purchase atomicity — a purchase with one valid line
  -- (C) and one zero-cost line (D, rejected by sql/111) must apply NEITHER
  -- line and must NOT flip status, proving there is no partial application
  -- left for a manual reversal to clean up.
  -- ------------------------------------------------------------------------
  INSERT INTO purchases (supplier_id, status)
  VALUES (v_supplier_id, 'draft')
  RETURNING id INTO v_purchase_2;

  INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total)
  VALUES
    (v_purchase_2, v_ing_c, 4, 5.00, 20.00),
    (v_purchase_2, v_ing_d, 2, 0, 0);

  BEGIN
    v_result := receive_purchase(v_purchase_2);
    RAISE EXCEPTION
      'SCENARIO C FAIL: receive_purchase succeeded (%); expected zero-cost rejection',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%no net unit cost%' THEN
        RAISE EXCEPTION 'SCENARIO C unexpected error: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO C PASS: rejected with %', v_err;
  END;

  SELECT current_stock, cost_per_unit INTO v_stock, v_cost FROM ingredients WHERE id = v_ing_c;
  IF v_stock IS DISTINCT FROM 20 OR v_cost IS DISTINCT FROM 1.50 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: ingredient C (the VALID line, processed first) was still updated: stock=% cost=% (expected untouched: stock=20 cost=1.50)',
      v_stock, v_cost;
  END IF;

  SELECT status INTO v_status FROM purchases WHERE id = v_purchase_2;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: purchase status is % (expected draft — receive must not partially apply)',
      v_status;
  END IF;

  RAISE NOTICE
    'SCENARIO C PASS: ingredient C untouched (stock=20 cost=1.50) and purchase 2 still draft — the earlier valid line was NOT applied when a later line failed';

  RAISE NOTICE 'sql/116 dry run: all scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 — THE MIGRATION (apply this for real, after Part 1 has passed)
-- ============================================================================

CREATE OR REPLACE FUNCTION receive_purchase(
  p_purchase_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_item record;
  v_line_count integer := 0;
  v_updated integer;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'Purchase id is required.';
  END IF;

  SELECT *
  INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase was not found.';
  END IF;

  IF v_purchase.status = 'received' THEN
    RAISE EXCEPTION 'This purchase has already been received.';
  END IF;

  IF v_purchase.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft purchases can be received.';
  END IF;

  FOR v_item IN
    SELECT ingredient_id, quantity, unit_cost
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
    ORDER BY created_at ASC, id ASC
  LOOP
    -- Reuses sql/105/111 as the single source of truth for the weighted-
    -- average formula and the zero-cost guard. This is a plain function
    -- call inside the current transaction, not a separate client round
    -- trip, so a RAISE here aborts this whole function's transaction —
    -- no partial stock/cost change persists for any line, and no manual
    -- reversal is performed or needed.
    PERFORM receive_purchase_line_stock_and_cost(
      v_item.ingredient_id,
      v_item.quantity,
      v_item.unit_cost
    );
    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'This purchase has no lines to receive.';
  END IF;

  UPDATE purchases
  SET
    status = 'received',
    updated_at = v_now
  WHERE id = p_purchase_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This purchase has already been received.';
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', p_purchase_id,
    'status', 'received',
    'lines_received', v_line_count,
    'received_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION receive_purchase(uuid) IS
  'Purchases Receive: atomically locks the purchase row FOR UPDATE, re-checks status = draft under that lock, applies receive_purchase_line_stock_and_cost (sql/105, tightened by sql/111) for every purchase line inside the same transaction, then flips status to received only if every line succeeded. Any line failure raises and rolls back the whole receive; no manual per-line reversal is needed or performed.';

REVOKE ALL ON FUNCTION receive_purchase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_purchase(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION receive_purchase(uuid) TO authenticated;

-- ============================================================================
-- PART 3 of 3 — POST-APPLY VERIFICATION (run standalone, NOT inside the
-- migration transaction — safe to run any time after a real COMMIT)
-- ============================================================================

-- 3a. Confirm the function exists, is SECURITY DEFINER, and is granted to
--     authenticated only (not PUBLIC, not anon). Run this once right after
--     applying Part 2.
SELECT
  p.proname AS function_name,
  p.prosecdef AS is_security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
WHERE p.proname = 'receive_purchase';
-- Expect exactly one row: is_security_definer = true,
-- authenticated_can_execute = true, anon_can_execute = false,
-- public_can_execute = false.

-- 3b. After a REAL purchase has been received through the app, confirm its
--     status and every line's ingredient stock/cost reflect the receive.
--     Replace :purchase_id with the purchase's id (from the Purchases list
--     or the purchases table) before running.
-- SELECT
--   pur.id AS purchase_id,
--   pur.status,
--   pur.updated_at,
--   pi.ingredient_id,
--   ing.name AS ingredient_name,
--   pi.quantity AS purchase_line_quantity,
--   pi.unit_cost AS purchase_line_unit_cost,
--   ing.current_stock AS ingredient_current_stock,
--   ing.cost_per_unit AS ingredient_cost_per_unit
-- FROM purchases pur
-- JOIN purchase_items pi ON pi.purchase_id = pur.id
-- JOIN ingredients ing ON ing.id = pi.ingredient_id
-- WHERE pur.id = :purchase_id
-- ORDER BY pi.created_at;
-- Expect pur.status = 'received' and, for each line, ingredient_current_stock
-- to have increased by purchase_line_quantity relative to its pre-receive
-- value (check against stock_movements/audit history if available, since
-- current_stock is a live running total, not a point-in-time snapshot).
