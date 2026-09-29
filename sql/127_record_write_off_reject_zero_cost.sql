-- Reject record_write_off when an ingredient has no unit cost, or when
-- FIFO allocates a finished-goods layer with unit_cost <= 0
-- (same class of bug as sql/106 production and sql/120 confirm_sale).
--
-- Run in Supabase SQL editor after sql/126_create_ingredient.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's
-- money-critical protocol:
--   Part 1 dry run (BEGIN...ROLLBACK, self-contained, proves itself and
--          leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone post-commit verification queries run OUTSIDE any
--          transaction
--
-- Live record_write_off body is the second CREATE OR REPLACE in
-- sql/117_role_guard_journals_fifo_writeoffs.sql (nothing after 117
-- replaces it). This file is that body plus two RAISE guards:
--   1. ingredient path: after the FOR UPDATE SELECT, before
--      decrement_ingredient_stock
--   2. finished_good path: allocations[] after allocate_finished_goods_fifo
-- Predicate matches sql/106 / sql/120: quantity > 0 AND
-- COALESCE(unit_cost, 0) <= 0. First hit RAISES immediately (no
-- name-batching). Same transaction, so any FIFO writes already done in
-- that call roll back with the RAISE.
--
-- Does NOT:
--   - put the guard inside allocate_finished_goods_fifo (callers of
--     that helper still own their own cost policy)
--   - change COALESCE(cost_per_unit, 0) on the write-off arithmetic
--   - change TypeScript / WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- Known dry-run note: unit_cost = 0 production_batches are inserted
-- directly (same shortcut as sql/118 / sql/120). complete_production
-- can no longer create those rows after sql/106.

-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back). Copy everything between "-- >>> DRY RUN START" and
-- "-- <<< DRY RUN END" into the Supabase SQL Editor and run it FIRST.
--
--   (A) ingredient write-off with valid cost — succeeds, total_value
--       matches qty × cost_per_unit
--   (B) ingredient write-off with cost_per_unit = 0 AND with NULL —
--       both rejected with the exact new RAISE text; stock unchanged
--   (C) finished-good write-off from a single valid-cost batch — succeeds
--   (D) finished-good write-off from a single zero-cost batch — rejected
--   (E) finished-good write-off that draws FIFO from TWO batches, older
--       zero-cost then later priced — still rejected (per-layer, not
--       total_value)
--   (F) seller-role caller rejected (require_role); stock unchanged
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION record_write_off(
  p_item_type text,
  p_ingredient_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unit_cost numeric(12, 4) := 0;
  v_total_value numeric(14, 4) := 0;
  v_allocation jsonb;
  v_ingredient_name text;
  v_product_name text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good') THEN
    RAISE EXCEPTION 'Write-off item type must be ingredient or finished_good.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'An ingredient write-off requires ingredient_id and no product_id.';
    END IF;

    SELECT name, COALESCE(cost_per_unit, 0)
    INTO v_ingredient_name, v_unit_cost
    FROM ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
    END IF;

    IF v_unit_cost <= 0 THEN
      RAISE EXCEPTION
        'Cannot record write-off. Ingredient "%" has no unit cost set. Set Cost per unit in Inventory and try again.',
        v_ingredient_name;
    END IF;

    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);

    v_total_value := round(p_quantity * v_unit_cost, 4);

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      p_ingredient_id,
      NULL,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'ingredient',
      p_ingredient_id,
      NULL,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  ELSE
    IF p_product_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'A finished-good write-off requires product_id and no ingredient_id.';
    END IF;

    SELECT name
    INTO v_product_name
    FROM recipes
    WHERE id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    v_allocation := allocate_finished_goods_fifo(
      p_product_id,
      p_quantity,
      'waste',
      'waste_ticket',
      v_id,
      v_note,
      auth.uid()
    );

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(v_allocation -> 'allocations', '[]'::jsonb)
      ) AS layer
      WHERE COALESCE((layer ->> 'quantity')::numeric, 0) > 0
        AND COALESCE((layer ->> 'unit_cost')::numeric, 0) <= 0
    ) THEN
      RAISE EXCEPTION
        'Cannot record write-off. Product "%" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
        v_product_name;
    END IF;

    v_total_value := COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    IF p_quantity > 0 THEN
      v_unit_cost := round(v_total_value / p_quantity, 4);
    END IF;

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      NULL,
      p_product_id,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'finished_good',
      NULL,
      p_product_id,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'item_type', p_item_type,
    'total_value', v_total_value
  );
END;
$$;

COMMENT ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) IS
  'Record a physical write-off. Ingredients: decrement_ingredient_stock + waste_out movement. Finished goods: allocate_finished_goods_fifo(waste, waste_ticket). Rejects ingredient cost_per_unit <= 0 and FIFO layers with unit_cost <= 0 (sql/127). Does not post journals. Requires owner/partner (sql/117).';

REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) TO authenticated;

CREATE FUNCTION insert_test_write_off_127_fg_batch(
  p_recipe_id uuid,
  p_tag text,
  p_qty numeric,
  p_unit_cost numeric,
  p_suffix text,
  p_produced_at timestamptz
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
    'TEST_WRITE_OFF_127_plan_' || p_tag || '_' || p_suffix,
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
    'TEST_WRITE_OFF_127_comp_' || p_tag || '_' || p_suffix,
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
    'TEST_WRITE_OFF_127_comp_' || p_tag || '_' || p_suffix,
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
    p_qty, p_unit_cost, p_produced_at
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

  v_ing_a uuid;
  v_ing_a_name text;
  v_stock_a_before numeric;
  v_stock_a_after numeric;
  v_wo_id uuid;
  v_mov_count integer;
  v_wo_count integer;
  v_wo_value numeric;

  v_ing_b0 uuid;
  v_ing_b0_name text;
  v_stock_b0_before numeric;
  v_stock_b0_after numeric;
  v_expected_b0 text;

  v_ing_bnull uuid;
  v_ing_bnull_name text;
  v_stock_bnull_before numeric;
  v_stock_bnull_after numeric;
  v_expected_bnull text;

  v_recipe_c uuid;
  v_recipe_c_name text;
  v_batch_c uuid;
  v_consumed numeric;
  v_alloc_cost numeric;

  v_recipe_d uuid;
  v_recipe_d_name text;
  v_batch_d uuid;
  v_expected_d text;
  v_fifo_d_before integer;
  v_fifo_d_after integer;

  v_recipe_e uuid;
  v_recipe_e_name text;
  v_batch_e_zero uuid;
  v_batch_e_priced uuid;
  v_expected_e text;
  v_fifo_e_before integer;
  v_fifo_e_after integer;

  v_stock_f_before numeric;
  v_stock_f_after numeric;
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

  RAISE NOTICE 'JWT emulated auth.uid()=% get_my_role()=%', auth.uid(), get_my_role();

  -- ========================================================================
  -- SCENARIO A: ingredient write-off with valid cost_per_unit
  -- ========================================================================
  v_ing_a_name := 'TEST_WRITE_OFF_127_ing_A_' || v_suffix;
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (v_ing_a_name, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing_a;

  SELECT current_stock INTO v_stock_a_before
  FROM ingredients WHERE id = v_ing_a;

  v_result := record_write_off(
    'ingredient',
    v_ing_a,
    NULL,
    3,
    'spoilage',
    'TEST fridge'
  );

  v_wo_id := (v_result ->> 'id')::uuid;
  IF v_wo_id IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: record_write_off returned no id (%)', v_result;
  END IF;

  IF (v_result ->> 'item_type') IS DISTINCT FROM 'ingredient' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: item_type is %', v_result ->> 'item_type';
  END IF;

  IF (v_result ->> 'total_value')::numeric IS DISTINCT FROM 4.50 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: total_value is % (expected 4.50 = 3 × 1.50)',
      (v_result ->> 'total_value')::numeric;
  END IF;

  SELECT current_stock INTO v_stock_a_after
  FROM ingredients WHERE id = v_ing_a;
  IF v_stock_a_after IS DISTINCT FROM (v_stock_a_before - 3) THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: ingredient stock % → % (expected decrement of 3)',
      v_stock_a_before, v_stock_a_after;
  END IF;

  SELECT count(*) INTO v_mov_count
  FROM stock_movements
  WHERE reference_type = 'write_off'
    AND reference_id = v_wo_id
    AND movement_type = 'waste_out'
    AND ingredient_id = v_ing_a
    AND quantity = 3
    AND unit_cost = 1.50;

  IF v_mov_count <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: expected 1 waste_out/write_off movement, found %',
      v_mov_count;
  END IF;

  SELECT count(*), min(total_value)
  INTO v_wo_count, v_wo_value
  FROM write_offs
  WHERE id = v_wo_id
    AND item_type = 'ingredient'
    AND unit_cost = 1.50;

  IF v_wo_count <> 1 OR v_wo_value IS DISTINCT FROM 4.50 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: write_offs row count=% value=%',
      v_wo_count, v_wo_value;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: ingredient write-off % total_value=4.50', v_wo_id;

  -- ========================================================================
  -- SCENARIO B: ingredient write-off with cost_per_unit = 0 and with NULL
  -- ========================================================================
  v_ing_b0_name := 'TEST_WRITE_OFF_127_ing_B0_' || v_suffix;
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (v_ing_b0_name, 'kg', 100, 0, 0, true)
  RETURNING id INTO v_ing_b0;

  v_expected_b0 :=
    'Cannot record write-off. Ingredient "'
    || v_ing_b0_name
    || '" has no unit cost set. Set Cost per unit in Inventory and try again.';

  SELECT current_stock INTO v_stock_b0_before
  FROM ingredients WHERE id = v_ing_b0;

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'ingredient',
      v_ing_b0,
      NULL,
      2,
      'spoilage',
      NULL
    );
    RAISE EXCEPTION 'SCENARIO B FAIL: zero-cost ingredient write-off succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM v_expected_b0 THEN
        RAISE EXCEPTION
          'SCENARIO B unexpected zero-cost error (got %; expected %)',
          v_err, v_expected_b0;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO B PASS (cost_per_unit=0): %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: zero-cost ingredient was not blocked';
  END IF;

  SELECT current_stock INTO v_stock_b0_after
  FROM ingredients WHERE id = v_ing_b0;
  IF v_stock_b0_after IS DISTINCT FROM v_stock_b0_before THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: zero-cost ingredient stock changed (% → %)',
      v_stock_b0_before, v_stock_b0_after;
  END IF;

  IF EXISTS (
    SELECT 1 FROM write_offs WHERE ingredient_id = v_ing_b0
  ) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: write_offs row created for zero-cost ingredient';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM stock_movements
    WHERE ingredient_id = v_ing_b0
      AND movement_type = 'waste_out'
  ) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: waste_out movement created for zero-cost ingredient';
  END IF;

  v_ing_bnull_name := 'TEST_WRITE_OFF_127_ing_Bnull_' || v_suffix;
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (v_ing_bnull_name, 'kg', 100, 0, NULL, true)
  RETURNING id INTO v_ing_bnull;

  v_expected_bnull :=
    'Cannot record write-off. Ingredient "'
    || v_ing_bnull_name
    || '" has no unit cost set. Set Cost per unit in Inventory and try again.';

  SELECT current_stock INTO v_stock_bnull_before
  FROM ingredients WHERE id = v_ing_bnull;

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'ingredient',
      v_ing_bnull,
      NULL,
      2,
      'damaged',
      NULL
    );
    RAISE EXCEPTION 'SCENARIO B FAIL: null-cost ingredient write-off succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM v_expected_bnull THEN
        RAISE EXCEPTION
          'SCENARIO B unexpected null-cost error (got %; expected %)',
          v_err, v_expected_bnull;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO B PASS (cost_per_unit=NULL): %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: null-cost ingredient was not blocked';
  END IF;

  SELECT current_stock INTO v_stock_bnull_after
  FROM ingredients WHERE id = v_ing_bnull;
  IF v_stock_bnull_after IS DISTINCT FROM v_stock_bnull_before THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: null-cost ingredient stock changed (% → %)',
      v_stock_bnull_before, v_stock_bnull_after;
  END IF;

  -- ========================================================================
  -- SCENARIO C: finished-good write-off from a single valid-cost batch
  -- ========================================================================
  v_recipe_c_name := 'TEST_WRITE_OFF_127_comp_C_' || v_suffix;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (v_recipe_c_name, 1, 'pcs', true, 'component')
  RETURNING id INTO v_recipe_c;

  v_batch_c := insert_test_write_off_127_fg_batch(
    v_recipe_c, 'C', 5, 2.00, v_suffix, now() - interval '1 hour'
  );

  v_result := record_write_off(
    'finished_good',
    NULL,
    v_recipe_c,
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
    AND production_batch_id = v_batch_c;

  IF v_consumed IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: FIFO consumed qty % from batch % (expected 2)',
      v_consumed, v_batch_c;
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
    AND product_id = v_recipe_c
    AND quantity = 2
    AND unit_cost = 2.00;

  IF v_mov_count <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: expected 1 waste_out/write_off FG movement, found %',
      v_mov_count;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS: finished-good write-off % total_value=4.00', v_wo_id;

  -- ========================================================================
  -- SCENARIO D: finished-good write-off from a single zero-cost batch
  -- ========================================================================
  v_recipe_d_name := 'TEST_WRITE_OFF_127_comp_D_' || v_suffix;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (v_recipe_d_name, 1, 'pcs', true, 'component')
  RETURNING id INTO v_recipe_d;

  v_batch_d := insert_test_write_off_127_fg_batch(
    v_recipe_d, 'D', 5, 0, v_suffix, now() - interval '1 hour'
  );

  v_expected_d :=
    'Cannot record write-off. Product "'
    || v_recipe_d_name
    || '" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.';

  SELECT count(*) INTO v_fifo_d_before
  FROM finished_goods_batch_consumptions
  WHERE production_batch_id = v_batch_d;

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'finished_good',
      NULL,
      v_recipe_d,
      1,
      'spoilage',
      NULL
    );
    RAISE EXCEPTION 'SCENARIO D FAIL: zero-cost FG write-off succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM v_expected_d THEN
        RAISE EXCEPTION
          'SCENARIO D unexpected error (got %; expected %)',
          v_err, v_expected_d;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO D PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: zero-cost FG was not blocked';
  END IF;

  SELECT count(*) INTO v_fifo_d_after
  FROM finished_goods_batch_consumptions
  WHERE production_batch_id = v_batch_d;

  IF v_fifo_d_after IS DISTINCT FROM v_fifo_d_before THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: FIFO consumption persisted after RAISE (% → %)',
      v_fifo_d_before, v_fifo_d_after;
  END IF;

  IF EXISTS (
    SELECT 1 FROM write_offs WHERE product_id = v_recipe_d
  ) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: write_offs row created for zero-cost FG';
  END IF;

  -- ========================================================================
  -- SCENARIO E: mixed FIFO — older zero-cost batch + later priced batch.
  -- Write-off qty 3 takes 2 from the zero-cost layer then 1 from the
  -- priced layer. Aggregate total_cost would be 2.00 (> 0), so a
  -- total_value <= 0 check would wrongly allow this. Per-layer must reject.
  -- ========================================================================
  v_recipe_e_name := 'TEST_WRITE_OFF_127_comp_E_' || v_suffix;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (v_recipe_e_name, 1, 'pcs', true, 'component')
  RETURNING id INTO v_recipe_e;

  v_batch_e_zero := insert_test_write_off_127_fg_batch(
    v_recipe_e, 'E0', 2, 0, v_suffix, now() - interval '2 hours'
  );
  v_batch_e_priced := insert_test_write_off_127_fg_batch(
    v_recipe_e, 'E1', 5, 2.00, v_suffix, now() - interval '1 hour'
  );

  IF (SELECT produced_at FROM production_batches WHERE id = v_batch_e_zero)
     >= (SELECT produced_at FROM production_batches WHERE id = v_batch_e_priced)
  THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: test setup — zero-cost batch is not strictly older';
  END IF;

  IF (SELECT unit_cost FROM production_batches WHERE id = v_batch_e_zero)
     IS DISTINCT FROM 0
     OR (SELECT unit_cost FROM production_batches WHERE id = v_batch_e_priced)
        IS DISTINCT FROM 2.00
  THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: test setup — batch costs are not 0 then 2.00';
  END IF;

  v_expected_e :=
    'Cannot record write-off. Product "'
    || v_recipe_e_name
    || '" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.';

  SELECT count(*) INTO v_fifo_e_before
  FROM finished_goods_batch_consumptions
  WHERE production_batch_id IN (v_batch_e_zero, v_batch_e_priced);

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'finished_good',
      NULL,
      v_recipe_e,
      3,
      'spoilage',
      NULL
    );
    RAISE EXCEPTION
      'SCENARIO E FAIL: mixed FIFO write-off succeeded (would mean the guard checked total_value, not layers)';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM v_expected_e THEN
        RAISE EXCEPTION
          'SCENARIO E unexpected error (got %; expected %)',
          v_err, v_expected_e;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO E PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: mixed FIFO was not blocked';
  END IF;

  SELECT count(*) INTO v_fifo_e_after
  FROM finished_goods_batch_consumptions
  WHERE production_batch_id IN (v_batch_e_zero, v_batch_e_priced);

  IF v_fifo_e_after IS DISTINCT FROM v_fifo_e_before THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: FIFO consumption persisted after RAISE (% → %)',
      v_fifo_e_before, v_fifo_e_after;
  END IF;

  IF EXISTS (
    SELECT 1 FROM write_offs WHERE product_id = v_recipe_e
  ) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: write_offs row created for mixed FIFO';
  END IF;

  -- ========================================================================
  -- SCENARIO F: seller-role caller is rejected before any stock mutation
  -- ========================================================================
  SELECT current_stock INTO v_stock_f_before
  FROM ingredients WHERE id = v_ing_a;

  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  v_raised := false;
  BEGIN
    PERFORM record_write_off(
      'ingredient',
      v_ing_a,
      NULL,
      1,
      'spoilage',
      NULL
    );
    UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
    RAISE EXCEPTION 'SCENARIO F FAIL: seller-role caller unexpectedly succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         AND v_err NOT LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION
          'SCENARIO F unexpected error (sqlstate=%): %',
          v_sqlstate, v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO F PASS (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: seller-role caller was not blocked';
  END IF;

  IF (SELECT role FROM profiles WHERE auth_user_id = v_actor)
     IS DISTINCT FROM v_original_role THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: profiles.role was not restored';
  END IF;

  SELECT current_stock INTO v_stock_f_after
  FROM ingredients WHERE id = v_ing_a;
  IF v_stock_f_after IS DISTINCT FROM v_stock_f_before THEN
    RAISE EXCEPTION
      'SCENARIO F FAIL: ingredient stock changed for seller call (% → %)',
      v_stock_f_before, v_stock_f_after;
  END IF;

  RAISE NOTICE 'sql/127 dry run: all scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- THE MIGRATION (apply this for real, after Part 1 has passed)
-- Copy everything between "-- >>> MIGRATION START" and
-- "-- <<< MIGRATION END" into the SQL Editor and run it.
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

CREATE OR REPLACE FUNCTION record_write_off(
  p_item_type text,
  p_ingredient_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unit_cost numeric(12, 4) := 0;
  v_total_value numeric(14, 4) := 0;
  v_allocation jsonb;
  v_ingredient_name text;
  v_product_name text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good') THEN
    RAISE EXCEPTION 'Write-off item type must be ingredient or finished_good.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'An ingredient write-off requires ingredient_id and no product_id.';
    END IF;

    SELECT name, COALESCE(cost_per_unit, 0)
    INTO v_ingredient_name, v_unit_cost
    FROM ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
    END IF;

    IF v_unit_cost <= 0 THEN
      RAISE EXCEPTION
        'Cannot record write-off. Ingredient "%" has no unit cost set. Set Cost per unit in Inventory and try again.',
        v_ingredient_name;
    END IF;

    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);

    v_total_value := round(p_quantity * v_unit_cost, 4);

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      p_ingredient_id,
      NULL,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'ingredient',
      p_ingredient_id,
      NULL,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  ELSE
    IF p_product_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'A finished-good write-off requires product_id and no ingredient_id.';
    END IF;

    SELECT name
    INTO v_product_name
    FROM recipes
    WHERE id = p_product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    v_allocation := allocate_finished_goods_fifo(
      p_product_id,
      p_quantity,
      'waste',
      'waste_ticket',
      v_id,
      v_note,
      auth.uid()
    );

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        COALESCE(v_allocation -> 'allocations', '[]'::jsonb)
      ) AS layer
      WHERE COALESCE((layer ->> 'quantity')::numeric, 0) > 0
        AND COALESCE((layer ->> 'unit_cost')::numeric, 0) <= 0
    ) THEN
      RAISE EXCEPTION
        'Cannot record write-off. Product "%" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
        v_product_name;
    END IF;

    v_total_value := COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    IF p_quantity > 0 THEN
      v_unit_cost := round(v_total_value / p_quantity, 4);
    END IF;

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      NULL,
      p_product_id,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'finished_good',
      NULL,
      p_product_id,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'item_type', p_item_type,
    'total_value', v_total_value
  );
END;
$$;

COMMENT ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) IS
  'Record a physical write-off. Ingredients: decrement_ingredient_stock + waste_out movement. Finished goods: allocate_finished_goods_fifo(waste, waste_ticket). Rejects ingredient cost_per_unit <= 0 and FIFO layers with unit_cost <= 0 (sql/127). Does not post journals. Requires owner/partner (sql/117).';

REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) TO authenticated;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run AFTER Part 2
-- has committed, in a fresh SQL Editor tab, NOT inside a transaction).
-- Catalog-only: proves the two new RAISE strings are in the committed
-- body. Does not re-run the scenarios (those are Part 1).
-- ============================================================================

SELECT
  pg_get_functiondef('public.record_write_off'::regproc)
    LIKE '%has no unit cost set%'
    AS has_ingredient_guard,
  pg_get_functiondef('public.record_write_off'::regproc)
    LIKE '%Product % was allocated from a batch with no unit cost%'
    AS has_product_batch_guard;
-- Expect: true, true.
