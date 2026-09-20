-- Reject confirm_sale when a raw-ingredient add-in has no unit cost, or
-- when FIFO allocates a finished-goods layer with unit_cost <= 0
-- (audit finding #4, widened: all three unguarded sites).
--
-- Run in Supabase SQL editor after sql/119_posting_failures_log.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's
-- money-critical protocol:
--   Part 1 dry run (BEGIN...ROLLBACK, self-contained, proves itself and
--          leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone post-commit verification queries run OUTSIDE any
--          transaction
--
-- Live confirm_sale body was dump-verified against sql/089 (byte-for-byte
-- money logic; only -- 1./-- 2./-- 2a. comments differed). This file is
-- that body plus three RAISE guards:
--   1. assembly + ingredient_id: before decrement_ingredient_stock
--   2. recipe_role = 'component': allocations[] after FIFO
--   3. assembly + component_recipe_id: allocations[] after FIFO
-- Predicate matches sql/106: quantity > 0 AND COALESCE(unit_cost, 0) <= 0.
-- First hit RAISES immediately (no name-batching). Same transaction, so
-- any FIFO writes already done in that call roll back with the RAISE.
--
-- Does NOT:
--   - GRANT/REVOKE confirm_sale (same signature; privileges stay)
--   - change COALESCE(..., 0) on the COGS arithmetic
--   - touch record_write_off (sql/117) — separate finding
--   - change TypeScript / RAW_POSTGRES_ERROR_PATTERNS
--
-- Known dry-run note: unit_cost = 0 production_batches are inserted
-- directly (same shortcut as sql/118 / sql/106 empirical). complete_production
-- can no longer create those rows after sql/106.

-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back). Copy everything between "-- >>> DRY RUN START" and
-- "-- <<< DRY RUN END" into the Supabase SQL Editor and run it FIRST.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION confirm_sale(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_line_count integer := 0;
  v_allocation jsonb;
  v_total_cogs numeric := 0;
  v_now timestamptz := now();
  v_shift shifts%ROWTYPE;
  v_recipe_role text;
  v_recipe_name text;
  v_component record;
  v_required_qty numeric;
  v_has_components boolean;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be confirmed.';
  END IF;

  SELECT *
  INTO v_shift
  FROM shifts
  WHERE status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO shifts (status, opened_at, closed_at, opened_by)
      VALUES ('open', v_now, NULL, auth.uid())
      RETURNING * INTO v_shift;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
      INTO v_shift
      FROM shifts
      WHERE status = 'open'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to open or find an active shift for this sale.';
      END IF;
    END;
  END IF;

  FOR v_line IN
    SELECT *
    FROM sale_lines
    WHERE sale_id = p_sale_id
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    SELECT recipe_role, name
    INTO v_recipe_role, v_recipe_name
    FROM recipes
    WHERE id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    IF v_recipe_role = 'component' THEN
      v_allocation := allocate_finished_goods_fifo(
        v_line.product_id,
        v_line.quantity,
        'sale',
        'sale_line',
        v_line.id
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
          'Cannot confirm sale. Product "%" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
          v_recipe_name;
      END IF;

      v_total_cogs := v_total_cogs
        + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);

    ELSIF v_recipe_role = 'assembly' THEN
      v_has_components := false;

      FOR v_component IN
        SELECT
          rc.component_recipe_id,
          rc.ingredient_id,
          rc.quantity AS bom_quantity,
          r.name AS component_name,
          ing.name AS ingredient_name,
          ing.cost_per_unit AS ingredient_cost_per_unit
        FROM recipe_components rc
        LEFT JOIN recipes r ON r.id = rc.component_recipe_id
        LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
        WHERE rc.assembly_recipe_id = v_line.product_id
        ORDER BY rc.id
      LOOP
        v_has_components := true;
        v_required_qty := round(v_component.bom_quantity * v_line.quantity, 3);

        IF v_component.component_recipe_id IS NOT NULL THEN
          BEGIN
            v_allocation := allocate_finished_goods_fifo(
              v_component.component_recipe_id,
              v_required_qty,
              'sale', 'sale_line', v_line.id
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to allocate component "%" while assembling "%": %',
              v_component.component_name,
              v_recipe_name,
              SQLERRM;
          END;

          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(v_allocation -> 'allocations', '[]'::jsonb)
            ) AS layer
            WHERE COALESCE((layer ->> 'quantity')::numeric, 0) > 0
              AND COALESCE((layer ->> 'unit_cost')::numeric, 0) <= 0
          ) THEN
            RAISE EXCEPTION
              'Cannot confirm sale. Component "%" (in "%") was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch of the component with a valid cost, or resolve the existing batch cost separately.',
              v_component.component_name,
              v_recipe_name;
          END IF;

          v_total_cogs := v_total_cogs
            + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);

        ELSIF v_component.ingredient_id IS NOT NULL THEN
          IF COALESCE(v_component.ingredient_cost_per_unit, 0) <= 0 THEN
            RAISE EXCEPTION
              'Cannot confirm sale. Ingredient "%" has no unit cost set. Set Cost per unit in Inventory and try again.',
              v_component.ingredient_name;
          END IF;

          BEGIN
            PERFORM decrement_ingredient_stock(
              v_component.ingredient_id,
              v_required_qty
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to consume ingredient "%" while assembling "%": %',
              v_component.ingredient_name,
              v_recipe_name,
              SQLERRM;
          END;

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
            v_component.ingredient_id,
            NULL,
            'sale_out',
            v_required_qty,
            COALESCE(v_component.ingredient_cost_per_unit, 0),
            NULL,
            'sale',
            v_line.id,
            v_now,
            v_now
          );

          v_total_cogs := v_total_cogs
            + (v_required_qty * COALESCE(v_component.ingredient_cost_per_unit, 0));
        END IF;
      END LOOP;

      IF NOT v_has_components THEN
        RAISE EXCEPTION
          'Recipe "%" has no components defined and cannot be assembled.',
          v_recipe_name;
      END IF;

    ELSE
      RAISE EXCEPTION
        'Recipe "%" has an unrecognized recipe_role.',
        v_recipe_name;
    END IF;

    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  UPDATE sales
  SET
    status = 'confirmed',
    confirmed_at = v_now,
    updated_at = v_now
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'total_cogs', v_total_cogs
  );
END;
$$;

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_ing_a uuid;
  v_asm_a uuid;
  v_sale_a uuid;
  v_stock_a_before numeric;
  v_stock_a_after numeric;

  v_comp_b uuid;
  v_sale_b uuid;

  v_comp_c uuid;
  v_asm_c uuid;
  v_sale_c uuid;

  v_ing_d uuid;
  v_comp_d uuid;
  v_asm_d uuid;
  v_sale_d uuid;
  v_result_d jsonb;
  v_stock_d_before numeric;
  v_stock_d_after numeric;
  v_fifo_count integer;

  v_fg record;
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_session_line uuid;

  v_err text;
  v_raised boolean;
BEGIN
  SELECT p.auth_user_id
  INTO v_actor
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles — cannot emulate auth.uid().';
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

  -- Dummy production_batches (sql/118 shortcut). unit_cost = 0 is inserted
  -- directly because complete_production_session can no longer create it.
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES
    ('TEST_SALE_ZERO_COST_120_comp_B_' || v_suffix, 1, 'pcs', true, 'component'),
    ('TEST_SALE_ZERO_COST_120_comp_C_' || v_suffix, 1, 'pcs', true, 'component'),
    ('TEST_SALE_ZERO_COST_120_comp_D_' || v_suffix, 1, 'pcs', true, 'component');

  SELECT id INTO v_comp_b
  FROM recipes
  WHERE name = 'TEST_SALE_ZERO_COST_120_comp_B_' || v_suffix;
  SELECT id INTO v_comp_c
  FROM recipes
  WHERE name = 'TEST_SALE_ZERO_COST_120_comp_C_' || v_suffix;
  SELECT id INTO v_comp_d
  FROM recipes
  WHERE name = 'TEST_SALE_ZERO_COST_120_comp_D_' || v_suffix;

  FOR v_fg IN
    SELECT *
    FROM (VALUES
      (v_comp_b, 'B', 5::numeric, 0::numeric),
      (v_comp_c, 'C', 5::numeric, 0::numeric),
      (v_comp_d, 'D', 5::numeric, 2.00::numeric)
    ) AS t(recipe_id, tag, qty, unit_cost)
  LOOP
    INSERT INTO production_plans (name, planning_date, status)
    VALUES (
      'TEST_SALE_ZERO_COST_120_plan_' || v_fg.tag || '_' || v_suffix,
      CURRENT_DATE,
      'completed'
    )
    RETURNING id INTO v_plan;

    INSERT INTO production_plan_products (
      production_plan_id, recipe_id, recipe_name, planned_quantity,
      yield_quantity, yield_unit, sort_order
    )
    VALUES (
      v_plan, v_fg.recipe_id,
      'TEST_SALE_ZERO_COST_120_comp_' || v_fg.tag || '_' || v_suffix,
      v_fg.qty, 1, 'pcs', 1
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
      v_session, v_plan_product, v_fg.recipe_id,
      'TEST_SALE_ZERO_COST_120_comp_' || v_fg.tag || '_' || v_suffix,
      v_fg.qty, v_fg.qty, 'pcs', 1
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
      v_session, v_session_line, v_fg.recipe_id, v_fg.recipe_id,
      v_fg.qty, v_fg.unit_cost, now() - interval '1 hour'
    );
  END LOOP;

  -- ========================================================================
  -- SCENARIO A: assembly + raw ingredient with cost_per_unit = 0
  -- ========================================================================
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (
    'TEST_SALE_ZERO_COST_120_ing_A_' || v_suffix,
    'kg', 100, 0, 0, true
  )
  RETURNING id INTO v_ing_a;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_SALE_ZERO_COST_120_asm_A_' || v_suffix, 1, 'pcs', true, 'assembly'
  )
  RETURNING id INTO v_asm_a;

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, ingredient_id, quantity, unit
  )
  VALUES (v_asm_a, NULL, v_ing_a, 1, 'kg');

  v_sale_a := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_a, v_asm_a, 1, 10.00);

  SELECT current_stock INTO v_stock_a_before
  FROM ingredients WHERE id = v_ing_a;

  v_raised := false;
  BEGIN
    PERFORM confirm_sale(v_sale_a);
    RAISE EXCEPTION 'SCENARIO A FAIL: confirm_sale succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO A FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%Ingredient%'
         OR v_err NOT ILIKE '%Set Cost per unit in Inventory%' THEN
        RAISE EXCEPTION 'SCENARIO A unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO A PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: confirm_sale was not blocked';
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_a) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: sale status is not still draft';
  END IF;

  SELECT current_stock INTO v_stock_a_after
  FROM ingredients WHERE id = v_ing_a;
  IF v_stock_a_after IS DISTINCT FROM v_stock_a_before THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: ingredient stock changed (% → %)',
      v_stock_a_before, v_stock_a_after;
  END IF;

  -- ========================================================================
  -- SCENARIO B: direct component sale, FIFO batch unit_cost = 0
  -- ========================================================================
  v_sale_b := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_b, v_comp_b, 1, 10.00);

  v_raised := false;
  BEGIN
    PERFORM confirm_sale(v_sale_b);
    RAISE EXCEPTION 'SCENARIO B FAIL: confirm_sale succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%Product %'
         OR v_err NOT ILIKE '%cannot be fixed in Inventory%'
         OR v_err ILIKE '%Component %' THEN
        RAISE EXCEPTION 'SCENARIO B unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO B PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: confirm_sale was not blocked';
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_b) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: sale status is not still draft';
  END IF;

  -- ========================================================================
  -- SCENARIO C: assembly FIFO-component, batch unit_cost = 0
  -- ========================================================================
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_SALE_ZERO_COST_120_asm_C_' || v_suffix, 1, 'pcs', true, 'assembly'
  )
  RETURNING id INTO v_asm_c;

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, ingredient_id, quantity, unit
  )
  VALUES (v_asm_c, v_comp_c, NULL, 1, 'pcs');

  v_sale_c := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_c, v_asm_c, 1, 10.00);

  v_raised := false;
  BEGIN
    PERFORM confirm_sale(v_sale_c);
    RAISE EXCEPTION 'SCENARIO C FAIL: confirm_sale succeeded';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%Component %'
         OR v_err NOT ILIKE '%cannot be fixed in Inventory%' THEN
        RAISE EXCEPTION 'SCENARIO C unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO C PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: confirm_sale was not blocked';
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_c) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: sale status is not still draft';
  END IF;

  -- ========================================================================
  -- SCENARIO D: assembly with positive ingredient cost + positive FIFO cost
  -- ========================================================================
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (
    'TEST_SALE_ZERO_COST_120_ing_D_' || v_suffix,
    'kg', 100, 0, 1.50, true
  )
  RETURNING id INTO v_ing_d;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_SALE_ZERO_COST_120_asm_D_' || v_suffix, 1, 'pcs', true, 'assembly'
  )
  RETURNING id INTO v_asm_d;

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, ingredient_id, quantity, unit
  )
  VALUES
    (v_asm_d, v_comp_d, NULL, 1, 'pcs'),
    (v_asm_d, NULL, v_ing_d, 1, 'kg');

  SELECT current_stock INTO v_stock_d_before
  FROM ingredients WHERE id = v_ing_d;

  v_sale_d := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_d, v_asm_d, 1, 10.00);

  v_result_d := confirm_sale(v_sale_d);

  IF (v_result_d ->> 'sale_id')::uuid IS DISTINCT FROM v_sale_d THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: sale_id mismatch (%)', v_result_d;
  END IF;

  IF (v_result_d ->> 'total_cogs')::numeric IS DISTINCT FROM 3.50 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: total_cogs is % (expected 3.50)',
      (v_result_d ->> 'total_cogs')::numeric;
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_d) IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: sale is not confirmed';
  END IF;

  SELECT current_stock INTO v_stock_d_after
  FROM ingredients WHERE id = v_ing_d;
  IF v_stock_d_after IS DISTINCT FROM (v_stock_d_before - 1) THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: ingredient stock % → % (expected % → %)',
      v_stock_d_before, v_stock_d_after, v_stock_d_before, v_stock_d_before - 1;
  END IF;

  SELECT count(*) INTO v_fifo_count
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_d
    AND fgbc.source_type = 'sale_line';

  IF v_fifo_count <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: expected 1 FIFO consumption, found %',
      v_fifo_count;
  END IF;

  RAISE NOTICE
    'SCENARIO D PASS: sale % confirmed, total_cogs=3.50',
    v_sale_d;

  RAISE NOTICE 'sql/120 dry run: all scenarios passed';
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

CREATE OR REPLACE FUNCTION confirm_sale(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_line_count integer := 0;
  v_allocation jsonb;
  v_total_cogs numeric := 0;
  v_now timestamptz := now();
  v_shift shifts%ROWTYPE;
  v_recipe_role text;
  v_recipe_name text;
  v_component record;
  v_required_qty numeric;
  v_has_components boolean;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be confirmed.';
  END IF;

  SELECT *
  INTO v_shift
  FROM shifts
  WHERE status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO shifts (status, opened_at, closed_at, opened_by)
      VALUES ('open', v_now, NULL, auth.uid())
      RETURNING * INTO v_shift;
    EXCEPTION WHEN unique_violation THEN
      SELECT *
      INTO v_shift
      FROM shifts
      WHERE status = 'open'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to open or find an active shift for this sale.';
      END IF;
    END;
  END IF;

  FOR v_line IN
    SELECT *
    FROM sale_lines
    WHERE sale_id = p_sale_id
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    SELECT recipe_role, name
    INTO v_recipe_role, v_recipe_name
    FROM recipes
    WHERE id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    IF v_recipe_role = 'component' THEN
      v_allocation := allocate_finished_goods_fifo(
        v_line.product_id,
        v_line.quantity,
        'sale',
        'sale_line',
        v_line.id
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
          'Cannot confirm sale. Product "%" was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch with a valid cost, or resolve the existing batch cost separately.',
          v_recipe_name;
      END IF;

      v_total_cogs := v_total_cogs
        + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);

    ELSIF v_recipe_role = 'assembly' THEN
      v_has_components := false;

      FOR v_component IN
        SELECT
          rc.component_recipe_id,
          rc.ingredient_id,
          rc.quantity AS bom_quantity,
          r.name AS component_name,
          ing.name AS ingredient_name,
          ing.cost_per_unit AS ingredient_cost_per_unit
        FROM recipe_components rc
        LEFT JOIN recipes r ON r.id = rc.component_recipe_id
        LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
        WHERE rc.assembly_recipe_id = v_line.product_id
        ORDER BY rc.id
      LOOP
        v_has_components := true;
        v_required_qty := round(v_component.bom_quantity * v_line.quantity, 3);

        IF v_component.component_recipe_id IS NOT NULL THEN
          BEGIN
            v_allocation := allocate_finished_goods_fifo(
              v_component.component_recipe_id,
              v_required_qty,
              'sale', 'sale_line', v_line.id
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to allocate component "%" while assembling "%": %',
              v_component.component_name,
              v_recipe_name,
              SQLERRM;
          END;

          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(v_allocation -> 'allocations', '[]'::jsonb)
            ) AS layer
            WHERE COALESCE((layer ->> 'quantity')::numeric, 0) > 0
              AND COALESCE((layer ->> 'unit_cost')::numeric, 0) <= 0
          ) THEN
            RAISE EXCEPTION
              'Cannot confirm sale. Component "%" (in "%") was allocated from a batch with no unit cost. This cannot be fixed in Inventory — produce a new batch of the component with a valid cost, or resolve the existing batch cost separately.',
              v_component.component_name,
              v_recipe_name;
          END IF;

          v_total_cogs := v_total_cogs
            + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);

        ELSIF v_component.ingredient_id IS NOT NULL THEN
          IF COALESCE(v_component.ingredient_cost_per_unit, 0) <= 0 THEN
            RAISE EXCEPTION
              'Cannot confirm sale. Ingredient "%" has no unit cost set. Set Cost per unit in Inventory and try again.',
              v_component.ingredient_name;
          END IF;

          BEGIN
            PERFORM decrement_ingredient_stock(
              v_component.ingredient_id,
              v_required_qty
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to consume ingredient "%" while assembling "%": %',
              v_component.ingredient_name,
              v_recipe_name,
              SQLERRM;
          END;

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
            v_component.ingredient_id,
            NULL,
            'sale_out',
            v_required_qty,
            COALESCE(v_component.ingredient_cost_per_unit, 0),
            NULL,
            'sale',
            v_line.id,
            v_now,
            v_now
          );

          v_total_cogs := v_total_cogs
            + (v_required_qty * COALESCE(v_component.ingredient_cost_per_unit, 0));
        END IF;
      END LOOP;

      IF NOT v_has_components THEN
        RAISE EXCEPTION
          'Recipe "%" has no components defined and cannot be assembled.',
          v_recipe_name;
      END IF;

    ELSE
      RAISE EXCEPTION
        'Recipe "%" has an unrecognized recipe_role.',
        v_recipe_name;
    END IF;

    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  UPDATE sales
  SET
    status = 'confirmed',
    confirmed_at = v_now,
    updated_at = v_now
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'total_cogs', v_total_cogs
  );
END;
$$;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run AFTER Part 2
-- has committed, in a fresh SQL Editor tab, NOT inside a transaction).
-- Catalog-only: proves the three new RAISE strings are in the committed
-- body. Does not re-run the scenarios (those are Part 1).
-- ============================================================================

SELECT
  pg_get_functiondef('public.confirm_sale'::regproc)
    LIKE '%has no unit cost set%'
    AS has_ingredient_guard,
  pg_get_functiondef('public.confirm_sale'::regproc)
    LIKE '%Product % was allocated from a batch with no unit cost%'
    AS has_product_batch_guard,
  pg_get_functiondef('public.confirm_sale'::regproc)
    LIKE '%Component % was allocated from a batch with no unit cost%'
    AS has_component_batch_guard;
-- Expect: true, true, true.
