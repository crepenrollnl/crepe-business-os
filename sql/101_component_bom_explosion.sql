-- Component-in-Component BOM explosion (replaces sql/100 FIFO for
-- Component-role parents). Run in Supabase SQL editor after
-- sql/100_component_in_component.sql.
--
-- sql/100 taught complete_production_session to FIFO-allocate
-- recipe_components.component_recipe_id from production_batches when
-- producing a Component that lists another Component as a sub-component.
-- Architecture Freeze v1.0 + ADR-0001: Finished Goods FIFO is Sales /
-- Assembly only. Producing a Component now recursively explodes
-- sub-components into leaf recipe_items and deducts those raw
-- ingredients in the same production session.
--
-- Also: a recipe that is currently a sub-component of a Component parent
-- cannot be planned or produced as its own production_plan_products row.
-- Checked live against recipe_components (not cached) — a recipe can
-- become nested after it was created.
--
-- Does NOT:
--   - change confirm_sale / allocate_finished_goods_fifo for Assembly
--   - rewrite existing production_batches
--   - rename recipe_components.assembly_recipe_id

-- ---------------------------------------------------------------------------
-- 1. Live nested-component predicate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_nested_component_recipe(p_recipe_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM recipe_components rc
    JOIN recipes parent ON parent.id = rc.assembly_recipe_id
    WHERE rc.component_recipe_id = p_recipe_id
      AND parent.recipe_role = 'component'
  );
$$;

COMMENT ON FUNCTION is_nested_component_recipe(uuid) IS
  'True when this recipe is currently listed as a sub-component of a Component-role parent (live recipe_components, not cached).';

REVOKE ALL ON FUNCTION is_nested_component_recipe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_nested_component_recipe(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_nested_component_recipe(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Recursive explode to leaf recipe_items (+ component-parent
--    recipe_components.ingredient_id rows, which UI forbids but SQL still
--    folds so a stray row cannot skip consumption).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION explode_component_recipe_leaves(
  p_recipe_id uuid,
  p_scale numeric
)
RETURNS TABLE (
  ingredient_id uuid,
  quantity numeric,
  unit text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cycle_found boolean;
  v_missing_id uuid;
  v_bad_yield_name text;
BEGIN
  IF p_recipe_id IS NULL OR p_scale IS NULL OR p_scale = 0 THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    WITH RECURSIVE graph AS (
      SELECT
        p_recipe_id AS recipe_id,
        ARRAY[p_recipe_id]::uuid[] AS path,
        false AS is_cycle
      UNION ALL
      SELECT
        rc.component_recipe_id,
        g.path || rc.component_recipe_id,
        rc.component_recipe_id = ANY (g.path)
      FROM graph g
      JOIN recipes parent
        ON parent.id = g.recipe_id
       AND parent.recipe_role = 'component'
      JOIN recipe_components rc
        ON rc.assembly_recipe_id = g.recipe_id
       AND rc.component_recipe_id IS NOT NULL
      WHERE NOT g.is_cycle
    )
    SELECT 1 FROM graph WHERE is_cycle
  ) INTO v_cycle_found;

  IF v_cycle_found THEN
    RAISE EXCEPTION
      'Recipe sub-components form a cycle. Remove the circular reference before planning or producing.';
  END IF;

  SELECT rc.component_recipe_id INTO v_missing_id
  FROM recipe_components rc
  JOIN recipes parent
    ON parent.id = rc.assembly_recipe_id
   AND parent.recipe_role = 'component'
  WHERE rc.component_recipe_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM recipes child WHERE child.id = rc.component_recipe_id
    )
    AND rc.assembly_recipe_id IN (
      WITH RECURSIVE graph AS (
        SELECT p_recipe_id AS recipe_id
        UNION
        SELECT rc2.component_recipe_id
        FROM graph g
        JOIN recipes parent
          ON parent.id = g.recipe_id
         AND parent.recipe_role = 'component'
        JOIN recipe_components rc2
          ON rc2.assembly_recipe_id = g.recipe_id
         AND rc2.component_recipe_id IS NOT NULL
      )
      SELECT recipe_id FROM graph
    )
  LIMIT 1;

  IF v_missing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Referenced recipe was not found.';
  END IF;

  SELECT child.name INTO v_bad_yield_name
  FROM recipe_components rc
  JOIN recipes parent
    ON parent.id = rc.assembly_recipe_id
   AND parent.recipe_role = 'component'
  JOIN recipes child ON child.id = rc.component_recipe_id
  WHERE (child.yield_quantity IS NULL OR child.yield_quantity <= 0)
    AND rc.assembly_recipe_id IN (
      WITH RECURSIVE graph AS (
        SELECT p_recipe_id AS recipe_id
        UNION
        SELECT rc2.component_recipe_id
        FROM graph g
        JOIN recipes parent
          ON parent.id = g.recipe_id
         AND parent.recipe_role = 'component'
        JOIN recipe_components rc2
          ON rc2.assembly_recipe_id = g.recipe_id
         AND rc2.component_recipe_id IS NOT NULL
      )
      SELECT recipe_id FROM graph
    )
  LIMIT 1;

  IF v_bad_yield_name IS NOT NULL THEN
    RAISE EXCEPTION 'Recipe "%" has an invalid yield.', v_bad_yield_name;
  END IF;

  RETURN QUERY
  WITH RECURSIVE graph AS (
    SELECT
      p_recipe_id AS recipe_id,
      p_scale AS scale
    UNION ALL
    SELECT
      rc.component_recipe_id,
      g.scale * (rc.quantity / child.yield_quantity)
    FROM graph g
    JOIN recipes parent
      ON parent.id = g.recipe_id
     AND parent.recipe_role = 'component'
    JOIN recipe_components rc
      ON rc.assembly_recipe_id = g.recipe_id
     AND rc.component_recipe_id IS NOT NULL
    JOIN recipes child ON child.id = rc.component_recipe_id
  ),
  leaves AS (
    SELECT
      ri.ingredient_id,
      ri.quantity * g.scale AS quantity,
      ri.unit
    FROM graph g
    JOIN recipe_items ri ON ri.recipe_id = g.recipe_id
    UNION ALL
    SELECT
      rc.ingredient_id,
      rc.quantity * g.scale AS quantity,
      rc.unit
    FROM graph g
    JOIN recipes parent
      ON parent.id = g.recipe_id
     AND parent.recipe_role = 'component'
    JOIN recipe_components rc
      ON rc.assembly_recipe_id = g.recipe_id
     AND rc.ingredient_id IS NOT NULL
  )
  SELECT
    leaves.ingredient_id,
    round(SUM(leaves.quantity), 3)::numeric,
    MIN(leaves.unit)
  FROM leaves
  WHERE leaves.ingredient_id IS NOT NULL
  GROUP BY leaves.ingredient_id;
END;
$$;

COMMENT ON FUNCTION explode_component_recipe_leaves(uuid, numeric) IS
  'Recursively expand a Component recipe graph to leaf recipe_items quantities at the given scale. Does not walk Assembly recipe_components (Sales/FIFO).';

REVOKE ALL ON FUNCTION explode_component_recipe_leaves(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION explode_component_recipe_leaves(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION explode_component_recipe_leaves(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reject nested components on production_plan_products (live check)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_nested_component_on_production_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF is_nested_component_recipe(NEW.recipe_id) THEN
    RAISE EXCEPTION
      'This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_nested_component_on_production_plan
  ON production_plan_products;

CREATE TRIGGER prevent_nested_component_on_production_plan
  BEFORE INSERT OR UPDATE OF recipe_id ON production_plan_products
  FOR EACH ROW
  EXECUTE FUNCTION prevent_nested_component_on_production_plan();

-- ---------------------------------------------------------------------------
-- 4. confirm_production_plan — explode leaves into the snapshot
--    (carries sql/098 require_role; replaces sql/078/098 recipe_items-only math)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_production_plan(
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
  v_product_count integer;
  v_sufficient boolean;
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
  v_nested_name text;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT * INTO v_plan
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;
  IF v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft production plan can be confirmed.';
  END IF;
  SELECT COUNT(*) INTO v_product_count
  FROM production_plan_products
  WHERE production_plan_id = p_plan_id;
  IF v_product_count = 0 THEN
    RAISE EXCEPTION 'Add at least one product before confirming the plan.';
  END IF;

  SELECT r.name INTO v_nested_name
  FROM production_plan_products ppp
  JOIN recipes r ON r.id = ppp.recipe_id
  WHERE ppp.production_plan_id = p_plan_id
    AND is_nested_component_recipe(ppp.recipe_id)
  LIMIT 1;
  IF v_nested_name IS NOT NULL THEN
    RAISE EXCEPTION
      'This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    WHERE ppp.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1 FROM explode_component_recipe_leaves(ppp.recipe_id, 1)
      )
  ) THEN
    RAISE EXCEPTION 'One or more recipes on this plan have no ingredients.';
  END IF;

  SELECT e.ingredient_id, i.name, string_agg(DISTINCT e.unit, ', ' ORDER BY e.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_plan_products ppp
  CROSS JOIN LATERAL explode_component_recipe_leaves(ppp.recipe_id, 1) e
  JOIN ingredients i ON i.id = e.ingredient_id
  WHERE ppp.production_plan_id = p_plan_id
  GROUP BY e.ingredient_id, i.name
  HAVING COUNT(DISTINCT e.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes on this plan (found: %). Fix the affected recipes before confirming this plan.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;

  INSERT INTO production_plan_ingredients (
    production_plan_id,
    ingredient_id,
    ingredient_name,
    unit,
    required_quantity,
    inventory_quantity_at_planning,
    missing_quantity
  )
  SELECT
    p_plan_id,
    req.ingredient_id,
    i.name,
    req.unit,
    req.required_quantity,
    i.current_stock,
    GREATEST(req.required_quantity - i.current_stock, 0)
  FROM (
    SELECT
      e.ingredient_id,
      round(SUM(e.quantity), 3) AS required_quantity,
      MIN(e.unit) AS unit
    FROM production_plan_products ppp
    CROSS JOIN LATERAL explode_component_recipe_leaves(
      ppp.recipe_id,
      ppp.planned_quantity / ppp.yield_quantity
    ) e
    WHERE ppp.production_plan_id = p_plan_id
    GROUP BY e.ingredient_id
  ) req
  JOIN ingredients i ON i.id = req.ingredient_id;

  UPDATE production_plans
  SET status = 'planned', updated_at = now()
  WHERE id = p_plan_id;
  SELECT NOT EXISTS (
    SELECT 1
    FROM production_plan_ingredients
    WHERE production_plan_id = p_plan_id
      AND missing_quantity > 0
  ) INTO v_sufficient;
  IF v_sufficient THEN
    UPDATE production_plans
    SET status = 'ready_to_produce', updated_at = now()
    WHERE id = p_plan_id;
  END IF;
  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

COMMENT ON FUNCTION confirm_production_plan(uuid) IS
  'Confirm a draft production plan: explode Component-in-Component BOMs to leaf recipe_items, snapshot production_plan_ingredients, set planned / ready_to_produce. Rejects recipes currently used as nested sub-components.';

REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_production_plan(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. complete_production_session — Component parents explode to leaves;
--    Assembly parents keep sql/100 FIFO (not used by Production UI).
--    Body otherwise carried forward from sql/100 (role guard + scale).
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
  'Complete a production session. Component recipes explode sub-components to leaf recipe_items (sql/101). Assembly recipes still FIFO-allocate recipe_components (sql/100 / ADR-0001). Nested Component recipes cannot be produced on their own.';

REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) TO authenticated;
