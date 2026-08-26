-- SQL test: allocate_finished_goods_fifo (sql/011 → sql/085 → sql/087).
-- Direct RPC coverage. Does not go through complete_production_session.
--
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/allocate_finished_goods_fifo.sql
-- (exit 0). Nested EXCEPTION catches expected RPC RAISE so ROLLBACK
-- still runs. Bootstrap: tests/sql/bootstrap/complete_production_session.list
-- (same list as complete_production_session_zero_cost.sql — no extra files).
--
-- Scenarios:
--   A — FIFO order + split across two batches (5@2.00 then 3@3.00 = 19.00)
--   B — insufficient stock; no leftover consumption rows after RAISE
--   C — duplicate-source guard is (source_type, source_id, product)
--   D — unit_cost = 0 is allocated (zero-cost guard lives on sql/106 only)
--   E — rounding regression (sql/087/088): total_cost = round(qty * unit_cost, 4)
--   F — input validation (six exact RAISE texts)
--
-- Actor: prefer an existing owner/partner profile (manual SQL Editor).
-- On ephemeral Postgres, insert a disposable auth.users + profiles row
-- (stub auth.users is id-only).
-- JWT: SET LOCAL request.jwt.claim.sub + request.jwt.claims so auth.uid()
-- matches the live V1 formula copied into tests/sql/bootstrap/prelude_auth.sql.

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_line uuid;

  v_recipe_a uuid;
  v_batch_a1 uuid;
  v_batch_a2 uuid;
  v_source_a uuid;

  v_recipe_b uuid;
  v_batch_b uuid;
  v_source_b uuid;
  v_cnt integer;

  v_recipe_c1 uuid;
  v_recipe_c2 uuid;
  v_batch_c1 uuid;
  v_batch_c2 uuid;
  v_source_c uuid;

  v_recipe_d uuid;
  v_batch_d uuid;
  v_source_d uuid;

  v_recipe_e uuid;
  v_batch_e uuid;
  v_source_e uuid;
  v_qty_e numeric := 0.003;
  v_unit_cost_e numeric := 1.1111;
  v_expected_total_e numeric;

  v_source_f uuid;
  v_missing_product uuid;

  v_alloc_0 jsonb;
  v_alloc_1 jsonb;
  v_err text;
  v_sqlstate text;
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

  -- Dummy completed session + one production_batch.
  -- Session must be in_progress while its line is inserted:
  -- enforce_open_production_session_line_mutation (sql/007) RAISES when
  -- the parent session status IN ('completed','cancelled'). Close after
  -- the line exists. Batches are inserted directly (FIFO under test is
  -- the allocator, not complete_production_session).
  -- ------------------------------------------------------------------
  -- Scenario A: FIFO order and split across two batches
  -- ------------------------------------------------------------------
  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_A_recipe_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_a;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_A_plan1_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_a,
    'TEST_FIFO_A_recipe_' || v_suffix,
    5,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_a,
    'TEST_FIFO_A_recipe_' || v_suffix,
    5,
    5,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_a,
    v_recipe_a,
    5,
    2.00,
    now() - interval '2 hours'
  )
  RETURNING id INTO v_batch_a1;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_A_plan2_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_a,
    'TEST_FIFO_A_recipe_' || v_suffix,
    10,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_a,
    'TEST_FIFO_A_recipe_' || v_suffix,
    10,
    10,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_a,
    v_recipe_a,
    10,
    3.00,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_a2;

  v_source_a := gen_random_uuid();

  BEGIN
    v_result := allocate_finished_goods_fifo(
      v_recipe_a,
      8,
      'sale',
      'sale_line',
      v_source_a,
      NULL,
      v_actor
    );

    IF (v_result->>'allocated_quantity')::numeric IS DISTINCT FROM 8 THEN
      RAISE EXCEPTION
        'SCENARIO A FAIL: allocated_quantity=% expected 8; result=%',
        v_result->>'allocated_quantity',
        v_result;
    END IF;

    IF (v_result->>'total_cost')::numeric IS DISTINCT FROM 19.00 THEN
      RAISE EXCEPTION
        'SCENARIO A FAIL: total_cost=% expected 19.00 (5*2.00 + 3*3.00); result=%',
        v_result->>'total_cost',
        v_result;
    END IF;

    IF jsonb_array_length(v_result->'allocations') IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION
        'SCENARIO A FAIL: allocations length=% expected 2; result=%',
        jsonb_array_length(v_result->'allocations'),
        v_result;
    END IF;

    v_alloc_0 := v_result->'allocations'->0;
    v_alloc_1 := v_result->'allocations'->1;

    IF (v_alloc_0->>'production_batch_id')::uuid IS DISTINCT FROM v_batch_a1
       OR (v_alloc_0->>'quantity')::numeric IS DISTINCT FROM 5 THEN
      RAISE EXCEPTION
        'SCENARIO A FAIL: allocations[0] should be Batch1 % qty=5, got %',
        v_batch_a1,
        v_alloc_0;
    END IF;

    IF (v_alloc_1->>'production_batch_id')::uuid IS DISTINCT FROM v_batch_a2
       OR (v_alloc_1->>'quantity')::numeric IS DISTINCT FROM 3 THEN
      RAISE EXCEPTION
        'SCENARIO A FAIL: allocations[1] should be Batch2 % qty=3, got %',
        v_batch_a2,
        v_alloc_1;
    END IF;

    RAISE NOTICE
      'SCENARIO A PASS: FIFO split Batch1 qty=5 then Batch2 qty=3, allocated_quantity=8, total_cost=19.00';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO A FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'SCENARIO A unexpected error: %', v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario B: insufficient stock; no partial consumption rows
  -- ------------------------------------------------------------------
  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_B_recipe_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_b;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_B_plan_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_b,
    'TEST_FIFO_B_recipe_' || v_suffix,
    3,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_b,
    'TEST_FIFO_B_recipe_' || v_suffix,
    3,
    3,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_b,
    v_recipe_b,
    3,
    1.50,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_b;

  v_source_b := gen_random_uuid();

  BEGIN
    v_result := allocate_finished_goods_fifo(
      v_recipe_b,
      5,
      'sale',
      'sale_line',
      v_source_b,
      NULL,
      v_actor
    );
    RAISE EXCEPTION
      'SCENARIO B FAIL: allocate_finished_goods_fifo succeeded (%); expected insufficient-stock RAISE',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM 'Insufficient finished goods stock for this product.' THEN
        RAISE EXCEPTION
          'SCENARIO B unexpected error (guard not reached or wrong RAISE): %',
          v_err;
      END IF;

      SELECT count(*)
      INTO v_cnt
      FROM finished_goods_batch_consumptions
      WHERE production_batch_id = v_batch_b;

      IF v_cnt > 0 THEN
        RAISE EXCEPTION
          'SCENARIO B FAIL: expected 0 consumption rows after insufficient-stock RAISE, found %',
          v_cnt;
      END IF;

      RAISE NOTICE 'SCENARIO B PASS: %', v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario C: duplicate-source guard is per (source_type, source_id, product)
  -- ------------------------------------------------------------------
  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_C_P1_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_c1;

  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_C_P2_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_c2;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_C_plan1_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_c1,
    'TEST_FIFO_C_P1_' || v_suffix,
    5,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_c1,
    'TEST_FIFO_C_P1_' || v_suffix,
    5,
    5,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_c1,
    v_recipe_c1,
    5,
    1.00,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_c1;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_C_plan2_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_c2,
    'TEST_FIFO_C_P2_' || v_suffix,
    5,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_c2,
    'TEST_FIFO_C_P2_' || v_suffix,
    5,
    5,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_c2,
    v_recipe_c2,
    5,
    1.00,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_c2;

  v_source_c := gen_random_uuid();

  BEGIN
    v_result := allocate_finished_goods_fifo(
      v_recipe_c1,
      1,
      'sale',
      'sale_line',
      v_source_c,
      NULL,
      v_actor
    );

    IF (v_result->>'allocated_quantity')::numeric IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'SCENARIO C FAIL: first P1 allocate expected allocated_quantity=1, got %',
        v_result;
    END IF;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_recipe_c1,
        1,
        'sale',
        'sale_line',
        v_source_c,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO C FAIL: second P1 allocate succeeded (%); expected duplicate-source RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO C FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'This source has already been allocated.' THEN
          RAISE EXCEPTION
            'SCENARIO C FAIL: second P1 call expected duplicate-source text, got: %',
            v_err;
        END IF;
    END;

    v_result := allocate_finished_goods_fifo(
      v_recipe_c2,
      1,
      'sale',
      'sale_line',
      v_source_c,
      NULL,
      v_actor
    );

    IF (v_result->>'allocated_quantity')::numeric IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'SCENARIO C FAIL: third call (P2, same source_id) expected success allocated_quantity=1, got %',
        v_result;
    END IF;

    IF (v_result->'allocations'->0->>'production_batch_id')::uuid
       IS DISTINCT FROM v_batch_c2 THEN
      RAISE EXCEPTION
        'SCENARIO C FAIL: third call should consume P2 batch %, got %',
        v_batch_c2,
        v_result;
    END IF;

    RAISE NOTICE
      'SCENARIO C PASS: P1 first ok, P1 duplicate RAISE, P2 same source_id allocated';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'SCENARIO C unexpected error: %', v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario D: zero unit_cost is allocated (not FIFO's job to reject)
  -- ------------------------------------------------------------------
  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_D_recipe_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_d;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_D_plan_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_d,
    'TEST_FIFO_D_recipe_' || v_suffix,
    4,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_d,
    'TEST_FIFO_D_recipe_' || v_suffix,
    4,
    4,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_d,
    v_recipe_d,
    4,
    0,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_d;

  v_source_d := gen_random_uuid();

  BEGIN
    v_result := allocate_finished_goods_fifo(
      v_recipe_d,
      2,
      'sale',
      'sale_line',
      v_source_d,
      NULL,
      v_actor
    );

    v_alloc_0 := v_result->'allocations'->0;

    IF (v_result->>'allocated_quantity')::numeric IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION
        'SCENARIO D FAIL: allocated_quantity=% expected 2; result=%',
        v_result->>'allocated_quantity',
        v_result;
    END IF;

    IF (v_alloc_0->>'unit_cost')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'SCENARIO D FAIL: allocations[0].unit_cost=% expected 0; result=%',
        v_alloc_0->>'unit_cost',
        v_result;
    END IF;

    IF (v_alloc_0->>'total_cost')::numeric IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION
        'SCENARIO D FAIL: allocations[0].total_cost=% expected 0; result=%',
        v_alloc_0->>'total_cost',
        v_result;
    END IF;

    RAISE NOTICE
      'SCENARIO D PASS: zero unit_cost allocated; allocations[0].unit_cost=0 total_cost=0';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'SCENARIO D unexpected error: %', v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario E: rounding regression (sql/087 insert + sql/088 CHECK)
  -- 0.003 * 1.1111 = 0.0033333, which is not 4dp without round().
  -- ------------------------------------------------------------------
  INSERT INTO recipes (
    name,
    yield_quantity,
    yield_unit,
    is_active,
    recipe_role
  )
  VALUES (
    'TEST_FIFO_E_recipe_' || v_suffix,
    1,
    'pcs',
    true,
    'component'
  )
  RETURNING id INTO v_recipe_e;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_FIFO_E_plan_' || v_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

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
    v_plan,
    v_recipe_e,
    'TEST_FIFO_E_recipe_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (
    production_plan_id,
    status,
    started_at
  )
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

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
    v_session,
    v_plan_product,
    v_recipe_e,
    'TEST_FIFO_E_recipe_' || v_suffix,
    1,
    1,
    'pcs',
    1
  )
  RETURNING id INTO v_line;

  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = now()
  WHERE id = v_session;

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
    v_session,
    v_line,
    v_recipe_e,
    v_recipe_e,
    1,
    v_unit_cost_e,
    now() - interval '1 hour'
  )
  RETURNING id INTO v_batch_e;

  v_source_e := gen_random_uuid();

  BEGIN
    v_result := allocate_finished_goods_fifo(
      v_recipe_e,
      v_qty_e,
      'sale',
      'sale_line',
      v_source_e,
      NULL,
      v_actor
    );

    SELECT round(v_qty_e * v_unit_cost_e, 4)
    INTO v_expected_total_e;

    IF (v_result->'allocations'->0->>'total_cost')::numeric
       IS DISTINCT FROM v_expected_total_e THEN
      RAISE EXCEPTION
        'SCENARIO E FAIL: allocations[0].total_cost=% expected round(0.003 * 1.1111, 4)=%; result=%',
        v_result->'allocations'->0->>'total_cost',
        v_expected_total_e,
        v_result;
    END IF;

    RAISE NOTICE
      'SCENARIO E PASS: no 23514; allocations[0].total_cost=% = round(0.003 * 1.1111, 4)',
      v_expected_total_e;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION
        'SCENARIO E unexpected error (sqlstate=%): %',
        v_sqlstate,
        v_err;
  END;

  -- ------------------------------------------------------------------
  -- Scenario F: input validation (six exact RAISE texts)
  -- ------------------------------------------------------------------
  v_source_f := gen_random_uuid();
  v_missing_product := gen_random_uuid();

  BEGIN
    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_missing_product,
        0,
        'sale',
        'sale_line',
        v_source_f,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: p_quantity=0 succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'Allocation quantity must be greater than zero.' THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: p_quantity=0 expected exact text, got: %',
            v_err;
        END IF;
    END;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_missing_product,
        1,
        'return_restock',
        'sale_line',
        v_source_f,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: p_reason=return_restock succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM
          'Invalid allocation reason. return_restock is not allowed on FIFO outflow allocation.'
        THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: p_reason=return_restock expected exact text, got: %',
            v_err;
        END IF;
    END;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_missing_product,
        1,
        'sale',
        'bogus',
        v_source_f,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: p_source_type=bogus succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'Invalid source type.' THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: p_source_type=bogus expected exact text, got: %',
            v_err;
        END IF;
    END;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_missing_product,
        1,
        'sale',
        'sale_line',
        NULL,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: p_source_id=NULL succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'Source id is required.' THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: p_source_id=NULL expected exact text, got: %',
            v_err;
        END IF;
    END;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        v_missing_product,
        1,
        'sale',
        'sale_line',
        v_source_f,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: missing product succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'Product was not found.' THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: missing product expected exact text, got: %',
            v_err;
        END IF;
    END;

    BEGIN
      v_result := allocate_finished_goods_fifo(
        NULL,
        1,
        'sale',
        'sale_line',
        v_source_f,
        NULL,
        v_actor
      );
      RAISE EXCEPTION
        'SCENARIO F FAIL: p_product_id=NULL succeeded (%); expected RAISE',
        v_result;
    EXCEPTION
      WHEN OTHERS THEN
        v_err := SQLERRM;
        IF v_err LIKE 'SCENARIO F FAIL:%' THEN
          RAISE;
        END IF;
        IF v_err IS DISTINCT FROM 'Product id is required.' THEN
          RAISE EXCEPTION
            'SCENARIO F FAIL: p_product_id=NULL expected exact text, got: %',
            v_err;
        END IF;
    END;

    RAISE NOTICE 'SCENARIO F PASS: all six input validations';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      RAISE EXCEPTION 'SCENARIO F unexpected error: %', v_err;
  END;

  RAISE NOTICE 'allocate_finished_goods_fifo: all six scenarios passed';
END;
$test$;

ROLLBACK;
