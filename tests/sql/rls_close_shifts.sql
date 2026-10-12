-- SQL test: sql/143 — shift tables read-only for signed-in users (audit S1 step 4b).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/rls_close_shifts.sql
-- (exit 0) after a full replay of sql/*.sql.
--
-- Scenarios:
--   A — catalog: one SELECT policy per table; authenticated SELECT only; anon nothing
--   B — a seller: a sale with no open shift still opens one (confirm_sale);
--       close_shift + reconcile_shift_cash work
--   C — seller: every direct INSERT/UPDATE/DELETE refused, incl. the old
--       browser closeShift and rewriting a summary
--   D — owner cannot write directly either (incl. TRUNCATE)
--   E — SELECT sees every row
--   F — anon can neither read nor write

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun143_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S1S4b_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;
  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S1S4b_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;
  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;
  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S1S4b_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun143_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun143_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun143_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_seq record;
  v_tables text[] := ARRAY['shifts', 'shift_cash_reconciliations',
                           'shift_daily_sales_summaries', 'shift_daily_profit_summaries'];
  v_table text;
  v_col text;
  v_count integer;
  v_n bigint;
  v_counts jsonb := '{}'::jsonb;
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_sale uuid;
  v_shift uuid;
  v_shift2 uuid;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun143_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_tables
  LOOP
    SELECT count(*) INTO v_count FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table;
    IF v_count <> 1
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = v_table || '_authenticated_select' AND cmd = 'SELECT'
                      AND roles = ARRAY['authenticated']::name[] AND qual = 'true')
       OR NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
       OR has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % policy/privileges wrong (% policies)', v_table, v_count;
    END IF;
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

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_S1S4b_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S4b_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun143_batch(v_comp, 10, 2.00, v_tag);
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_S1S4b_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- ------------------------------------------------------------------
  -- B. A SELLER: a sale with no open shift still opens one itself
  --    (confirm_sale); then close + cash count through the RPCs.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  v_sale := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)))
    ->> 'sale_id')::uuid;

  SELECT id INTO v_shift FROM shifts WHERE status = 'open';
  IF v_shift IS NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: confirm_sale did not open a shift';
  END IF;

  PERFORM close_shift(v_shift, NULL);
  PERFORM reconcile_shift_cash(v_shift, 10);

  RESET ROLE;
  IF (SELECT status FROM shifts WHERE id = v_shift) <> 'closed'
     OR (SELECT sales_count FROM shift_daily_sales_summaries WHERE shift_id = v_shift) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM shift_daily_profit_summaries WHERE shift_id = v_shift)
     OR NOT EXISTS (SELECT 1 FROM shift_cash_reconciliations WHERE shift_id = v_shift) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: shift % not closed/summarised/reconciled', v_shift;
  END IF;

  -- Make the next shift's time window empty (now() does not move in one transaction).
  UPDATE sales SET confirmed_at = confirmed_at - interval '1 minute' WHERE id = v_sale;
  UPDATE shifts SET opened_at = opened_at - interval '2 minutes', closed_at = closed_at - interval '1 minute'
  WHERE id = v_shift;

  SET LOCAL ROLE authenticated;
  v_shift2 := (open_shift(NULL) ->> 'id')::uuid;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    RESET ROLE;
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_n;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
    SET LOCAL ROLE authenticated;
  END LOOP;

  -- ------------------------------------------------------------------
  -- C. Seller: every direct write is refused — including the old
  --    browser calls (insert shift, update to closed, insert summaries,
  --    insert cash count) and rewriting a closed shift's numbers.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_tables
  LOOP
    SELECT a.attname INTO v_col
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || v_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 1;
    PERFORM public.dryrun143_expect('SCENARIO C insert ' || v_table, '42501', 'permission denied%',
      format('INSERT INTO public.%I DEFAULT VALUES', v_table));
    PERFORM public.dryrun143_expect('SCENARIO C update ' || v_table, '42501', 'permission denied%',
      format('UPDATE public.%I SET %I = %I WHERE false', v_table, v_col, v_col));
    PERFORM public.dryrun143_expect('SCENARIO C delete ' || v_table, '42501', 'permission denied%',
      format('DELETE FROM public.%I WHERE false', v_table));
  END LOOP;
  PERFORM public.dryrun143_expect('SCENARIO C old closeShift', '42501', 'permission denied%',
    format('UPDATE public.shifts SET status = %L, closed_at = now() WHERE id = %L', 'closed', v_shift2));
  PERFORM public.dryrun143_expect('SCENARIO C rewrite profit', '42501', 'permission denied%',
    format('UPDATE public.shift_daily_profit_summaries SET total_cogs = 0 WHERE shift_id = %L', v_shift));

  -- ------------------------------------------------------------------
  -- D. Owner cannot write directly either.
  -- ------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun143_expect('SCENARIO D owner cash', '42501', 'permission denied%',
    format('UPDATE public.shift_cash_reconciliations SET counted_cash = 0 WHERE shift_id = %L', v_shift));
  PERFORM public.dryrun143_expect('SCENARIO D owner truncate', '42501', 'permission denied%',
    'TRUNCATE public.shifts');

  -- ------------------------------------------------------------------
  -- E. Reading sees every row.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_n;
    IF v_n IS DISTINCT FROM (v_counts ->> v_table)::bigint THEN
      RAISE EXCEPTION 'SCENARIO E FAIL: % — authenticated sees %, owner %', v_table, v_n, v_counts ->> v_table;
    END IF;
  END LOOP;
  PERFORM close_shift(v_shift2, NULL);

  -- ------------------------------------------------------------------
  -- F. anon can neither read nor write.
  -- ------------------------------------------------------------------
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM public.dryrun143_expect('SCENARIO F anon select', '42501', 'permission denied%',
    'SELECT count(*) FROM public.shifts');
  PERFORM public.dryrun143_expect('SCENARIO F anon insert', '42501', 'permission denied%',
    'INSERT INTO public.shift_cash_reconciliations DEFAULT VALUES');
  RESET ROLE;

  FOR v_seq IN SELECT * FROM dryrun143_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/143 dry-run: scenarios A-F passed.';
END;
$test$;

ROLLBACK;
