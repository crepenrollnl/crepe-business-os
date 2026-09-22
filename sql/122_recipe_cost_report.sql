-- Recipe cost report: full raw-leaf cost for Component and Assembly
-- recipes, including component-in-component nesting.
--
-- Run in Supabase SQL editor after sql/101_component_bom_explosion.sql
-- (explode_component_recipe_leaves) and sql/097 (require_role).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Read-only. Never writes recipes, recipe_items, recipe_components,
-- ingredients, journals, or stock.
--
-- Public RPCs (owner/partner only):
--   get_recipe_cost_detail(p_recipe_id)
--   get_recipe_cost_report()
--
-- Internal helpers (no GRANT to authenticated):
--   collect_recipe_cost_leaves(p_recipe_id)
--   calculate_recipe_cost(p_recipe_id)
--
-- Component roots reuse explode_component_recipe_leaves (sql/101).
-- Assembly roots cannot call explode() on themselves — they union
-- own recipe_items, raw recipe_components.ingredient_id add-ins, and
-- explode() of each component_recipe_id child at
-- scale = rc.quantity / child.yield_quantity.
--
-- Does NOT:
--   - replace VIEW recipe_cost_analysis / get_recipe_cost (sql/034)
--   - change explode_component_recipe_leaves
--   - mutate Inventory / Production / Sales / Accounting
--   - create UI, hooks, or TypeScript services

-- ---------------------------------------------------------------------------
-- 1. Leaf collector (Component + Assembly)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION collect_recipe_cost_leaves(
  p_recipe_id uuid
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
  v_role text;
  v_missing_id uuid;
  v_bad_yield_name text;
BEGIN
  IF p_recipe_id IS NULL THEN
    RAISE EXCEPTION 'Recipe id is required.';
  END IF;

  SELECT r.recipe_role
  INTO v_role
  FROM recipes r
  WHERE r.id = p_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe was not found.';
  END IF;

  IF v_role = 'component' THEN
    RETURN QUERY
    SELECT
      e.ingredient_id,
      e.quantity,
      e.unit
    FROM explode_component_recipe_leaves(p_recipe_id, 1) e;
    RETURN;
  END IF;

  IF v_role IS DISTINCT FROM 'assembly' THEN
    RAISE EXCEPTION 'Recipe "%" has an unrecognized recipe_role.', v_role;
  END IF;

  SELECT rc.component_recipe_id
  INTO v_missing_id
  FROM recipe_components rc
  WHERE rc.assembly_recipe_id = p_recipe_id
    AND rc.component_recipe_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM recipes child WHERE child.id = rc.component_recipe_id
    )
  LIMIT 1;

  IF v_missing_id IS NOT NULL THEN
    RAISE EXCEPTION 'Referenced recipe was not found.';
  END IF;

  SELECT child.name
  INTO v_bad_yield_name
  FROM recipe_components rc
  JOIN recipes child ON child.id = rc.component_recipe_id
  WHERE rc.assembly_recipe_id = p_recipe_id
    AND rc.component_recipe_id IS NOT NULL
    AND (child.yield_quantity IS NULL OR child.yield_quantity <= 0)
  LIMIT 1;

  IF v_bad_yield_name IS NOT NULL THEN
    RAISE EXCEPTION 'Recipe "%" has an invalid yield.', v_bad_yield_name;
  END IF;

  RETURN QUERY
  WITH raw AS (
    SELECT
      ri.ingredient_id,
      ri.quantity,
      ri.unit
    FROM recipe_items ri
    WHERE ri.recipe_id = p_recipe_id

    UNION ALL

    SELECT
      rc.ingredient_id,
      rc.quantity,
      rc.unit
    FROM recipe_components rc
    WHERE rc.assembly_recipe_id = p_recipe_id
      AND rc.ingredient_id IS NOT NULL

    UNION ALL

    SELECT
      e.ingredient_id,
      e.quantity,
      e.unit
    FROM recipe_components rc
    JOIN recipes child ON child.id = rc.component_recipe_id
    CROSS JOIN LATERAL explode_component_recipe_leaves(
      rc.component_recipe_id,
      rc.quantity / child.yield_quantity
    ) e
    WHERE rc.assembly_recipe_id = p_recipe_id
      AND rc.component_recipe_id IS NOT NULL
  )
  SELECT
    raw.ingredient_id,
    round(SUM(raw.quantity), 3)::numeric,
    MIN(raw.unit)
  FROM raw
  WHERE raw.ingredient_id IS NOT NULL
  GROUP BY raw.ingredient_id;
END;
$$;

COMMENT ON FUNCTION collect_recipe_cost_leaves(uuid) IS
  'Internal: raw-leaf quantities for a Component or Assembly recipe. Assembly does not call explode() on itself.';

REVOKE ALL ON FUNCTION collect_recipe_cost_leaves(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION collect_recipe_cost_leaves(uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Shared cost JSON (no role gate — callers are the owner/partner RPCs)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_recipe_cost(
  p_recipe_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe recipes%ROWTYPE;
  v_total_cost numeric(14, 4);
  v_cost_per_yield numeric(14, 4);
  v_has_missing boolean;
  v_missing jsonb;
BEGIN
  IF p_recipe_id IS NULL THEN
    RAISE EXCEPTION 'Recipe id is required.';
  END IF;

  SELECT *
  INTO v_recipe
  FROM recipes
  WHERE id = p_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe was not found.';
  END IF;

  SELECT
    round(
      COALESCE(SUM(l.quantity * COALESCE(i.cost_per_unit, 0)), 0),
      4
    )::numeric(14, 4),
    COALESCE(
      bool_or(i.cost_per_unit IS NULL OR i.cost_per_unit = 0),
      false
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'ingredient_id', i.id,
          'ingredient_name', i.name,
          'unit', i.unit
        )
        ORDER BY i.name, i.id
      ) FILTER (WHERE i.cost_per_unit IS NULL OR i.cost_per_unit = 0),
      '[]'::jsonb
    )
  INTO v_total_cost, v_has_missing, v_missing
  FROM collect_recipe_cost_leaves(p_recipe_id) l
  JOIN ingredients i ON i.id = l.ingredient_id;

  IF v_recipe.yield_quantity > 0 THEN
    v_cost_per_yield := round(
      v_total_cost / v_recipe.yield_quantity,
      4
    )::numeric(14, 4);
  ELSE
    v_cost_per_yield := NULL;
  END IF;

  RETURN jsonb_build_object(
    'recipe_id', v_recipe.id,
    'recipe_name', v_recipe.name,
    'recipe_role', v_recipe.recipe_role,
    'yield_quantity', v_recipe.yield_quantity,
    'yield_unit', v_recipe.yield_unit,
    'is_active', v_recipe.is_active,
    'selling_price', v_recipe.selling_price,
    'total_cost', v_total_cost,
    'cost_per_yield_unit', v_cost_per_yield,
    'has_missing_cost_data', v_has_missing,
    'missing_ingredients', v_missing
  );
END;
$$;

COMMENT ON FUNCTION calculate_recipe_cost(uuid) IS
  'Internal: leaf cost rollup for one recipe. Cycle / broken-ref / invalid-yield exceptions from explode_component_recipe_leaves propagate.';

REVOKE ALL ON FUNCTION calculate_recipe_cost(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION calculate_recipe_cost(uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- 3. get_recipe_cost_detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_recipe_cost_detail(
  p_recipe_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
  v_breakdown jsonb;
BEGIN
  PERFORM require_role('owner', 'partner');

  v_summary := calculate_recipe_cost(p_recipe_id);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'ingredient_id', i.id,
        'ingredient_name', i.name,
        'quantity', l.quantity,
        'unit', l.unit,
        'cost_per_unit', i.cost_per_unit,
        'line_cost', round(
          l.quantity * COALESCE(i.cost_per_unit, 0),
          4
        )::numeric(14, 4)
      )
      ORDER BY
        (l.quantity * COALESCE(i.cost_per_unit, 0)) DESC,
        i.name ASC,
        i.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_breakdown
  FROM collect_recipe_cost_leaves(p_recipe_id) l
  JOIN ingredients i ON i.id = l.ingredient_id;

  RETURN v_summary || jsonb_build_object(
    'ingredient_breakdown', v_breakdown
  );
END;
$$;

COMMENT ON FUNCTION get_recipe_cost_detail(uuid) IS
  'Owner/partner recipe cost with per-ingredient breakdown. Cycle / broken-ref / invalid-yield exceptions propagate.';

REVOKE ALL ON FUNCTION get_recipe_cost_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_recipe_cost_detail(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_recipe_cost_detail(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_recipe_cost_report
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_recipe_cost_report()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe recipes%ROWTYPE;
  v_row jsonb;
  v_acc jsonb := '[]'::jsonb;
BEGIN
  PERFORM require_role('owner', 'partner');

  FOR v_recipe IN
    SELECT *
    FROM recipes
    ORDER BY recipe_role ASC, name ASC, id ASC
  LOOP
    BEGIN
      v_row := calculate_recipe_cost(v_recipe.id);
      v_row := v_row || jsonb_build_object('calculation_error', NULL);
    EXCEPTION
      WHEN OTHERS THEN
        v_row := jsonb_build_object(
          'recipe_id', v_recipe.id,
          'recipe_name', v_recipe.name,
          'recipe_role', v_recipe.recipe_role,
          'yield_quantity', v_recipe.yield_quantity,
          'yield_unit', v_recipe.yield_unit,
          'is_active', v_recipe.is_active,
          'selling_price', v_recipe.selling_price,
          'total_cost', NULL,
          'cost_per_yield_unit', NULL,
          'has_missing_cost_data', NULL,
          'missing_ingredients', NULL,
          'calculation_error', SQLERRM
        );
    END;

    v_acc := v_acc || jsonb_build_array(v_row);
  END LOOP;

  RETURN v_acc;
END;
$$;

COMMENT ON FUNCTION get_recipe_cost_report() IS
  'Owner/partner cost rollup for every recipe. Per-row errors (cycle, broken ref, invalid yield) are captured in calculation_error; the rest of the list still returns.';

REVOKE ALL ON FUNCTION get_recipe_cost_report() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_recipe_cost_report() FROM anon;
GRANT EXECUTE ON FUNCTION get_recipe_cost_report() TO authenticated;
