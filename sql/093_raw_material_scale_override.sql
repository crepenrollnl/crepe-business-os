-- Optional raw-material scale override for cooking loss / shrinkage
-- (V1 plan item 9). Run in Supabase SQL editor after sql/092.
--
-- Problem: complete_production_session (sql/007) derives raw-ingredient
-- consumption from a single number — actual_produced_quantity — via
--   v_scale = actual_produced_quantity / recipe.yield_quantity
-- Cooking loss (put in a full recipe's raw materials, get less finished
-- product out) is therefore treated as "cooked a smaller batch", and
-- raw-material stock is under-decremented. unit_cost also fails to rise.
--
-- Fix: optional production_session_lines.raw_material_scale. When set, it
-- is v_scale directly (recipe-batch units). When null, behaviour is
-- unchanged. actual_produced_quantity still drives produced_quantity and
-- unit_cost = total_cost / actual_produced_quantity.
--
-- Additive only:
--   column: production_session_lines.raw_material_scale
--   functions: save_production_session, complete_production_session
--     (CREATE OR REPLACE, same signatures as sql/009 and sql/007)
--
-- Does NOT:
--   - change recipes / recipe_items
--   - change production_batches schema
--   - apply itself (operator runs this in SQL Editor)

ALTER TABLE production_session_lines
  ADD COLUMN IF NOT EXISTS raw_material_scale numeric(12, 3) DEFAULT NULL;

ALTER TABLE production_session_lines
  DROP CONSTRAINT IF EXISTS production_session_lines_raw_material_scale_chk;

ALTER TABLE production_session_lines
  ADD CONSTRAINT production_session_lines_raw_material_scale_chk
  CHECK (raw_material_scale IS NULL OR raw_material_scale > 0);

-- ---------------------------------------------------------------------------
-- save_production_session (sql/009 body + raw_material_scale on each line)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_production_session(
  p_session_id uuid,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_line jsonb;
  v_line_id uuid;
  v_actual numeric;
  v_actual_raw text;
  v_raw_scale numeric;
  v_raw_scale_raw text;
  v_updated integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Production session id is required.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Production session lines are required.';
  END IF;

  SELECT *
  INTO v_session
  FROM production_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;

  IF v_session.status IN ('completed', 'cancelled')
     OR v_session.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;

  UPDATE production_sessions
  SET
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id
    AND status = 'in_progress';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;

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

    v_actual_raw := v_line ->> 'actual_produced_quantity';

    IF v_actual_raw IS NULL OR btrim(v_actual_raw) = '' THEN
      v_actual := NULL;
    ELSE
      BEGIN
        v_actual := v_actual_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid produced quantity.';
      END;

      IF v_actual < 0 THEN
        RAISE EXCEPTION 'Produced quantity cannot be negative.';
      END IF;
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

  RETURN jsonb_build_object(
    'session_id', p_session_id
  );
END;
$$;

REVOKE ALL ON FUNCTION save_production_session(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_production_session(uuid, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION save_production_session(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_production_session (sql/007 body + raw_material_scale)
--
-- Persists raw_material_scale from p_lines onto the session line (same
-- parse rules as save) so Finish without a prior Save still honours the
-- override, then uses it as v_scale when set.
-- ---------------------------------------------------------------------------

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
BEGIN
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

  -- BR-001 / BR-002: only IN_PROGRESS may complete; completed is immutable.
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

  -- Reject inconsistent units across the recipes actually being produced in
  -- this session, for the same raw ingredient, before any consumption is
  -- computed or any stock is touched. recipe_items.unit is a free-text
  -- snapshot per recipe line (no FK/CHECK to ingredients.unit) copied only
  -- when a recipe line is saved -- it can drift from an ingredient's
  -- current unit, or disagree between two recipes saved at different
  -- times. The consumption loop below sums raw recipe_items.quantity per
  -- ingredient across every recipe in this session (tmp_production_consumption's
  -- ON CONFLICT ... quantity = c.quantity + EXCLUDED.quantity); if two of
  -- those rows disagreed on unit, that sum would be meaningless and would
  -- still be fed straight into decrement_ingredient_stock as if it were
  -- correct. Scoped with the same actual_produced_quantity IS NOT NULL /
  -- > 0 filter the consumption loop uses below, so a line that will be
  -- skipped there can't trigger a false conflict here.
  SELECT ri.ingredient_id, i.name, string_agg(DISTINCT ri.unit, ', ' ORDER BY ri.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_session_lines psl
  JOIN recipe_items ri ON ri.recipe_id = psl.recipe_id
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE psl.production_session_id = p_session_id
    AND psl.actual_produced_quantity IS NOT NULL
    AND psl.actual_produced_quantity > 0
  GROUP BY ri.ingredient_id, i.name
  HAVING COUNT(DISTINCT ri.unit) > 1
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

    IF NOT EXISTS (
      SELECT 1 FROM recipe_items WHERE recipe_id = v_recipe.id
    ) THEN
      RAISE EXCEPTION
        'Recipe "%" has no ingredients.',
        v_recipe.name;
    END IF;

    v_scale := COALESCE(
      v_session_line.raw_material_scale,
      v_session_line.actual_produced_quantity / v_recipe.yield_quantity
    );
    v_line_total_cost := 0;

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

  -- Lock and validate inventory before mutation.
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

REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) TO authenticated;
