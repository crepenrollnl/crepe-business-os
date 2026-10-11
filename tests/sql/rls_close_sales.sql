-- SQL test: sql/140 — direct client writes closed on sales (audit S1 step 2b).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/rls_close_sales.sql
-- (exit 0) after a full replay of sql/*.sql.
--
-- Scenarios:
--   A — one SELECT policy; authenticated SELECT only; anon nothing
--   B — a seller still sells via create_and_confirm_sale
--   C — seller kitchen queue via mark_sale_queued / mark_sale_fulfilled,
--       paid flag via set_sale_paid_flag
--   D — direct INSERT/UPDATE/DELETE/TRUNCATE refused for seller and owner
--       (including the old markSaleQueued client UPDATE)
--   E — SELECT sees every row
--   F — anon can neither read nor write
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun140_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S1S2_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;
  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S1S2_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;
  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;
  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S1S2_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun140_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun140_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun140_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_seq record;
  v_count_owner bigint;
  v_count_auth bigint;
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_result jsonb;
  v_sale uuid;
  v_fulfilled timestamptz;
  v_status text;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun140_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'sales'
         AND policyname = 'sales_authenticated_select' AND cmd = 'SELECT'
         AND roles = ARRAY['authenticated']::name[] AND qual = 'true')
     OR NOT has_table_privilege('authenticated', 'public.sales', 'SELECT')
     OR has_table_privilege('authenticated', 'public.sales', 'INSERT')
     OR has_table_privilege('authenticated', 'public.sales', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.sales', 'DELETE')
     OR has_table_privilege('authenticated', 'public.sales', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.sales', 'SELECT')
     OR has_table_privilege('anon', 'public.sales', 'UPDATE') THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: sales policy/privileges wrong';
  END IF;

  -- Signed-in owner/partner + test data (component batch + dish).
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
  VALUES ('TEST_S1S2_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S2_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun140_batch(v_comp, 10, 2.00, v_tag);
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S2_dish_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- ------------------------------------------------------------------
  -- B. A SELLER still sells (all sales writes are RPCs).
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)
    ),
    p_kitchen_note => 'TEST_S1S2'
  );
  v_sale := (v_result ->> 'sale_id')::uuid;

  RESET ROLE;
  SELECT status, fulfilled_at INTO v_status, v_fulfilled FROM sales WHERE id = v_sale;
  IF v_status IS DISTINCT FROM 'confirmed' OR v_fulfilled IS NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: sale % status % fulfilled_at %', v_sale, v_status, v_fulfilled;
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- C. Seller: kitchen queue through the RPCs; paid flag via RPC.
  -- ------------------------------------------------------------------
  PERFORM mark_sale_queued(v_sale);
  PERFORM set_sale_paid_flag(v_sale, true);
  RESET ROLE;
  SELECT fulfilled_at INTO v_fulfilled FROM sales WHERE id = v_sale;
  IF v_fulfilled IS NOT NULL OR NOT (SELECT is_paid FROM sales WHERE id = v_sale) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: queued fulfilled_at % / paid flag', v_fulfilled;
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM mark_sale_fulfilled(v_sale);
  RESET ROLE;
  SELECT fulfilled_at INTO v_fulfilled FROM sales WHERE id = v_sale;
  IF v_fulfilled IS NULL THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: fulfilled_at still NULL after mark_sale_fulfilled';
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- D. Direct writes are refused, for the seller and for the owner:
  --    the old client calls and anything else.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun140_expect('SCENARIO D1 seller old markSaleQueued', '42501', 'permission denied%',
    format('UPDATE public.sales SET fulfilled_at = NULL WHERE id = %L AND fulfilled_at IS NOT NULL', v_sale));
  PERFORM public.dryrun140_expect('SCENARIO D2 seller total', '42501', 'permission denied%',
    format('UPDATE public.sales SET total = 0 WHERE id = %L', v_sale));
  PERFORM public.dryrun140_expect('SCENARIO D3 seller insert', '42501', 'permission denied%',
    'INSERT INTO public.sales DEFAULT VALUES');
  PERFORM public.dryrun140_expect('SCENARIO D4 seller delete', '42501', 'permission denied%',
    format('DELETE FROM public.sales WHERE id = %L', v_sale));

  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun140_expect('SCENARIO D5 owner status', '42501', 'permission denied%',
    format('UPDATE public.sales SET status = %L WHERE id = %L', 'cancelled', v_sale));
  PERFORM public.dryrun140_expect('SCENARIO D6 owner truncate', '42501', 'permission denied%',
    'TRUNCATE public.sales');

  -- ------------------------------------------------------------------
  -- E. Reading sees every row.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count_auth FROM public.sales;
  RESET ROLE;
  SELECT count(*) INTO v_count_owner FROM public.sales;
  IF v_count_auth IS DISTINCT FROM v_count_owner THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: authenticated sees % rows, owner %', v_count_auth, v_count_owner;
  END IF;

  -- ------------------------------------------------------------------
  -- F. anon can neither read nor write.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM public.dryrun140_expect('SCENARIO F1 anon select', '42501', 'permission denied%',
    'SELECT count(*) FROM public.sales');
  PERFORM public.dryrun140_expect('SCENARIO F2 anon update', '42501', 'permission denied%',
    'UPDATE public.sales SET notes = notes WHERE false');
  RESET ROLE;

  FOR v_seq IN SELECT * FROM dryrun140_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/140 dry-run: scenarios A-F passed.';
END;
$test$;

ROLLBACK;
