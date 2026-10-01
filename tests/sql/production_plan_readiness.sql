-- SQL test: production plan readiness resync (sql/130).
-- Scenarios A-F and I. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including
-- sql/130_production_plan_live_requirements.sql, plus
-- tests/sql/bootstrap/prelude_auth.sql and
-- tests/sql/bootstrap/stub_owner_profile.sql (applied by
-- .github/workflows/sql-tests.yml job production-plan-readiness,
-- same prelude as sql-full-replay).
--
-- Runs as the table owner with JWT emulation (same pattern as
-- tests/sql/complete_production_session_zero_cost.sql). It does not
-- SET ROLE, so current_user is not 'authenticated' and sql/125 does
-- not reject the Scenario D stock UPDATE. Part 1 of sql/130 does
-- SET LOCAL ROLE authenticated and wraps that UPDATE in RESET ROLE.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/production_plan_readiness.sql

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_sqlstate text;
  v_status text;
  v_required numeric;
  v_at_planning numeric;
  v_missing numeric;
  v_count integer;
  v_plan uuid;
  v_recipe uuid;
  v_recipe_b uuid;
  v_ing uuid;
  v_ing_b uuid;
  v_product_b uuid;
  v_session uuid;
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

  -- ------------------------------------------------------------------
  -- A. Recipe edit lowers requirement → resync + promote
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_A_flour_' || v_suffix, 'kg', 5, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_A_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 10, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_A_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_A_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: after confirm status is %', v_status;
  END IF;

  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_required IS DISTINCT FROM 10
     OR v_at_planning IS DISTINCT FROM 5
     OR v_missing IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: snapshot required % at_planning % missing %',
      v_required, v_at_planning, v_missing;
  END IF;

  UPDATE recipe_items
  SET quantity = 4
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: after readiness status is %', v_status;
  END IF;
  IF v_required IS DISTINCT FROM 4
     OR v_missing IS DISTINCT FROM 0
     OR v_at_planning IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: after resync required % missing % at_planning %',
      v_required, v_missing, v_at_planning;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- ------------------------------------------------------------------
  -- B. Quantity increased after ready → demote to planned
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_B_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_B_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_B_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_B_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: confirm status is %', v_status;
  END IF;

  UPDATE production_plan_products
  SET planned_quantity = 20
  WHERE production_plan_id = v_plan;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity, missing_quantity
  INTO v_required, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: demoted status is %', v_status;
  END IF;
  IF v_required IS DISTINCT FROM 20 OR v_missing IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: required % missing %',
      v_required, v_missing;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- ------------------------------------------------------------------
  -- C. Add product → new row; remove product → its row disappears
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_C_flour_' || v_suffix, 'kg', 100, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_C_milk_' || v_suffix, 'l', 100, 0, 1, true)
  RETURNING id INTO v_ing_b;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_C_recipe_a_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_C_recipe_b_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe_b;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');
  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe_b, v_ing_b, 2, 'l');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_C_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_C_recipe_a_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  IF NOT EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan AND ingredient_id = v_ing
  ) OR EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan AND ingredient_id = v_ing_b
  ) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: confirm snapshot was not flour-only';
  END IF;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe_b, 'TEST_RESYNC_130_C_recipe_b_' || v_suffix,
    1, 1, 'kg', 1
  )
  RETURNING id INTO v_product_b;

  PERFORM check_production_plan_readiness(v_plan);

  IF NOT EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan
      AND ingredient_id = v_ing_b
      AND required_quantity = 2
  ) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: milk row did not appear';
  END IF;

  DELETE FROM production_plan_products WHERE id = v_product_b;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: milk row still present (%).', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: flour row count is %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS';

  -- ------------------------------------------------------------------
  -- D. inventory_quantity_at_planning stays frozen on existing rows
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_D_flour_' || v_suffix, 'kg', 8, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_D_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 2, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_D_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_D_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT inventory_quantity_at_planning
  INTO v_at_planning
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_at_planning IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: at_planning after confirm is %', v_at_planning;
  END IF;

  -- Owner role (this file never SET ROLE). See header.
  UPDATE ingredients SET current_stock = 1 WHERE id = v_ing;
  UPDATE recipe_items
  SET quantity = 3
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_at_planning IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: at_planning changed to %', v_at_planning;
  END IF;
  IF v_required IS DISTINCT FROM 3 OR v_missing IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: required % missing % (resync did not apply)',
      v_required, v_missing;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS';

  -- ------------------------------------------------------------------
  -- E. in_progress session → readiness changes nothing
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_E_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_E_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_E_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_E_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: confirm status is %', v_status;
  END IF;

  v_session := (start_production_session(v_plan) ->> 'session_id')::uuid;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: start returned no session';
  END IF;

  UPDATE recipe_items
  SET quantity = 50
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity INTO v_required
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'ready_to_produce' OR v_required IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: status % required % (expected ready_to_produce / 1)',
      v_status, v_required;
  END IF;

  RAISE NOTICE 'SCENARIO E PASS';

  -- ------------------------------------------------------------------
  -- F. start refuses when live stock is short; status stays ready
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_F_flour_' || v_suffix, 'kg', 5, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_F_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_F_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_F_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  UPDATE recipe_items
  SET quantity = 20
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  BEGIN
    PERFORM start_production_session(v_plan);
    RAISE EXCEPTION 'SCENARIO F FAIL: start succeeded while stock was short';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Cannot start production. Not enough "TEST_RESYNC_130_F_flour_' || v_suffix || '"%'
         OR v_err NOT LIKE '%Open the plan to recalculate.'
         OR v_err NOT LIKE '%need 20%'
         OR v_err NOT LIKE '%have 5%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: unexpected message [%] %', v_sqlstate, v_err;
      END IF;
  END;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: status changed to %', v_status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM production_sessions WHERE production_plan_id = v_plan
  ) THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: a session row was inserted';
  END IF;

  RAISE NOTICE 'SCENARIO F PASS';

  -- ------------------------------------------------------------------
  -- I. All products removed after confirm → demote, do not promote
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_I_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_I_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_I_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_I_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: confirm status is %', v_status;
  END IF;

  DELETE FROM production_plan_products WHERE production_plan_id = v_plan;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: status is %', v_status;
  END IF;

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: snapshot row count is %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO I PASS';

  -- ------------------------------------------------------------------

  RAISE NOTICE 'production_plan_readiness.sql PASS';
END;
$test$;

ROLLBACK;
