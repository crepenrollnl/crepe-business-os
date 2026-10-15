-- SQL test: sql/155 — stock views without costs (audit S4/U5 phase 2a).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/stock_views_without_costs.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-D passed".
--
-- Scenarios:
--   A — catalog: 3 views, owner-rights (security_invoker false), no cost /
--       value / price / supplier columns; authenticated may SELECT, anon not
--   B — (batch 10 made, 3 out, 1 back in → 8; a second batch fully used)
--       same numbers as finished_goods_batch_availability /
--       report_finished_goods_summary and as ingredients (owner signed in)
--   C — a seller reads the same rows, and still does after SELECT on the
--       source tables is taken away from authenticated (phase 2b simulation)
--   D — a signed-in user without an active profile gets no rows; anon is refused
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun155_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun155_expect(text, text, text, text) TO authenticated, anon;

CREATE TEMP TABLE dryrun155_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;
CREATE TEMP TABLE dryrun155_owner_view (k text, v numeric) ON COMMIT DROP;
GRANT ALL ON dryrun155_owner_view TO authenticated;

DO $test$
DECLARE
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_line uuid;
  v_line2 uuid;
  v_batch uuid;
  v_batch2 uuid;
  v_n bigint;
  v_m bigint;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun155_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  IF (SELECT count(*) FROM pg_class c
      WHERE c.oid IN ('public.ingredient_stock_levels'::regclass,
                      'public.finished_goods_stock_batches'::regclass,
                      'public.finished_goods_stock_summary'::regclass)
        AND c.relkind = 'v'
        AND 'security_invoker=false' = ANY (c.reloptions)) <> 3
     OR EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name IN ('ingredient_stock_levels', 'finished_goods_stock_batches',
                                     'finished_goods_stock_summary')
                  AND (column_name ILIKE '%cost%' OR column_name ILIKE '%value%'
                       OR column_name ILIKE '%price%' OR column_name ILIKE '%supplier%'))
     OR NOT has_table_privilege('authenticated', 'public.finished_goods_stock_summary', 'SELECT')
     OR has_table_privilege('authenticated', 'public.finished_goods_stock_summary', 'INSERT')
     OR has_table_privilege('anon', 'public.finished_goods_stock_summary', 'SELECT')
     OR has_table_privilege('anon', 'public.ingredient_stock_levels', 'SELECT')
     OR has_table_privilege('anon', 'public.finished_goods_stock_batches', 'SELECT') THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: views, options, columns or grants wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- Test data: an ingredient and a finished good with one batch, part used.
  -- ------------------------------------------------------------------
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
  VALUES ('TEST_SV_ing_' || v_tag, 'kg', 7.5, 2, 3.20, true) RETURNING id INTO v_ing;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_SV_comp_' || v_tag, 1, 'pcs', true, 'component') RETURNING id INTO v_comp;
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_SV_plan_' || v_tag, CURRENT_DATE, 'completed') RETURNING id INTO v_plan;
  INSERT INTO production_plan_products (production_plan_id, recipe_id, recipe_name, planned_quantity,
                                        yield_quantity, yield_unit, sort_order)
  VALUES (v_plan, v_comp, 'TEST_SV', 10, 1, 'pcs', 1) RETURNING id INTO v_plan_product;
  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now()) RETURNING id INTO v_session;
  INSERT INTO production_session_lines (production_session_id, production_plan_product_id, recipe_id,
                                        product_name, planned_quantity, actual_produced_quantity,
                                        yield_unit, sort_order)
  VALUES (v_session, v_plan_product, v_comp, 'TEST_SV', 10, 10, 'pcs', 1) RETURNING id INTO v_line;
  INSERT INTO production_session_lines (production_session_id, production_plan_product_id, recipe_id,
                                        product_name, planned_quantity, actual_produced_quantity,
                                        yield_unit, sort_order)
  VALUES (v_session, v_plan_product, v_comp, 'TEST_SV', 2, 2, 'pcs', 2) RETURNING id INTO v_line2;
  UPDATE production_sessions SET status = 'completed', completed_at = now() WHERE id = v_session;
  INSERT INTO production_batches (production_session_id, production_session_line_id, finished_good_id,
                                  recipe_id, produced_quantity, unit_cost, produced_at)
  VALUES (v_session, v_line, v_comp, v_comp, 10, 0.50, now()) RETURNING id INTO v_batch;
  INSERT INTO finished_goods_batch_consumptions (production_batch_id, quantity, unit_cost, total_cost,
                                                 direction, reason, source_type, source_id)
  VALUES (v_batch, 3, 0.50, 1.50, 'out', 'sale', 'sale_line', gen_random_uuid());
  INSERT INTO finished_goods_batch_consumptions (production_batch_id, quantity, unit_cost, total_cost,
                                                 direction, reason, source_type, source_id)
  VALUES (v_batch, 1, 0.50, 0.50, 'in', 'return_restock', 'sale_line', gen_random_uuid());
  -- a second batch of the same product, fully used (available 0)
  INSERT INTO production_batches (production_session_id, production_session_line_id, finished_good_id,
                                  recipe_id, produced_quantity, unit_cost, produced_at)
  VALUES (v_session, v_line2, v_comp, v_comp, 2, 0.60, now() - interval '1 day') RETURNING id INTO v_batch2;
  INSERT INTO finished_goods_batch_consumptions (production_batch_id, quantity, unit_cost, total_cost,
                                                 direction, reason, source_type, source_id)
  VALUES (v_batch2, 2, 0.60, 1.20, 'out', 'sale', 'sale_line', gen_random_uuid());

  -- ------------------------------------------------------------------
  -- B. Same numbers as the cost views / the table (as postgres + owner claims).
  -- ------------------------------------------------------------------
  IF EXISTS (
       SELECT 1 FROM finished_goods_batch_availability a
       FULL JOIN finished_goods_stock_batches b ON b.production_batch_id = a.production_batch_id
       WHERE a.production_batch_id IS NULL OR b.production_batch_id IS NULL
          OR a.available_quantity IS DISTINCT FROM b.available_quantity
          OR a.product_id IS DISTINCT FROM b.product_id
          OR a.produced_quantity IS DISTINCT FROM b.produced_quantity)
     OR EXISTS (
       (SELECT product_id, product_name, available_quantity, active_batch_count,
               oldest_batch_at, newest_batch_at, production_status
        FROM report_finished_goods_summary
        EXCEPT
        SELECT product_id, product_name, available_quantity, active_batch_count,
               oldest_batch_at, newest_batch_at, production_status
        FROM finished_goods_stock_summary)
       UNION ALL
       (SELECT product_id, product_name, available_quantity, active_batch_count,
               oldest_batch_at, newest_batch_at, production_status
        FROM finished_goods_stock_summary
        EXCEPT
        SELECT product_id, product_name, available_quantity, active_batch_count,
               oldest_batch_at, newest_batch_at, production_status
        FROM report_finished_goods_summary))
     OR (SELECT count(*) FROM ingredients) <> (SELECT count(*) FROM ingredient_stock_levels)
     OR (SELECT available_quantity FROM finished_goods_stock_summary WHERE product_id = v_comp) <> 8
     OR (SELECT current_stock FROM ingredient_stock_levels WHERE id = v_ing) <> 7.5 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: numbers differ from the cost views';
  END IF;
  INSERT INTO dryrun155_owner_view
  SELECT 'fg:' || product_id, available_quantity FROM finished_goods_stock_summary
  UNION ALL SELECT 'ing:' || id, current_stock FROM ingredient_stock_levels;

  -- ------------------------------------------------------------------
  -- C. A seller sees the same — also once the source tables are closed.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM (
    SELECT 'fg:' || product_id AS k, available_quantity AS v FROM finished_goods_stock_summary
    UNION ALL SELECT 'ing:' || id, current_stock FROM ingredient_stock_levels
    EXCEPT SELECT k, v FROM dryrun155_owner_view) d;
  SELECT count(*) INTO v_m FROM finished_goods_stock_batches WHERE production_batch_id = v_batch;
  RESET ROLE;
  IF v_n <> 0 OR v_m <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller sees different rows (% / %)', v_n, v_m;
  END IF;

  REVOKE SELECT ON public.ingredients, public.production_batches,
                   public.finished_goods_batch_consumptions, public.recipes FROM authenticated;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun155_expect('SCENARIO C table closed', '42501', 'permission denied for table%',
    'SELECT count(*) FROM public.production_batches');
  SELECT count(*) INTO v_n FROM finished_goods_stock_summary WHERE product_id = v_comp AND available_quantity = 8 AND active_batch_count = 1;
  SELECT count(*) INTO v_m FROM ingredient_stock_levels WHERE id = v_ing AND current_stock = 7.5;
  RESET ROLE;
  IF v_n <> 1 OR v_m <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: views stop working once the tables are closed';
  END IF;
  GRANT SELECT ON public.ingredients, public.production_batches,
                  public.finished_goods_batch_consumptions, public.recipes TO authenticated;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- D. No active profile → no rows. anon → refused.
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT (SELECT count(*) FROM ingredient_stock_levels)
       + (SELECT count(*) FROM finished_goods_stock_batches)
       + (SELECT count(*) FROM finished_goods_stock_summary) INTO v_n;
  RESET ROLE;
  SET LOCAL ROLE anon;
  PERFORM public.dryrun155_expect('SCENARIO D anon', '42501', 'permission denied for view%',
    'SELECT count(*) FROM public.finished_goods_stock_summary');
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: user without a profile sees % rows', v_n;
  END IF;

  FOR v_seq IN SELECT * FROM dryrun155_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/155 dry-run: scenarios A-D passed.';
END;
$test$;

ROLLBACK;
