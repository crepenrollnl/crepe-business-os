-- SQL test: confirm_sale zero-cost guards and sale paths (sql/120).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/confirm_sale_zero_cost.sql
-- (exit 0). Nested EXCEPTION catches expected RPC RAISE so ROLLBACK
-- still runs. Bootstrap: tests/sql/bootstrap/confirm_sale_and_write_off.list.
--
-- Scenarios:
--   A — assembly + ingredient cost_per_unit = 0
--   B — direct component sale, FIFO batch unit_cost = 0
--   C — assembly FIFO-component, batch unit_cost = 0
--   D — assembly ingredient (1.50) + FIFO component (2.00) succeeds
--   E — direct component sale from positive-cost batch succeeds
--   F — confirm_sale on already confirmed sale is rejected
--   G — confirm_sale on a draft with no lines is rejected
--
-- Dummy production_batches are inserted directly (sql/120 dry-run shortcut).
-- complete_production_session cannot create unit_cost = 0 after sql/106.
--
-- Actor: stub_owner_profile.sql (applied after sql/097). JWT GUCs match
-- prelude_auth.sql's auth.uid().

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
    'TEST_CONFIRM_SALE_plan_' || p_tag || '_' || p_suffix,
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
    'TEST_CONFIRM_SALE_comp_' || p_tag || '_' || p_suffix,
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
    'TEST_CONFIRM_SALE_comp_' || p_tag || '_' || p_suffix,
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
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_raised boolean;
  v_result jsonb;

  v_comp_b uuid;
  v_comp_c uuid;
  v_comp_d uuid;
  v_comp_e uuid;
  v_batch_e uuid;

  v_ing_a uuid;
  v_asm_a uuid;
  v_sale_a uuid;
  v_stock_a_before numeric;
  v_stock_a_after numeric;

  v_sale_b uuid;

  v_asm_c uuid;
  v_sale_c uuid;

  v_ing_d uuid;
  v_asm_d uuid;
  v_sale_d uuid;
  v_stock_d_before numeric;
  v_stock_d_after numeric;
  v_open_before integer;
  v_open_after integer;
  v_fifo_d integer;
  v_cogs_d numeric;
  v_confirmed_at timestamptz;

  v_sale_e uuid;
  v_fifo_e integer;
  v_consumed_e numeric;

  v_stock_f numeric;
  v_fifo_f integer;

  v_sale_g uuid;
BEGIN
  RAISE NOTICE 'auth.uid() live def: %', pg_get_functiondef('auth.uid()'::regprocedure);

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

  RAISE NOTICE 'JWT emulated auth.uid()=%', auth.uid();

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES
    ('TEST_CONFIRM_SALE_comp_B_' || v_suffix, 1, 'pcs', true, 'component'),
    ('TEST_CONFIRM_SALE_comp_C_' || v_suffix, 1, 'pcs', true, 'component'),
    ('TEST_CONFIRM_SALE_comp_D_' || v_suffix, 1, 'pcs', true, 'component'),
    ('TEST_CONFIRM_SALE_comp_E_' || v_suffix, 1, 'pcs', true, 'component');

  SELECT id INTO v_comp_b FROM recipes
  WHERE name = 'TEST_CONFIRM_SALE_comp_B_' || v_suffix;
  SELECT id INTO v_comp_c FROM recipes
  WHERE name = 'TEST_CONFIRM_SALE_comp_C_' || v_suffix;
  SELECT id INTO v_comp_d FROM recipes
  WHERE name = 'TEST_CONFIRM_SALE_comp_D_' || v_suffix;
  SELECT id INTO v_comp_e FROM recipes
  WHERE name = 'TEST_CONFIRM_SALE_comp_E_' || v_suffix;

  PERFORM insert_test_fg_batch(v_comp_b, 'B', 5, 0, v_suffix);
  PERFORM insert_test_fg_batch(v_comp_c, 'C', 5, 0, v_suffix);
  PERFORM insert_test_fg_batch(v_comp_d, 'D', 5, 2.00, v_suffix);
  v_batch_e := insert_test_fg_batch(v_comp_e, 'E', 5, 4.00, v_suffix);

  -- ========================================================================
  -- SCENARIO A: assembly + raw ingredient with cost_per_unit = 0
  -- ========================================================================
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (
    'TEST_CONFIRM_SALE_ing_A_' || v_suffix,
    'kg', 100, 0, 0, true
  )
  RETURNING id INTO v_ing_a;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_CONFIRM_SALE_asm_A_' || v_suffix, 1, 'pcs', true, 'assembly'
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

  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions c
    JOIN sale_lines sl ON sl.id = c.source_id
    WHERE sl.sale_id = v_sale_b
  ) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: FIFO consumption was written';
  END IF;

  -- ========================================================================
  -- SCENARIO C: assembly FIFO-component, batch unit_cost = 0
  -- ========================================================================
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_CONFIRM_SALE_asm_C_' || v_suffix, 1, 'pcs', true, 'assembly'
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

  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions c
    JOIN sale_lines sl ON sl.id = c.source_id
    WHERE sl.sale_id = v_sale_c
  ) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: FIFO consumption was written';
  END IF;

  -- ========================================================================
  -- SCENARIO D: assembly with positive ingredient cost + positive FIFO cost
  -- ========================================================================
  INSERT INTO ingredients (
    name, unit, current_stock, minimum_stock, cost_per_unit, active
  )
  VALUES (
    'TEST_CONFIRM_SALE_ing_D_' || v_suffix,
    'kg', 100, 0, 1.50, true
  )
  RETURNING id INTO v_ing_d;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES (
    'TEST_CONFIRM_SALE_asm_D_' || v_suffix, 1, 'pcs', true, 'assembly'
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

  SELECT count(*) INTO v_open_before
  FROM shifts WHERE status = 'open';

  IF v_open_before <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: expected 0 open shifts before confirm, found %',
      v_open_before;
  END IF;

  v_sale_d := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_d, v_asm_d, 1, 10.00);

  v_result := confirm_sale(v_sale_d);

  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_sale_d THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: sale_id mismatch (%)', v_result;
  END IF;

  v_cogs_d := (v_result ->> 'total_cogs')::numeric;
  IF v_cogs_d IS DISTINCT FROM 3.50 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: total_cogs is % (expected 3.50 = 1.50 ingredient + 2.00 FIFO)',
      v_cogs_d;
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_d) IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: sale is not confirmed';
  END IF;

  SELECT confirmed_at INTO v_confirmed_at
  FROM sales WHERE id = v_sale_d;
  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: confirmed_at is NULL';
  END IF;

  SELECT current_stock INTO v_stock_d_after
  FROM ingredients WHERE id = v_ing_d;
  IF v_stock_d_after IS DISTINCT FROM (v_stock_d_before - 1) THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: ingredient stock % → % (expected decrement of 1)',
      v_stock_d_before, v_stock_d_after;
  END IF;

  SELECT count(*) INTO v_fifo_d
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_d
    AND fgbc.source_type = 'sale_line';

  IF v_fifo_d <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: expected 1 FIFO consumption, found %',
      v_fifo_d;
  END IF;

  SELECT count(*) INTO v_open_after
  FROM shifts WHERE status = 'open';
  IF v_open_after <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: expected 1 open shift after confirm, found %',
      v_open_after;
  END IF;

  RAISE NOTICE
    'SCENARIO D PASS: sale % confirmed, total_cogs=3.50, open shifts=1',
    v_sale_d;

  -- ========================================================================
  -- SCENARIO E: direct component sale from positive-cost FIFO batch
  -- ========================================================================
  v_sale_e := (create_draft_sale() ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale_e, v_comp_e, 2, 10.00);

  v_result := confirm_sale(v_sale_e);

  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_sale_e THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: sale_id mismatch (%)', v_result;
  END IF;

  IF (v_result ->> 'total_cogs')::numeric IS DISTINCT FROM 8.00 THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: total_cogs is % (expected 8.00 = 4.00 × 2)',
      (v_result ->> 'total_cogs')::numeric;
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_e) IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: sale is not confirmed';
  END IF;

  SELECT count(*), COALESCE(sum(quantity), 0)
  INTO v_fifo_e, v_consumed_e
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_e
    AND fgbc.source_type = 'sale_line'
    AND fgbc.production_batch_id = v_batch_e;

  IF v_fifo_e <> 1 OR v_consumed_e IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: expected 1 consumption of qty 2 from batch %, got rows=% qty=%',
      v_batch_e, v_fifo_e, v_consumed_e;
  END IF;

  RAISE NOTICE 'SCENARIO E PASS: direct component sale total_cogs=8.00';

  -- ========================================================================
  -- SCENARIO F: confirm_sale on an already confirmed sale
  -- ========================================================================
  SELECT current_stock INTO v_stock_f
  FROM ingredients WHERE id = v_ing_d;

  SELECT count(*) INTO v_fifo_f
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_d
    AND fgbc.source_type = 'sale_line';

  v_raised := false;
  BEGIN
    PERFORM confirm_sale(v_sale_d);
    RAISE EXCEPTION 'SCENARIO F FAIL: confirm_sale succeeded on confirmed sale';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Only draft sales can be confirmed.' THEN
        RAISE EXCEPTION 'SCENARIO F unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO F PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: confirm_sale was not blocked';
  END IF;

  IF (SELECT current_stock FROM ingredients WHERE id = v_ing_d)
     IS DISTINCT FROM v_stock_f THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: ingredient stock changed on rejected re-confirm';
  END IF;

  IF (
    SELECT count(*)
    FROM finished_goods_batch_consumptions fgbc
    JOIN sale_lines sl ON sl.id = fgbc.source_id
    WHERE sl.sale_id = v_sale_d
      AND fgbc.source_type = 'sale_line'
  ) <> v_fifo_f THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: extra FIFO consumption on rejected re-confirm';
  END IF;

  -- ========================================================================
  -- SCENARIO G: confirm_sale on a draft with no lines
  -- ========================================================================
  v_sale_g := (create_draft_sale() ->> 'sale_id')::uuid;

  v_raised := false;
  BEGIN
    PERFORM confirm_sale(v_sale_g);
    RAISE EXCEPTION 'SCENARIO G FAIL: confirm_sale succeeded with no lines';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO G FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Sale has no lines to confirm.' THEN
        RAISE EXCEPTION 'SCENARIO G unexpected error: %', v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'SCENARIO G PASS: %', v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: confirm_sale was not blocked';
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_g) IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: empty sale status is not still draft';
  END IF;

  RAISE NOTICE 'sql/confirm_sale_zero_cost: all scenarios passed';
END;
$test$;

ROLLBACK;
