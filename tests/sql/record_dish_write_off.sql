-- SQL test: record_dish_write_off (sql/136).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/record_dish_write_off.sql
-- (exit 0) after a full replay of sql/*.sql (sql-tests.yml job
-- record_dish_write_off). Prints NOTICE "scenarios A-J passed".
--
-- Scenarios:
--   A — 2 dishes: one write_offs row per part, shared note, totals,
--       component FIFO 3.000 @ 2.00 and ingredient 0.400 @ 1.50
--   B — not enough component: error, nothing written, ingredient untouched
--   C — zero-cost ingredient in the dish: error, component part rolled back
--   D — a component recipe is not a dish
--   E — dish without recipe_components
--   F — bad input (quantity 0 / NULL / > 1000 / rounds to 0, reason, product)
--   G — a part that rounds to zero is refused, nothing written
--   H — no note: note is "Dish: <name> × 1"; second FIFO pass
--   I — seller-role caller is rejected (42501), nothing written
--   J — anon has no EXECUTE; SECURITY DEFINER, search_path, grants
--
-- Same body as the dry-run that was applied to dev and prod; the test
-- data (ingredients, recipes, one component batch) is created inside the
-- transaction. Seller emulation flips the same owner profiles row.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun136_batch(
  p_recipe_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_line uuid;
  v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_DISH_WO_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_DISH_WO_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_DISH_WO_comp_' || p_tag,
          p_qty, p_qty, 'pcs', 1)
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
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

CREATE OR REPLACE FUNCTION public.dryrun136_expect(
  p_label text,
  p_sqlstate text,
  p_message_like text,
  p_sql text
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
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%]',
          p_label, p_sqlstate, p_message_like, v_state, v_err;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun136_expect(text, text, text, text)
  TO authenticated, anon;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_ing_free uuid;
  v_comp uuid;
  v_dish uuid;
  v_dish_free uuid;
  v_dish_empty uuid;
  v_result jsonb;
  v_stock numeric;
  v_left numeric;
  v_count integer;
  v_rows text;
  v_before integer;
BEGIN
  -- ------------------------------------------------------------------
  -- Setup (as postgres): actor, test ingredient, component + batch,
  -- dishes. Nothing here survives the ROLLBACK.
  -- ------------------------------------------------------------------
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'auth.uid() emulation failed (got %, expected %).', auth.uid(), v_actor;
  END IF;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_DISH_WO_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_DISH_WO_free_' || v_tag, 'kg', 100, 0, 0, true)
  RETURNING id INTO v_ing_free;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_DISH_WO_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;

  PERFORM public.dryrun136_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_DISH_WO_dish_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish;

  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1.5, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_DISH_WO_dishfree_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish_free;

  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish_free, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish_free, v_ing_free, 0.1, 'kg');

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_DISH_WO_empty_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish_empty;

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION 'SETUP FAIL: get_my_role() is %', get_my_role();
  END IF;

  -- ------------------------------------------------------------------
  -- A. Two dishes: one write_offs row per part, shared note, totals,
  --    component FIFO 3.000 @ 2.00 and ingredient 0.400 @ 1.50.
  -- ------------------------------------------------------------------
  v_result := record_dish_write_off(v_dish, 2, 'quality_reject', '  burned  ');

  IF jsonb_array_length(v_result -> 'write_offs') IS DISTINCT FROM 2
     OR (v_result ->> 'total_value')::numeric IS DISTINCT FROM 6.6
     OR (v_result ->> 'quantity')::numeric IS DISTINCT FROM 2
     OR (v_result ->> 'product_id')::uuid IS DISTINCT FROM v_dish THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: result %', v_result;
  END IF;

  SELECT string_agg(
           item_type || ':' || quantity || ':' || total_value || ':' || reason || ':' || note
             || ':' || (created_by = v_actor)::text,
           ' | ' ORDER BY item_type)
  INTO v_rows
  FROM write_offs
  WHERE id IN (
    SELECT (row ->> 'id')::uuid FROM jsonb_array_elements(v_result -> 'write_offs') AS row
  );

  IF v_rows IS DISTINCT FROM
       'finished_good:3.000:6.0000:quality_reject:Dish: TEST_DISH_WO_dish_' || v_tag || ' × 2 — burned:true'
       || ' | '
       || 'ingredient:0.400:0.6000:quality_reject:Dish: TEST_DISH_WO_dish_' || v_tag || ' × 2 — burned:true' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: rows [%]', v_rows;
  END IF;

  RESET ROLE;
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  SELECT available_quantity INTO v_left
  FROM report_finished_goods_summary WHERE product_id = v_comp;
  SET LOCAL ROLE authenticated;

  IF v_stock IS DISTINCT FROM 99.6 OR v_left IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: ingredient stock % (expect 99.6), component left % (expect 7)',
      v_stock, v_left;
  END IF;

  -- ------------------------------------------------------------------
  -- B. Not enough component (5 dishes need 7.5, 7 left): nothing at all
  --    is written, the ingredient part is rolled back too.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_before FROM write_offs;

  PERFORM public.dryrun136_expect('SCENARIO B', 'P0001',
    'Could not write off "TEST_DISH_WO_comp_%" for dish "TEST_DISH_WO_dish_%',
    format('SELECT record_dish_write_off(%L::uuid, 5, ''spoilage'', NULL)', v_dish));

  SELECT count(*) INTO v_count FROM write_offs;
  RESET ROLE;
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  SET LOCAL ROLE authenticated;
  IF v_count IS DISTINCT FROM v_before OR v_stock IS DISTINCT FROM 99.6 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: rows % -> %, ingredient stock % (expect 99.6)',
      v_before, v_count, v_stock;
  END IF;

  -- ------------------------------------------------------------------
  -- C. Zero-cost ingredient inside the dish: record_write_off's own
  --    guard fires and the component part is rolled back with it.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun136_expect('SCENARIO C', 'P0001',
    'Could not write off "TEST_DISH_WO_free_%" for dish "TEST_DISH_WO_dishfree_%',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', v_dish_free));

  SELECT count(*) INTO v_count FROM write_offs;
  RESET ROLE;
  SELECT available_quantity INTO v_left
  FROM report_finished_goods_summary WHERE product_id = v_comp;
  SET LOCAL ROLE authenticated;
  IF v_count IS DISTINCT FROM v_before OR v_left IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: rows % -> %, component left % (expect 7)',
      v_before, v_count, v_left;
  END IF;

  -- ------------------------------------------------------------------
  -- D. A component recipe is not a dish.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun136_expect('SCENARIO D', 'P0001',
    '"TEST_DISH_WO_comp_%" is not a dish.%',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', v_comp));

  -- ------------------------------------------------------------------
  -- E. Dish without recipe_components.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun136_expect('SCENARIO E', 'P0001',
    'Dish "TEST_DISH_WO_empty_%" has no components defined%',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', v_dish_empty));

  -- ------------------------------------------------------------------
  -- F. Bad input.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun136_expect('SCENARIO F1', 'P0001',
    'Write-off quantity must be greater than zero.',
    format('SELECT record_dish_write_off(%L::uuid, 0, ''spoilage'', NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F2', 'P0001',
    'Write-off quantity must be greater than zero.',
    format('SELECT record_dish_write_off(%L::uuid, NULL, ''spoilage'', NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F3', 'P0001',
    'Dish quantity must be between 0.001 and 1000.',
    format('SELECT record_dish_write_off(%L::uuid, 1000.001, ''spoilage'', NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F4', 'P0001',
    'Dish quantity must be between 0.001 and 1000.',
    format('SELECT record_dish_write_off(%L::uuid, 0.0004, ''spoilage'', NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F5', 'P0001',
    'Write-off reason is invalid.',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''bogus'', NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F6', 'P0001',
    'Write-off reason is invalid.',
    format('SELECT record_dish_write_off(%L::uuid, 1, NULL, NULL)', v_dish));
  PERFORM public.dryrun136_expect('SCENARIO F7', 'P0001',
    'Choose a dish to write off.',
    'SELECT record_dish_write_off(NULL, 1, ''spoilage'', NULL)');
  PERFORM public.dryrun136_expect('SCENARIO F8', 'P0001',
    'Dish was not found.',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', gen_random_uuid()));

  -- ------------------------------------------------------------------
  -- G. A part that rounds to zero (0.2 kg × 0.001 dish) is refused and
  --    nothing is written.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun136_expect('SCENARIO G', 'P0001',
    'Quantity is too small: "TEST_DISH_WO_ing_%" in "TEST_DISH_WO_dish_%" would round to zero.',
    format('SELECT record_dish_write_off(%L::uuid, 0.001, ''spoilage'', NULL)', v_dish));

  SELECT count(*) INTO v_count FROM write_offs;
  IF v_count IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: rows % -> %', v_before, v_count;
  END IF;

  -- ------------------------------------------------------------------
  -- H. No note: note is just "Dish: <name> × 1"; second FIFO pass.
  -- ------------------------------------------------------------------
  v_result := record_dish_write_off(v_dish, 1, 'staff_use', '   ');

  SELECT count(*) INTO v_count
  FROM write_offs
  WHERE id IN (
      SELECT (row ->> 'id')::uuid FROM jsonb_array_elements(v_result -> 'write_offs') AS row
    )
    AND note = 'Dish: TEST_DISH_WO_dish_' || v_tag || ' × 1'
    AND reason = 'staff_use';

  IF v_count IS DISTINCT FROM 2
     OR (v_result ->> 'total_value')::numeric IS DISTINCT FROM 3.3 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: matching rows %, result %', v_count, v_result;
  END IF;

  RESET ROLE;
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  SELECT available_quantity INTO v_left
  FROM report_finished_goods_summary WHERE product_id = v_comp;
  SET LOCAL ROLE authenticated;
  IF v_stock IS DISTINCT FROM 99.4 OR v_left IS DISTINCT FROM 5.5 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: ingredient stock % (expect 99.4), component left % (expect 5.5)',
      v_stock, v_left;
  END IF;

  -- ------------------------------------------------------------------
  -- I. Seller is refused before anything is touched.
  -- ------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_before FROM write_offs;
  PERFORM public.dryrun136_expect('SCENARIO I', '42501', '%',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', v_dish));
  SELECT count(*) INTO v_count FROM write_offs;

  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  IF v_count IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: rows % -> %', v_before, v_count;
  END IF;

  -- ------------------------------------------------------------------
  -- J. anon has no EXECUTE; catalog shape and grants.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM public.dryrun136_expect('SCENARIO J1', '42501',
    'permission denied for function record_dish_write_off',
    format('SELECT record_dish_write_off(%L::uuid, 1, ''spoilage'', NULL)', v_dish));
  RESET ROLE;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE oid = 'public.record_dish_write_off(uuid, numeric, text, text)'::regprocedure
      AND prosecdef
      AND proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'SCENARIO J2 FAIL: not SECURITY DEFINER with search_path=public';
  END IF;

  IF has_function_privilege('anon', 'public.record_dish_write_off(uuid, numeric, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.record_dish_write_off(uuid, numeric, text, text)', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = 'public.record_dish_write_off(uuid, numeric, text, text)'::regprocedure
         AND a.grantee = 0
     ) THEN
    RAISE EXCEPTION 'SCENARIO J3 FAIL: grants are wrong';
  END IF;

  RAISE NOTICE 'sql/136 dry-run: scenarios A-J passed.';
END;
$test$;

ROLLBACK;
