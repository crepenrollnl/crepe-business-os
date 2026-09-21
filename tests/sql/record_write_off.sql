-- SQL test: record_write_off role-guard and physical paths (sql/115, sql/117).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/record_write_off.sql
-- (exit 0). Nested EXCEPTION catches expected RPC RAISE so ROLLBACK
-- still runs. Bootstrap: tests/sql/bootstrap/confirm_sale_and_write_off.list
-- (applied by the preceding sql-tests.yml step in CI).
--
-- Scenarios:
--   A — seller-role caller is rejected (42501 / Insufficient permissions)
--   B — ingredient write-off decrements stock and writes waste_out + write_offs
--   C — finished-good write-off FIFO-allocates waste and writes both ledgers
--   D — invalid item_type is rejected
--
-- Seller emulation: UPDATE the same owner profiles row to 'seller', then
-- restore (sql/117 / sql/119 dry-run pattern). No second profiles row.
--
-- Dummy production_batches are inserted directly (same shortcut as
-- tests/sql/confirm_sale_zero_cost.sql).

BEGIN;

CREATE FUNCTION insert_test_fg_batch(
  p_recipe_id uuid,
  p_tag text,
  p_qty numeric,
  p_unit_cost numeric,
  p_suffix text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_session_line uuid;
  v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_WRITE_OFF_plan_' || p_tag || '_' || p_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (
    v_plan, p_recipe_id,
    'TEST_WRITE_OFF_comp_' || p_tag || '_' || p_suffix,
    p_qty, 1, 'pcs', 1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (
    v_session, v_plan_product, p_recipe_id,
    'TEST_WRITE_OFF_comp_' || p_tag || '_' || p_suffix,
    p_qty, p_qty, 'pcs', 1
  )
  RETURNING id INTO v_session_line;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
  WHERE id = v_session;

  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id,
    recipe_id, produced_quantity, unit_cost, produced_at
  )
  VALUES (
    v_session, v_session_line, p_recipe_id, p_recipe_id,
    p_qty, p_unit_cost, now() - interval '1 hour'
  )
  RETURNING id INTO v_batch;

  RETURN v_batch;
END;
$$;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_sqlstate text;
  v_raised boolean;
  v_result jsonb;

  v_ing uuid;
  v_stock_before numeric;
  v_stock_after numeric;
  v_wo_id uuid;
  v_mov_count integer;
  v_wo_count integer;
  v_wo_value numeric;
  v_wo_type text;

  v_recipe uuid;
  v_batch uuid;
  v_consumed numeric;
  v_alloc_cost numeric;
BEGIN
  RAISE NOTICE 'auth.uid() live def: %', pg_get_functiondef('auth.uid()'::regprocedure);
  RAISE NOTICE 'require_role live def: %', pg_get_functiondef('require_role(text[])'::regprocedure);

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

  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (
    'TEST_WRITE_OFF_ing_' || v_suffix,
    'kg', 100, 0, 1.50, true
  )
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_WRITE_OFF_comp_' || v_suffix, 1, 'pcs', true, 'component'
  )
  RETURNING id INTO v_recipe;

  v_batch := insert_test_fg_batch(v_recipe, 'C', 5, 2.00, v_suffix);

  -- ========================================================================
  -- SCENARIO A: seller-role caller is rejected before any stock mutation
  -- ========================================================================
  SELECT current_stock INTO v_stock_before
  FROM ingredients WHERE id = v_ing;

  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'ingredient',
      v_ing,
      NULL,
      3,
      'spoilage',
      NULL
    );
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION 'SCENARIO A FAIL: seller-role caller unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      IF v_err LIKE 'SCENARIO A FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         AND v_err NOT LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION
          'SCENARIO A unexpected error (sqlstate=%): %',
          v_sqlstate, v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO A PASS (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: seller-role caller was not blocked';
  END IF;

  IF (SELECT role FROM profiles WHERE auth_user_id = v_actor)
     IS DISTINCT FROM v_original_role THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: profiles.role was not restored';
  END IF;

  IF (SELECT current_stock FROM ingredients WHERE id = v_ing)
     IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: ingredient stock changed for seller call';
  END IF;

  -- ========================================================================
  -- SCENARIO B: ingredient write-off as owner
  -- ========================================================================
  SELECT current_stock INTO v_stock_before
  FROM ingredients WHERE id = v_ing;

  v_result := record_write_off(
    'ingredient',
    v_ing,
    NULL,
    3,
    'spoilage',
    'TEST fridge'
  );

  v_wo_id := (v_result ->> 'id')::uuid;
  IF v_wo_id IS NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: record_write_off returned no id (%)', v_result;
  END IF;

  IF (v_result ->> 'item_type') IS DISTINCT FROM 'ingredient' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: item_type is %', v_result ->> 'item_type';
  END IF;

  IF (v_result ->> 'total_value')::numeric IS DISTINCT FROM 4.50 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: total_value is % (expected 4.50 = 3 × 1.50)',
      (v_result ->> 'total_value')::numeric;
  END IF;

  SELECT current_stock INTO v_stock_after
  FROM ingredients WHERE id = v_ing;
  IF v_stock_after IS DISTINCT FROM (v_stock_before - 3) THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: ingredient stock % → % (expected decrement of 3)',
      v_stock_before, v_stock_after;
  END IF;

  SELECT count(*) INTO v_mov_count
  FROM stock_movements
  WHERE reference_type = 'write_off'
    AND reference_id = v_wo_id
    AND movement_type = 'waste_out'
    AND ingredient_id = v_ing
    AND quantity = 3;

  IF v_mov_count <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: expected 1 waste_out/write_off movement, found %',
      v_mov_count;
  END IF;

  SELECT count(*), min(total_value), min(item_type)
  INTO v_wo_count, v_wo_value, v_wo_type
  FROM write_offs
  WHERE id = v_wo_id;

  IF v_wo_count <> 1
     OR v_wo_type IS DISTINCT FROM 'ingredient'
     OR v_wo_value IS DISTINCT FROM 4.50 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: write_offs row count=% type=% value=%',
      v_wo_count, v_wo_type, v_wo_value;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: ingredient write-off % total_value=4.50', v_wo_id;

  -- ========================================================================
  -- SCENARIO C: finished-good write-off as owner
  -- ========================================================================
  v_result := record_write_off(
    'finished_good',
    NULL,
    v_recipe,
    2,
    'quality_reject',
    NULL
  );

  v_wo_id := (v_result ->> 'id')::uuid;
  IF v_wo_id IS NULL THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: record_write_off returned no id (%)', v_result;
  END IF;

  IF (v_result ->> 'item_type') IS DISTINCT FROM 'finished_good' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: item_type is %', v_result ->> 'item_type';
  END IF;

  v_alloc_cost := (v_result ->> 'total_value')::numeric;
  IF v_alloc_cost IS DISTINCT FROM 4.00 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: total_value is % (expected 4.00 = 2 × 2.00)',
      v_alloc_cost;
  END IF;

  SELECT COALESCE(sum(quantity), 0), COALESCE(sum(total_cost), 0)
  INTO v_consumed, v_wo_value
  FROM finished_goods_batch_consumptions
  WHERE source_type = 'waste_ticket'
    AND source_id = v_wo_id
    AND production_batch_id = v_batch;

  IF v_consumed IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: FIFO consumed qty % from batch % (expected 2)',
      v_consumed, v_batch;
  END IF;

  IF v_wo_value IS DISTINCT FROM v_alloc_cost THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: consumption total_cost % <> write-off total_value %',
      v_wo_value, v_alloc_cost;
  END IF;

  SELECT count(*) INTO v_mov_count
  FROM stock_movements
  WHERE reference_type = 'write_off'
    AND reference_id = v_wo_id
    AND movement_type = 'waste_out'
    AND product_id = v_recipe
    AND quantity = 2;

  IF v_mov_count <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: expected 1 waste_out/write_off FG movement, found %',
      v_mov_count;
  END IF;

  SELECT count(*), min(item_type), min(total_value)
  INTO v_wo_count, v_wo_type, v_wo_value
  FROM write_offs
  WHERE id = v_wo_id;

  IF v_wo_count <> 1
     OR v_wo_type IS DISTINCT FROM 'finished_good'
     OR v_wo_value IS DISTINCT FROM v_alloc_cost THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: write_offs row count=% type=% value=%',
      v_wo_count, v_wo_type, v_wo_value;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS: finished-good write-off % total_value=%', v_wo_id, v_alloc_cost;

  -- ========================================================================
  -- SCENARIO D: invalid item_type
  -- ========================================================================
  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'widget',
      v_ing,
      NULL,
      1,
      'spoilage',
      NULL
    );
    RAISE EXCEPTION 'SCENARIO D FAIL: invalid item_type unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Write-off item type must be ingredient or finished_good.' THEN
        RAISE EXCEPTION 'SCENARIO D unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO D PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: invalid item_type was not blocked';
  END IF;

  RAISE NOTICE 'sql/record_write_off: all scenarios passed';
END;
$test$;

ROLLBACK;
