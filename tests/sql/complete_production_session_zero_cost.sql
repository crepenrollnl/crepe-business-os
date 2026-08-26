-- SQL test: complete_production_session zero-cost guard (sql/106).
-- Covers two money-critical RPCs from the 21.08 audit:
--   complete_production_session, allocate_finished_goods_fifo
-- (FIFO is exercised by scenario B; the RAISE is the sql/106 layer check).
--
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/complete_production_session_zero_cost.sql
-- (exit 0). Nested EXCEPTION catches the expected RPC RAISE so ROLLBACK
-- still runs. Proven 26.08.2026 on clean PostgreSQL 16.14 (no Supabase)
-- after tests/sql/bootstrap/complete_production_session.list.
--
-- Scenarios (also PASS 24.08 on live crepe-business-os + V1):
--   A — component recipe, recipe_items ingredient with cost_per_unit = 0
--       → RAISE contains "Set Cost per unit in Inventory and try again."
--   B — assembly FIFO from production_batches.unit_cost = 0
--       → RAISE contains "This cannot be fixed in Inventory"
--
-- Actor: prefer an existing owner/partner profile (manual SQL Editor).
-- On ephemeral Postgres, insert a disposable auth.users + profiles row
-- (stub auth.users is id-only). Does not patch require_role.
-- JWT: SET LOCAL request.jwt.claim.sub + request.jwt.claims so auth.uid()
-- matches the live V1 formula copied into tests/sql/bootstrap/prelude_auth.sql.

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_ing_a uuid;
  v_recipe_a uuid;
  v_plan_a uuid;
  v_plan_product_a uuid;
  v_session_a uuid;
  v_line_a uuid;

  v_ing_b uuid;
  v_recipe_component uuid;
  v_recipe_assembly uuid;
  v_plan_dummy uuid;
  v_plan_product_dummy uuid;
  v_session_dummy uuid;
  v_line_dummy uuid;
  v_plan_b uuid;
  v_plan_product_b uuid;
  v_session_b uuid;
  v_line_b uuid;

  v_err text;
  v_result jsonb;
BEGIN
  RAISE NOTICE 'auth.uid() live def: %', pg_get_functiondef('auth.uid()'::regprocedure);
  RAISE NOTICE 'require_role live def: %', pg_get_functiondef('require_role(text[])'::regprocedure);

  SELECT p.auth_user_id
  INTO v_actor
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    v_actor := gen_random_uuid();
    INSERT INTO auth.users (id) VALUES (v_actor);
    INSERT INTO profiles (auth_user_id, role, is_active)
    VALUES (v_actor, 'owner', true);
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
      'auth.uid() emulation failed (got %, expected %). Live def: %',
      auth.uid(),
      v_actor,
      pg_get_functiondef('auth.uid()'::regprocedure);
  END IF;

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION
      'get_my_role() after JWT emulation is % — require_role would fail first.',
      get_my_role();
  END IF;

  RAISE NOTICE 'JWT emulated auth.uid()=% get_my_role()=%', auth.uid(), get_my_role();

  -- ------------------------------------------------------------------
  -- Scenario A: component recipe, raw ingredient cost_per_unit = 0
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (
    name,
    unit,
    current_stock,
    minimum_stock,
    cost_per_unit,
    active
  )
  VALUES (
    'TEST_ZERO_COST_106_ing_A_' || v_suffix,
    'kg',
    100,
    0,
    0,
    true
  )
  RETURNING id INTO v_ing_a;

  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_ZERO_COST_106_recipe_A_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_a;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe_a, v_ing_a, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_ZERO_COST_106_plan_A_' || v_suffix,
    CURRENT_DATE,
    'ready_to_produce'
  )
  RETURNING id INTO v_plan_a;

  INSERT INTO production_plan_products (
    production_plan_id,
    recipe_id,
    recipe_name,
    planned_quantity,
    yield_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_plan_a,
    v_recipe_a,
    'TEST_ZERO_COST_106_recipe_A_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product_a;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan_a, 'in_progress', now())
  RETURNING id INTO v_session_a;

  INSERT INTO production_session_lines (
    production_session_id,
    production_plan_product_id,
    recipe_id,
    product_name,
    planned_quantity,
    actual_produced_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_session_a,
    v_plan_product_a,
    v_recipe_a,
    'TEST_ZERO_COST_106_recipe_A_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_line_a;

  BEGIN
    v_result := complete_production_session(
      v_session_a,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'line_id', v_line_a,
          'actual_produced_quantity', 1
        )
      ),
      v_actor
    );
    RAISE EXCEPTION
      'SCENARIO A FAIL: complete_production_session succeeded (%); expected zero-cost RAISE',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO A FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Set Cost per unit in Inventory and try again.%' THEN
        RAISE EXCEPTION
          'SCENARIO A unexpected error (guard not reached or wrong RAISE): %',
          v_err;
      END IF;
      RAISE NOTICE 'SCENARIO A PASS: %', v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario B: assembly FIFO from a zero unit_cost production_batch
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (
    name,
    unit,
    current_stock,
    minimum_stock,
    cost_per_unit,
    active
  )
  VALUES (
    'TEST_ZERO_COST_106_ing_B_' || v_suffix,
    'kg',
    100,
    0,
    1.50,
    true
  )
  RETURNING id INTO v_ing_b;

  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_ZERO_COST_106_component_B_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_component;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe_component, v_ing_b, 1, 'kg');

  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_ZERO_COST_106_assembly_B_' || v_suffix,
    1,
    'pcs',
    true,
    'assembly'
  )
  RETURNING id INTO v_recipe_assembly;

  INSERT INTO recipe_components (
    assembly_recipe_id,
    component_recipe_id,
    ingredient_id,
    quantity,
    unit
  )
  VALUES (
    v_recipe_assembly,
    v_recipe_component,
    NULL,
    1,
    'pcs'
  );

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_ZERO_COST_106_plan_dummy_B_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan_dummy;

  INSERT INTO production_plan_products (
    production_plan_id,
    recipe_id,
    recipe_name,
    planned_quantity,
    yield_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_plan_dummy,
    v_recipe_component,
    'TEST_ZERO_COST_106_component_B_' || v_suffix,
    10,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product_dummy;

  -- Dummy session must be in_progress while its line is inserted:
  -- enforce_open_production_session_line_mutation (sql/007, never
  -- replaced) is BEFORE INSERT OR UPDATE ON production_session_lines
  -- and RAISES when the parent session status IN ('completed','cancelled').
  -- It does not fire on production_sessions itself, so we close the
  -- dummy session only after the line exists.
  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan_dummy, 'in_progress', now())
  RETURNING id INTO v_session_dummy;

  INSERT INTO production_session_lines (
    production_session_id,
    production_plan_product_id,
    recipe_id,
    product_name,
    planned_quantity,
    actual_produced_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_session_dummy,
    v_plan_product_dummy,
    v_recipe_component,
    'TEST_ZERO_COST_106_component_B_' || v_suffix,
    10,
    10,
    'pcs',
    1
  )
  RETURNING id INTO v_line_dummy;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session_dummy;

  INSERT INTO production_batches (
    production_session_id,
    production_session_line_id,
    finished_good_id,
    recipe_id,
    produced_quantity,
    unit_cost,
    produced_at
  )
  VALUES (
    v_session_dummy,
    v_line_dummy,
    v_recipe_component,
    v_recipe_component,
    10,
    0,
    now() - interval '1 hour'
  );

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_ZERO_COST_106_plan_B_' || v_suffix,
    CURRENT_DATE,
    'ready_to_produce'
  )
  RETURNING id INTO v_plan_b;

  INSERT INTO production_plan_products (
    production_plan_id,
    recipe_id,
    recipe_name,
    planned_quantity,
    yield_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_plan_b,
    v_recipe_assembly,
    'TEST_ZERO_COST_106_assembly_B_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product_b;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan_b, 'in_progress', now())
  RETURNING id INTO v_session_b;

  INSERT INTO production_session_lines (
    production_session_id,
    production_plan_product_id,
    recipe_id,
    product_name,
    planned_quantity,
    actual_produced_quantity,
    yield_unit,
    sort_order
  )
  VALUES (
    v_session_b,
    v_plan_product_b,
    v_recipe_assembly,
    'TEST_ZERO_COST_106_assembly_B_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_line_b;

  BEGIN
    v_result := complete_production_session(
      v_session_b,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'line_id', v_line_b,
          'actual_produced_quantity', 1
        )
      ),
      v_actor
    );
    RAISE EXCEPTION
      'SCENARIO B FAIL: complete_production_session succeeded (%); expected zero-cost RAISE',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%This cannot be fixed in Inventory%' THEN
        RAISE EXCEPTION
          'SCENARIO B unexpected error (guard not reached or wrong RAISE): %',
          v_err;
      END IF;
      RAISE NOTICE 'SCENARIO B PASS: %', v_err;
  END;

  RAISE NOTICE 'complete_production_session zero-cost: both scenarios passed';
END;
$test$;

ROLLBACK;
