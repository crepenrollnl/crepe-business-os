-- Component-in-Component (extends Critical Finding #4) — Step 1: backend only
-- Run in Supabase SQL editor after sql/099_role_guard_accounting_expenses_fixed_assets.sql.
--
-- Finding (Plan_Deystviy_V1.txt, 17.08.2026): a Component recipe
-- (recipe_items) can only reference raw ingredients, never another
-- Component recipe. Real case: "Roasted chicken" (a Component, feeding the
-- Assembly "Chicken Crepe") itself needs "Chicken marinade" as an
-- ingredient — but marinade is itself a Component with its own production
-- cycle, not a raw ingredient. Today the system supports exactly 2 levels
-- (raw ingredient -> Component -> Assembly), not N levels. Temporary
-- workaround already in place: marinade's raw ingredients were merged
-- directly into "Roasted chicken"'s recipe_items (no separate production
-- step for marinade). This migration is the real fix, not a change to that
-- existing data — nothing here touches "Roasted chicken"'s current
-- recipe_items; the merge stays as-is unless someone later chooses to
-- re-split it through the UI (Step 2, not part of this migration).
--
-- Design: reuse recipe_components (sql/085, extended by sql/089) — today
-- it is the Assembly's bill-of-components (Assembly -> Component or
-- Assembly -> raw ingredient). This migration widens it so a Component
-- recipe can ALSO be the parent side ("assembly_recipe_id" keeps its
-- existing column name — renaming it is a larger, separate change not
-- worth doing for this step — but its role check now accepts a
-- 'component'-role recipe too). complete_production_session is taught to
-- walk recipe_components for the recipe being produced, exactly the way
-- confirm_sale already walks it for an Assembly sale line:
--   - a component_recipe_id row is FIFO-allocated from that component's
--     own production_batches (allocate_finished_goods_fifo — its
--     'recipe_consumption' reason and 'production_session_line' source
--     type already existed in sql/085/086, unused until now: this exact
--     use case was anticipated but never wired up).
--   - an ingredient_id row is folded into the SAME tmp_production_consumption
--     aggregation that recipe_items already uses — not handled as a
--     separate immediate decrement (unlike confirm_sale's ingredient_id
--     branch) — so it benefits from the existing single combined
--     insufficient-stock check across every raw ingredient a session line
--     needs, instead of failing on the first short ingredient found.
--
-- Practical consequence: producing "Roasted chicken" this way requires
-- "Chicken marinade" to already have its own posted production batch
-- (a separate, earlier Production Session) — matches the real kitchen
-- workflow (marinade is made first, then used).
--
-- Does NOT:
--   - touch existing recipe data (Roasted chicken's recipe_items merge
--     from the temporary workaround is left exactly as-is)
--   - add any UI — recipe-editor-modal.tsx still cannot pick a Component
--     as another Component's ingredient; linking today requires a manual
--     INSERT into recipe_components. Step 2 (UI), a separate follow-up.
--   - update Production Planning's requirement/shopping-list math
--     (confirm_production_plan, sql/078) to walk multi-level component
--     dependencies — it still only sums recipe_items. A plan for an
--     Assembly whose Component depends on another Component will not see
--     the second-level ingredients on its shopping list. Known limitation,
--     not fixed here — flagged for a follow-up once real multi-level
--     recipes exist.
--   - detect or prevent circular recipe_components chains (A needs B,
--     B needs A). No runtime hazard — complete_production_session only
--     ever consumes an already-produced batch via FIFO, it never computes
--     or produces a dependency on the fly, so a cycle cannot cause an
--     infinite loop; it would simply be an unproducible recipe graph the
--     business would notice immediately (neither side could ever get its
--     first batch made). Not worth a recursive-CTE guard for this step.

-- ---------------------------------------------------------------------------
-- 1. enforce_recipe_component_roles — accept a Component recipe as the
--    parent side too, not only Assembly. Component-side and ingredient-side
--    checks are unchanged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_recipe_component_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_role text;
  v_component_role text;
  v_ingredient_exists boolean;
BEGIN
  SELECT recipe_role INTO v_parent_role
  FROM recipes WHERE id = NEW.assembly_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent recipe was not found.';
  END IF;

  IF v_parent_role NOT IN ('assembly', 'component') THEN
    RAISE EXCEPTION
      'Recipe % cannot own components: recipe_role is "%", expected "assembly" or "component".',
      NEW.assembly_recipe_id, v_parent_role;
  END IF;

  IF NEW.component_recipe_id IS NOT NULL THEN
    SELECT recipe_role INTO v_component_role
    FROM recipes WHERE id = NEW.component_recipe_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Component recipe was not found.';
    END IF;

    IF v_component_role <> 'component' THEN
      RAISE EXCEPTION
        'Recipe % cannot be used as a component: recipe_role is "%", expected "component".',
        NEW.component_recipe_id, v_component_role;
    END IF;
  END IF;

  IF NEW.ingredient_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM ingredients WHERE id = NEW.ingredient_id
    ) INTO v_ingredient_exists;

    IF NOT v_ingredient_exists THEN
      RAISE EXCEPTION 'Ingredient % was not found.', NEW.ingredient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. complete_production_session — walk recipe_components for the recipe
--    being produced, in addition to recipe_items. Every other line is
--    carried forward byte-for-byte from the current version (sql/098 +
--    sql/093's raw_material_scale) — only the additions below and the
--    "has no ingredients" check (widened to also accept recipe_components)
--    are new.
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
    -- Widened: a recipe with no recipe_items is fine as long as it has at
    -- least one recipe_components row (its content comes entirely from
    -- other components / direct ingredient add-ins instead of its own
    -- recipe_items BOM). Previously this recipe_items-only check was the
    -- only source of content and rejected an empty recipe unconditionally.
    SELECT
      EXISTS (SELECT 1 FROM recipe_items WHERE recipe_id = v_recipe.id)
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
    -- New: walk recipe_components for this recipe. A component_recipe_id
    -- row is FIFO-allocated immediately from that component's own
    -- production_batches (mirrors confirm_sale's assembly branch exactly).
    -- An ingredient_id row is folded into the SAME tmp_production_consumption
    -- aggregation as recipe_items above, so it shares one combined
    -- insufficient-stock check with every other raw ingredient this
    -- session line needs, instead of failing eagerly on its own.
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
  'Complete a production session: for each line, consume recipe_items (raw ingredients) AND recipe_components (component_recipe_id rows FIFO-allocated from that component''s own production_batches; ingredient_id rows folded into the same raw-ingredient consumption as recipe_items), then create one production_batches row per line. raw_material_scale (if set) overrides the actual/yield ratio for scaling both recipe_items and recipe_components quantities.';
