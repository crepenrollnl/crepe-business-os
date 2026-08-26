-- Reject production completion when consumed raw ingredients or FIFO
-- component layers have no unit cost.
--
-- Run in Supabase SQL editor after sql/101_component_bom_explosion.sql.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Body of complete_production_session is the live crepe-business-V1
-- definition dumped 2026-08-24 via
--   SELECT pg_get_functiondef('complete_production_session'::regproc);
-- Compared to sql/101 in git: same logic (require_role from sql/098,
-- raw_material_scale from sql/093, explode_component_recipe_leaves from
-- sql/101, assembly FIFO from sql/100). pg_get_functiondef only differed
-- in wrapper spelling (public. prefix, search_path TO, $function$,
-- NULL::uuid). This file is that live body plus the guard — not a recopy
-- of an older repo version.
--
-- Guard (after raw-stock check, before INSERT INTO transactions).
-- RAISE EXCEPTION rolls back FIFO writes in the same RPC transaction.
--   1. tmp_production_consumption: quantity > 0 AND total_cost <= 0
--      (recipe_items + recipe_components.ingredient_id).
--   2. allocate_finished_goods_fifo allocations[] layers: quantity > 0
--      AND unit_cost <= 0 (recipe_components.component_recipe_id).
--      Catches a fully zero allocation and FIFO mixing a zero-cost older
--      batch with a later positive batch.
-- One RAISE; ingredient names and component names are separate clauses
-- because the fix is different (Inventory cost_per_unit vs immutable
-- production_batches.unit_cost).
--
-- Does NOT:
--   - change COALESCE(cost_per_unit, 0) on consumption math
--   - rewrite existing production_batches
--   - touch sql/105 / increment_ingredient_stock
--   - post accounting journals

CREATE OR REPLACE FUNCTION complete_production_session(
  p_session_id uuid,
  p_notes text,
  p_lines jsonb,
  p_completed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_completed_by uuid;
  v_line jsonb;
  v_line_id uuid;
  v_actual numeric;
  v_raw_scale numeric;
  v_raw_scale_raw text;
  v_session_line production_session_lines%ROWTYPE;
  v_recipe recipes%ROWTYPE;
  v_scale numeric;
  v_recipe_item record;
  v_component record;
  v_component_required_qty numeric;
  v_component_allocation jsonb;
  v_has_recipe_content boolean;
  v_batch_plan record;
  v_consumption record;
  v_stock record;
  v_scaled_qty numeric;
  v_line_total_cost numeric;
  v_unit_cost numeric;
  v_transaction_id uuid;
  v_total_cost numeric := 0;
  v_batch_ids uuid[] := ARRAY[]::uuid[];
  v_batch_id uuid;
  v_batch_count integer := 0;
  v_line_count integer := 0;
  v_updated integer;
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
  v_zero_cost_components text[] := ARRAY[]::text[];
  v_zero_ingredient_names text;
  v_zero_component_names text;
  v_zero_cost_message text;
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Production session id is required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Production session lines are required.';
  END IF;
  v_completed_by := COALESCE(p_completed_by, auth.uid());
  IF v_completed_by IS NULL THEN
    RAISE EXCEPTION 'Completed by user is required.';
  END IF;
  SELECT *
  INTO v_session
  FROM production_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;
  IF v_session.status = 'completed' THEN
    RAISE EXCEPTION 'This production session is already completed.';
  END IF;
  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'This production session was cancelled.';
  END IF;
  IF v_session.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Only in-progress production sessions can be completed.';
  END IF;
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'This session has no products to produce.';
  END IF;
  UPDATE production_sessions
  SET
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := (v_line ->> 'line_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more session lines are invalid.';
    END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
    IF v_line ->> 'actual_produced_quantity' IS NULL
       OR btrim(v_line ->> 'actual_produced_quantity') = '' THEN
      RAISE EXCEPTION
        'Enter an actual produced quantity for every product before finishing.';
    END IF;
    BEGIN
      v_actual := (v_line ->> 'actual_produced_quantity')::numeric;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Enter a valid produced quantity.';
    END;
    IF v_actual < 0 THEN
      RAISE EXCEPTION 'Produced quantity cannot be negative.';
    END IF;
    v_raw_scale_raw := v_line ->> 'raw_material_scale';
    IF v_raw_scale_raw IS NULL OR btrim(v_raw_scale_raw) = '' THEN
      v_raw_scale := NULL;
    ELSE
      BEGIN
        v_raw_scale := v_raw_scale_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid number of recipe batches.';
      END;
      IF v_raw_scale <= 0 THEN
        RAISE EXCEPTION 'Recipe batches used must be a positive number.';
      END IF;
    END IF;
    UPDATE production_session_lines
    SET
      actual_produced_quantity = v_actual,
      raw_material_scale = v_raw_scale,
      updated_at = v_now
    WHERE id = v_line_id
      AND production_session_id = p_session_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM production_session_lines
    WHERE production_session_id = p_session_id
      AND actual_produced_quantity IS NULL
  ) THEN
    RAISE EXCEPTION
      'Enter an actual produced quantity for every product before finishing.';
  END IF;
  IF (
    SELECT count(*)::integer
    FROM production_session_lines
    WHERE production_session_id = p_session_id
  ) <> v_line_count THEN
    RAISE EXCEPTION
      'Enter an actual produced quantity for every product before finishing.';
  END IF;
  SELECT e.ingredient_id, i.name, string_agg(DISTINCT e.unit, ', ' ORDER BY e.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_session_lines psl
  JOIN recipes r ON r.id = psl.recipe_id
  CROSS JOIN LATERAL explode_component_recipe_leaves(psl.recipe_id, 1) e
  JOIN ingredients i ON i.id = e.ingredient_id
  WHERE psl.production_session_id = p_session_id
    AND psl.actual_produced_quantity IS NOT NULL
    AND psl.actual_produced_quantity > 0
    AND r.recipe_role IS DISTINCT FROM 'assembly'
  GROUP BY e.ingredient_id, i.name
  HAVING COUNT(DISTINCT e.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes in this production session (found: %). Fix the affected recipes before completing this session.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;
  DROP TABLE IF EXISTS tmp_production_consumption;
  DROP TABLE IF EXISTS tmp_production_batches;
  CREATE TEMP TABLE tmp_production_consumption (
    ingredient_id uuid PRIMARY KEY,
    quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
    total_cost numeric(14, 6) NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_production_batches (
    session_line_id uuid PRIMARY KEY,
    finished_good_id uuid NOT NULL,
    recipe_id uuid NOT NULL,
    produced_quantity numeric(12, 3) NOT NULL,
    unit_cost numeric(12, 4) NOT NULL,
    total_cost numeric(14, 6) NOT NULL
  ) ON COMMIT DROP;
  FOR v_session_line IN
    SELECT *
    FROM production_session_lines
    WHERE production_session_id = p_session_id
    ORDER BY sort_order ASC
  LOOP
    IF v_session_line.actual_produced_quantity IS NULL
       OR v_session_line.actual_produced_quantity = 0 THEN
      CONTINUE;
    END IF;
    SELECT *
    INTO v_recipe
    FROM recipes
    WHERE id = v_session_line.recipe_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Recipe for "%" was not found.',
        v_session_line.product_name;
    END IF;
    IF NOT v_recipe.is_active THEN
      RAISE EXCEPTION
        'Recipe "%" is inactive and cannot be produced.',
        v_recipe.name;
    END IF;
    IF v_recipe.yield_quantity IS NULL OR v_recipe.yield_quantity <= 0 THEN
      RAISE EXCEPTION
        'Recipe "%" has an invalid yield.',
        v_recipe.name;
    END IF;
    IF v_recipe.recipe_role IS DISTINCT FROM 'assembly'
       AND is_nested_component_recipe(v_recipe.id) THEN
      RAISE EXCEPTION
        'This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.';
    END IF;
    SELECT
      EXISTS (SELECT 1 FROM explode_component_recipe_leaves(v_recipe.id, 1))
      OR EXISTS (SELECT 1 FROM recipe_items WHERE recipe_id = v_recipe.id)
      OR EXISTS (SELECT 1 FROM recipe_components WHERE assembly_recipe_id = v_recipe.id)
    INTO v_has_recipe_content;
    IF NOT v_has_recipe_content THEN
      RAISE EXCEPTION
        'Recipe "%" has no ingredients.',
        v_recipe.name;
    END IF;
    v_scale := COALESCE(
      v_session_line.raw_material_scale,
      v_session_line.actual_produced_quantity / v_recipe.yield_quantity
    );
    v_line_total_cost := 0;
    IF v_recipe.recipe_role = 'assembly' THEN
      FOR v_recipe_item IN
        SELECT
          ri.ingredient_id,
          ri.quantity AS bom_quantity,
          i.id AS ingredient_row_id,
          i.name AS ingredient_name,
          COALESCE(i.cost_per_unit, 0) AS cost_per_unit
        FROM recipe_items ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id = v_recipe.id
      LOOP
        IF v_recipe_item.ingredient_row_id IS NULL THEN
          RAISE EXCEPTION
            'Recipe "%" references a missing ingredient.',
            v_recipe.name;
        END IF;
        v_scaled_qty := round(v_recipe_item.bom_quantity * v_scale, 3);
        IF v_scaled_qty <= 0 THEN
          CONTINUE;
        END IF;
        v_line_total_cost :=
          v_line_total_cost
          + (v_scaled_qty * v_recipe_item.cost_per_unit);
        INSERT INTO tmp_production_consumption AS c (
          ingredient_id,
          quantity,
          total_cost
        )
        VALUES (
          v_recipe_item.ingredient_id,
          v_scaled_qty,
          v_scaled_qty * v_recipe_item.cost_per_unit
        )
        ON CONFLICT (ingredient_id) DO UPDATE
        SET
          quantity = round(c.quantity + EXCLUDED.quantity, 3),
          total_cost = c.total_cost + EXCLUDED.total_cost;
      END LOOP;
      FOR v_component IN
        SELECT
          rc.component_recipe_id,
          rc.ingredient_id,
          rc.quantity AS bom_quantity,
          r.name AS component_name,
          ing.id AS ingredient_row_id,
          ing.name AS ingredient_name,
          COALESCE(ing.cost_per_unit, 0) AS ingredient_cost_per_unit
        FROM recipe_components rc
        LEFT JOIN recipes r ON r.id = rc.component_recipe_id
        LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
        WHERE rc.assembly_recipe_id = v_recipe.id
        ORDER BY rc.id
      LOOP
        v_component_required_qty := round(v_component.bom_quantity * v_scale, 3);
        IF v_component_required_qty <= 0 THEN
          CONTINUE;
        END IF;
        IF v_component.component_recipe_id IS NOT NULL THEN
          BEGIN
            v_component_allocation := allocate_finished_goods_fifo(
              v_component.component_recipe_id,
              v_component_required_qty,
              'recipe_consumption',
              'production_session_line',
              v_session_line.id
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to allocate component "%" while producing "%": %',
              v_component.component_name,
              v_recipe.name,
              SQLERRM;
          END;
          v_line_total_cost :=
            v_line_total_cost
            + COALESCE((v_component_allocation ->> 'total_cost')::numeric, 0);
          IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(v_component_allocation -> 'allocations', '[]'::jsonb)
            ) AS layer
            WHERE COALESCE((layer ->> 'quantity')::numeric, 0) > 0
              AND COALESCE((layer ->> 'unit_cost')::numeric, 0) <= 0
          ) THEN
            v_zero_cost_components := array_append(
              v_zero_cost_components,
              COALESCE(v_component.component_name, 'Unknown component')
            );
          END IF;
        ELSIF v_component.ingredient_id IS NOT NULL THEN
          IF v_component.ingredient_row_id IS NULL THEN
            RAISE EXCEPTION
              'Recipe "%" references a missing ingredient.',
              v_recipe.name;
          END IF;
          v_line_total_cost :=
            v_line_total_cost
            + (v_component_required_qty * v_component.ingredient_cost_per_unit);
          INSERT INTO tmp_production_consumption AS c (
            ingredient_id,
            quantity,
            total_cost
          )
          VALUES (
            v_component.ingredient_id,
            v_component_required_qty,
            v_component_required_qty * v_component.ingredient_cost_per_unit
          )
          ON CONFLICT (ingredient_id) DO UPDATE
          SET
            quantity = round(c.quantity + EXCLUDED.quantity, 3),
            total_cost = c.total_cost + EXCLUDED.total_cost;
        END IF;
      END LOOP;
    ELSE
      FOR v_recipe_item IN
        SELECT
          e.ingredient_id,
          e.quantity AS bom_quantity,
          i.id AS ingredient_row_id,
          i.name AS ingredient_name,
          COALESCE(i.cost_per_unit, 0) AS cost_per_unit
        FROM explode_component_recipe_leaves(v_recipe.id, v_scale) e
        LEFT JOIN ingredients i ON i.id = e.ingredient_id
      LOOP
        IF v_recipe_item.ingredient_row_id IS NULL THEN
          RAISE EXCEPTION
            'Recipe "%" references a missing ingredient.',
            v_recipe.name;
        END IF;
        v_scaled_qty := round(v_recipe_item.bom_quantity, 3);
        IF v_scaled_qty <= 0 THEN
          CONTINUE;
        END IF;
        v_line_total_cost :=
          v_line_total_cost
          + (v_scaled_qty * v_recipe_item.cost_per_unit);
        INSERT INTO tmp_production_consumption AS c (
          ingredient_id,
          quantity,
          total_cost
        )
        VALUES (
          v_recipe_item.ingredient_id,
          v_scaled_qty,
          v_scaled_qty * v_recipe_item.cost_per_unit
        )
        ON CONFLICT (ingredient_id) DO UPDATE
        SET
          quantity = round(c.quantity + EXCLUDED.quantity, 3),
          total_cost = c.total_cost + EXCLUDED.total_cost;
      END LOOP;
    END IF;
    v_unit_cost := round(
      v_line_total_cost / v_session_line.actual_produced_quantity,
      4
    );
    INSERT INTO tmp_production_batches (
      session_line_id,
      finished_good_id,
      recipe_id,
      produced_quantity,
      unit_cost,
      total_cost
    )
    VALUES (
      v_session_line.id,
      v_session_line.recipe_id,
      v_session_line.recipe_id,
      v_session_line.actual_produced_quantity,
      v_unit_cost,
      v_line_total_cost
    );
    v_total_cost := v_total_cost + v_line_total_cost;
  END LOOP;
  FOR v_stock IN
    SELECT
      c.ingredient_id,
      c.quantity AS required_quantity,
      i.name AS ingredient_name,
      i.current_stock
    FROM tmp_production_consumption c
    JOIN ingredients i ON i.id = c.ingredient_id
    ORDER BY c.ingredient_id
    FOR UPDATE OF i
  LOOP
    IF v_stock.current_stock < v_stock.required_quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for "%". Required %, available %.',
        v_stock.ingredient_name,
        round(v_stock.required_quantity, 3),
        round(v_stock.current_stock, 3);
    END IF;
  END LOOP;
  SELECT string_agg(name, ', ' ORDER BY name)
  INTO v_zero_ingredient_names
  FROM (
    SELECT DISTINCT i.name
    FROM tmp_production_consumption c
    JOIN ingredients i ON i.id = c.ingredient_id
    WHERE c.quantity > 0
      AND c.total_cost <= 0
  ) names(name);
  SELECT string_agg(n, ', ' ORDER BY n)
  INTO v_zero_component_names
  FROM (
    SELECT DISTINCT unnest(v_zero_cost_components) AS n
  ) components(n);
  IF v_zero_ingredient_names IS NOT NULL
     OR v_zero_component_names IS NOT NULL THEN
    v_zero_cost_message := 'Cannot finish production.';
    IF v_zero_ingredient_names IS NOT NULL THEN
      v_zero_cost_message :=
        v_zero_cost_message
        || ' These ingredients have no unit cost: '
        || v_zero_ingredient_names
        || '. Set Cost per unit in Inventory and try again.';
    END IF;
    IF v_zero_component_names IS NOT NULL THEN
      v_zero_cost_message :=
        v_zero_cost_message
        || ' These components were allocated from batches with no unit cost: '
        || v_zero_component_names
        || '. This cannot be fixed in Inventory — produce a new batch of '
        || 'the component with a valid cost, or resolve the existing batch '
        || 'cost separately.';
    END IF;
    RAISE EXCEPTION '%', v_zero_cost_message;
  END IF;
  INSERT INTO transactions (
    type,
    status,
    reference_type,
    reference_id,
    amount,
    currency,
    description,
    occurred_at,
    posted_at,
    created_at,
    updated_at
  )
  VALUES (
    'production',
    'posted',
    'production_session',
    p_session_id,
    round(v_total_cost, 2),
    'EUR',
    format('Production session #%s completed', v_session.session_number),
    v_now,
    v_now,
    v_now,
    v_now
  )
  RETURNING id INTO v_transaction_id;
  FOR v_consumption IN
    SELECT ingredient_id, quantity, total_cost
    FROM tmp_production_consumption
    ORDER BY ingredient_id
  LOOP
    PERFORM decrement_ingredient_stock(
      v_consumption.ingredient_id,
      v_consumption.quantity
    );
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
      v_consumption.ingredient_id,
      NULL,
      'production_out',
      v_consumption.quantity,
      CASE
        WHEN v_consumption.quantity > 0 THEN
          round(v_consumption.total_cost / v_consumption.quantity, 4)
        ELSE 0
      END,
      v_transaction_id,
      'production_session',
      p_session_id,
      v_now,
      v_now
    );
  END LOOP;
  FOR v_batch_plan IN
    SELECT
      b.session_line_id,
      b.finished_good_id,
      b.recipe_id,
      b.produced_quantity,
      b.unit_cost
    FROM tmp_production_batches b
    JOIN production_session_lines sl ON sl.id = b.session_line_id
    WHERE sl.production_session_id = p_session_id
    ORDER BY sl.sort_order ASC
  LOOP
    INSERT INTO production_batches (
      production_session_id,
      production_session_line_id,
      finished_good_id,
      recipe_id,
      produced_quantity,
      unit_cost,
      produced_at,
      created_at
    )
    VALUES (
      p_session_id,
      v_batch_plan.session_line_id,
      v_batch_plan.finished_good_id,
      v_batch_plan.recipe_id,
      v_batch_plan.produced_quantity,
      v_batch_plan.unit_cost,
      v_now,
      v_now
    )
    RETURNING id INTO v_batch_id;
    v_batch_ids := array_append(v_batch_ids, v_batch_id);
    v_batch_count := v_batch_count + 1;
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
      v_batch_plan.finished_good_id,
      'production_in',
      v_batch_plan.produced_quantity,
      v_batch_plan.unit_cost,
      v_transaction_id,
      'production_session',
      p_session_id,
      v_now,
      v_now
    );
  END LOOP;
  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = v_now,
    completed_by = v_completed_by,
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id
    AND status = 'in_progress';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This production session is already completed.';
  END IF;
  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'transaction_id', v_transaction_id,
    'batch_count', v_batch_count,
    'batch_ids', to_jsonb(v_batch_ids),
    'total_cost', round(v_total_cost, 2),
    'completed_at', v_now,
    'completed_by', v_completed_by
  );
END;
$$;

COMMENT ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) IS
  'Complete a production session. Component recipes explode sub-components to leaf recipe_items (sql/101). Assembly recipes still FIFO-allocate recipe_components (sql/100 / ADR-0001). Nested Component recipes cannot be produced on their own. Rejects consumed ingredients or FIFO component layers with no unit cost (sql/106).';

REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) TO authenticated;
