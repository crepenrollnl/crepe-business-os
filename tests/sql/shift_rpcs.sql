-- SQL test: sql/142 — open_shift / close_shift / reconcile_shift_cash (audit S1 step 4a).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/shift_rpcs.sql
-- (exit 0) after a full replay of sql/*.sql.
--
-- Scenarios:
--   A — seller opens a shift (notes trimmed); a second open is refused
--   B — seller sells 2 + 1 dishes (one sale in status paid); reconciling an
--       open shift is refused
--   C — close_shift closes the shift and writes both summaries; counts,
--       gross, average and COGS are exact and pass verify_daily_sales_summary /
--       verify_daily_profit_summary; opened_by / closed_by = auth.uid();
--       closing again is refused
--   D — cash count: expected = opening + in - out, rounding, notes trimmed,
--       passes verify_cash_reconciliation; second count / negative refused
--   E — an empty shift closes with zero summaries (margin NULL), POS-style
--       count (counted only) gives expected 0
--   F — bad input (unknown / NULL shift, NULL counted cash)
--   G — no active profile → 42501 on all three; anon has no EXECUTE
--   H — SECURITY DEFINER, search_path, no PUBLIC grant
-- A shift open in real life is closed only inside the transaction;
-- sequence counters are restored.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun142_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S1S4_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;
  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S1S4_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;
  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;
  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S1S4_comp_' || p_tag,
          p_qty, p_qty, 'pcs', 1)
  RETURNING id INTO v_line;
  UPDATE production_sessions SET status = 'completed', completed_at = now()
  WHERE id = v_session;
  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id,
    recipe_id, produced_quantity, unit_cost, produced_at
  )
  VALUES (v_session, v_line, p_recipe_id, p_recipe_id, p_qty, p_unit_cost,
          now() - interval '1 hour')
  RETURNING id INTO v_batch;
  RETURN v_batch;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun142_expect(
  p_label text, p_sqlstate text, p_message_like text, p_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_state text;
  v_err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%] for: %',
          p_label, p_sqlstate, p_message_like, v_state, v_err, p_sql;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun142_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun142_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_seq record;
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_result jsonb;
  v_shift uuid;
  v_shift2 uuid;
  v_row shifts%ROWTYPE;
  v_ss shift_daily_sales_summaries%ROWTYPE;
  v_ps shift_daily_profit_summaries%ROWTYPE;
  v_rec shift_cash_reconciliations%ROWTYPE;
  v_sale1 uuid;
  v_sale2 uuid;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun142_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- A shift open in real life is closed only inside this transaction.
  UPDATE shifts SET status = 'closed', closed_at = now() WHERE status = 'open';

  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  -- Dish = 1 component (FIFO batch @ 2.00) + 0.2 kg ingredient @ 1.50 → COGS 2.30 each.
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_S1S4_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S4_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun142_batch(v_comp, 10, 2.00, v_tag);
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S4_dish_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- A. Seller opens a shift; a second open is refused.
  -- ------------------------------------------------------------------
  v_result := open_shift('  morning  ');
  v_shift := (v_result ->> 'id')::uuid;
  IF v_result ->> 'status' IS DISTINCT FROM 'open' OR v_result ->> 'notes' IS DISTINCT FROM 'morning' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: %', v_result;
  END IF;
  PERFORM public.dryrun142_expect('SCENARIO A2', 'P0001',
    'A shift is already open. Close it before opening another.', 'SELECT open_shift(NULL)');

  -- ------------------------------------------------------------------
  -- B. Seller sells 2 + 1 dishes in the shift.
  -- ------------------------------------------------------------------
  v_sale1 := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(jsonb_build_object('product_id', v_dish, 'quantity', 2, 'unit_price', 10.00)))
    ->> 'sale_id')::uuid;
  v_sale2 := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 5.00)))
    ->> 'sale_id')::uuid;

  -- One of the two sales is in status 'paid' — it must still count.
  RESET ROLE;
  UPDATE sales SET status = 'paid', paid_at = now() WHERE id = v_sale2;
  SET LOCAL ROLE authenticated;

  -- Reconciling an open shift is refused.
  PERFORM public.dryrun142_expect('SCENARIO B2', 'P0001', 'Close the shift before reconciling cash.',
    format('SELECT reconcile_shift_cash(%L::uuid, 10)', v_shift));

  -- ------------------------------------------------------------------
  -- C. Seller closes: shift closed + both summaries in one call; the
  --    numbers pass the existing verify_* functions; repeat refused.
  -- ------------------------------------------------------------------
  v_result := close_shift(v_shift, NULL);

  RESET ROLE;
  SELECT * INTO v_row FROM shifts WHERE id = v_shift;
  SELECT * INTO v_ss FROM shift_daily_sales_summaries WHERE shift_id = v_shift;
  SELECT * INTO v_ps FROM shift_daily_profit_summaries WHERE shift_id = v_shift;
  IF v_row.status <> 'closed' OR v_row.closed_at IS NULL OR v_row.closed_by IS DISTINCT FROM v_actor
     OR v_row.opened_by IS DISTINCT FROM v_actor OR v_row.notes IS DISTINCT FROM 'morning' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: shift row %', row_to_json(v_row);
  END IF;
  IF v_ss.sales_count IS DISTINCT FROM 2 OR v_ss.items_sold IS DISTINCT FROM 3
     OR v_ps.total_cogs IS DISTINCT FROM 6.90
     OR v_ps.gross_profit IS DISTINCT FROM round(v_ps.net_revenue - 6.90, 2)
     OR v_ps.net_revenue IS DISTINCT FROM v_ss.net_revenue
     OR v_ss.gross_revenue IS DISTINCT FROM 25.00
     OR v_ss.average_receipt IS DISTINCT FROM 12.50 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: sales % / profit %', row_to_json(v_ss), row_to_json(v_ps);
  END IF;
  IF NOT verify_daily_sales_summary(v_shift, v_ss.sales_count, v_ss.items_sold,
                                    v_ss.gross_revenue, v_ss.net_revenue, v_ss.average_receipt)
     OR NOT verify_daily_profit_summary(v_shift, v_ps.net_revenue, v_ps.total_cogs,
                                        v_ps.gross_profit, v_ps.gross_margin_percent) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: summaries do not pass verify_* functions';
  END IF;
  IF (v_result -> 'shift' ->> 'status') IS DISTINCT FROM 'closed'
     OR (v_result -> 'sales_summary' ->> 'id')::uuid IS DISTINCT FROM v_ss.id
     OR (v_result -> 'profit_summary' ->> 'id')::uuid IS DISTINCT FROM v_ps.id THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: returned json %', v_result;
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun142_expect('SCENARIO C2', 'P0001', 'This shift is already closed.',
    format('SELECT close_shift(%L::uuid)', v_shift));

  -- ------------------------------------------------------------------
  -- D. Cash count: expected = 20 + 30 - 5 = 45, counted 50 → +5;
  --    second count refused; negative refused.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun142_expect('SCENARIO D1', 'P0001', 'Counted cash cannot be negative.',
    format('SELECT reconcile_shift_cash(%L::uuid, -1)', v_shift));
  v_result := reconcile_shift_cash(v_shift, 50.004, 20, 30, 5, ' till ok ');
  RESET ROLE;
  SELECT * INTO v_rec FROM shift_cash_reconciliations WHERE shift_id = v_shift;
  IF v_rec.expected_cash IS DISTINCT FROM 45.00 OR v_rec.counted_cash IS DISTINCT FROM 50.00
     OR v_rec.difference IS DISTINCT FROM 5.00 OR v_rec.notes IS DISTINCT FROM 'till ok'
     OR v_rec.reconciled_by IS DISTINCT FROM v_actor
     OR NOT verify_cash_reconciliation(20, 30, 5, v_rec.counted_cash, v_rec.expected_cash, v_rec.difference) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: %', row_to_json(v_rec);
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun142_expect('SCENARIO D2', 'P0001', 'This shift is already reconciled.',
    format('SELECT reconcile_shift_cash(%L::uuid, 10)', v_shift));

  -- Inside one transaction now() never moves, so a second shift would share
  -- the first one's time window. Move the two test sales (and shift 1) one
  -- minute back so shift 2 is really empty.
  RESET ROLE;
  UPDATE sales SET confirmed_at = confirmed_at - interval '1 minute' WHERE id IN (v_sale1, v_sale2);
  UPDATE shifts SET opened_at = opened_at - interval '2 minutes', closed_at = closed_at - interval '1 minute'
  WHERE id = v_shift;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- E. An empty shift closes with zero summaries (margin NULL); the
  --    POS-style count with only counted cash gives expected 0.
  -- ------------------------------------------------------------------
  v_shift2 := (open_shift(NULL) ->> 'id')::uuid;
  PERFORM close_shift(v_shift2, '  ');
  PERFORM reconcile_shift_cash(v_shift2, 12.5);
  RESET ROLE;
  SELECT * INTO v_ss FROM shift_daily_sales_summaries WHERE shift_id = v_shift2;
  SELECT * INTO v_ps FROM shift_daily_profit_summaries WHERE shift_id = v_shift2;
  SELECT * INTO v_rec FROM shift_cash_reconciliations WHERE shift_id = v_shift2;
  IF v_ss.sales_count <> 0 OR v_ss.net_revenue <> 0 OR v_ps.gross_margin_percent IS NOT NULL
     OR v_rec.expected_cash <> 0 OR v_rec.difference <> 12.50
     OR (SELECT notes FROM shifts WHERE id = v_shift2) IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: % / % / %', row_to_json(v_ss), row_to_json(v_ps), row_to_json(v_rec);
  END IF;

  -- ------------------------------------------------------------------
  -- F. Bad input.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun142_expect('SCENARIO F1', 'P0001', 'Shift was not found.',
    format('SELECT close_shift(%L::uuid)', gen_random_uuid()));
  PERFORM public.dryrun142_expect('SCENARIO F2', 'P0001', 'Shift id is required.',
    'SELECT close_shift(NULL)');
  PERFORM public.dryrun142_expect('SCENARIO F3', 'P0001', 'Shift was not found.',
    format('SELECT reconcile_shift_cash(%L::uuid, 1)', gen_random_uuid()));
  PERFORM public.dryrun142_expect('SCENARIO F4', 'P0001', 'Counted cash is required.',
    format('SELECT reconcile_shift_cash(%L::uuid, NULL)', v_shift2));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- G. No active profile → 42501 on all three; anon has no EXECUTE.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = v_original_role, is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun142_expect('SCENARIO G1', '42501', 'No active profile%', 'SELECT open_shift(NULL)');
  PERFORM public.dryrun142_expect('SCENARIO G2', '42501', 'No active profile%',
    format('SELECT close_shift(%L::uuid)', v_shift2));
  PERFORM public.dryrun142_expect('SCENARIO G3', '42501', 'No active profile%',
    format('SELECT reconcile_shift_cash(%L::uuid, 1)', v_shift2));
  RESET ROLE;
  UPDATE profiles SET is_active = true WHERE auth_user_id = v_actor;

  SET LOCAL ROLE anon;
  PERFORM public.dryrun142_expect('SCENARIO G4', '42501', 'permission denied for function open_shift',
    'SELECT open_shift(NULL)');
  PERFORM public.dryrun142_expect('SCENARIO G5', '42501', 'permission denied for function close_shift',
    format('SELECT close_shift(%L::uuid)', v_shift2));
  PERFORM public.dryrun142_expect('SCENARIO G6', '42501', 'permission denied for function reconcile_shift_cash',
    format('SELECT reconcile_shift_cash(%L::uuid, 1)', v_shift2));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- H. Catalog.
  -- ------------------------------------------------------------------
  IF (SELECT count(*) FROM pg_proc
      WHERE oid IN ('public.open_shift(text)'::regprocedure,
                    'public.close_shift(uuid, text)'::regprocedure,
                    'public.reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text)'::regprocedure)
        AND prosecdef AND proconfig @> ARRAY['search_path=public']) <> 3
     OR EXISTS (
       SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid IN ('public.open_shift(text)'::regprocedure,
                       'public.close_shift(uuid, text)'::regprocedure,
                       'public.reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text)'::regprocedure)
         AND a.grantee = 0) THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: catalog / grants wrong';
  END IF;

  FOR v_seq IN SELECT * FROM dryrun142_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/142 dry-run: scenarios A-H passed.';
END;
$test$;

ROLLBACK;
