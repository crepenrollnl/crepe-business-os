-- Recipe Cost Analysis Foundation (DEV-057)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/002_create_recipes.sql
--
-- Read-only recipe cost projection + get RPCs:
--   recipe_cost_analysis
--   get_recipe_cost_analysis()
--   get_recipe_cost(recipe_id)
--
-- Reuses recipes / recipe_items / ingredients.cost_per_unit and received
-- purchase timestamps. No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- recipe_cost_analysis (read-only view - one row per recipe)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW recipe_cost_analysis AS
WITH line_costs AS (
  SELECT
    ri.recipe_id,
    COUNT(ri.id)::integer AS ingredient_count,
    COALESCE(
      SUM(ri.quantity * COALESCE(i.cost_per_unit, 0)),
      0
    ) AS total_cost
  FROM recipe_items ri
  LEFT JOIN ingredients i
    ON i.id = ri.ingredient_id
  GROUP BY ri.recipe_id
),
purchase_updates AS (
  SELECT
    ri.recipe_id,
    MAX(p.purchased_at) AS last_purchase_at
  FROM recipe_items ri
  INNER JOIN purchase_items pi
    ON pi.ingredient_id = ri.ingredient_id
  INNER JOIN purchases p
    ON p.id = pi.purchase_id
   AND p.status = 'received'
  GROUP BY ri.recipe_id
)
SELECT
  r.id AS recipe_id,
  r.name AS recipe_name,
  COALESCE(lc.total_cost, 0)::numeric(14, 4) AS total_cost,
  COALESCE(lc.ingredient_count, 0)::integer AS ingredient_count,
  GREATEST(
    r.updated_at,
    COALESCE(pu.last_purchase_at, r.updated_at)
  ) AS last_cost_update,
  CASE
    WHEN r.yield_quantity > 0 THEN
      (
        COALESCE(lc.total_cost, 0) / r.yield_quantity
      )::numeric(14, 4)
    ELSE NULL
  END AS cost_per_portion
FROM recipes r
LEFT JOIN line_costs lc
  ON lc.recipe_id = r.id
LEFT JOIN purchase_updates pu
  ON pu.recipe_id = r.id;

COMMENT ON VIEW recipe_cost_analysis IS
  'Read-only recipe cost analysis. total_cost = SUM(BOM qty * ingredient cost_per_unit); cost_per_portion = total_cost / yield_quantity. No writes or stock mutation.';

GRANT SELECT ON recipe_cost_analysis TO authenticated;

-- ---------------------------------------------------------------------------
-- get_recipe_cost_analysis
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_recipe_cost_analysis()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'recipe_id', a.recipe_id,
        'recipe_name', a.recipe_name,
        'total_cost', a.total_cost,
        'ingredient_count', a.ingredient_count,
        'last_cost_update', a.last_cost_update,
        'cost_per_portion', a.cost_per_portion
      )
      ORDER BY a.recipe_name ASC, a.recipe_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM recipe_cost_analysis a;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_recipe_cost_analysis() IS
  'Return all recipe cost analysis rows as JSON. Read-only projection over recipes and ingredient costs.';

GRANT EXECUTE ON FUNCTION get_recipe_cost_analysis() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_recipe_cost
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_recipe_cost(p_recipe_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_recipe_id IS NULL THEN
    RAISE EXCEPTION 'Recipe id is required.';
  END IF;

  SELECT jsonb_build_object(
    'recipe_id', a.recipe_id,
    'recipe_name', a.recipe_name,
    'total_cost', a.total_cost,
    'ingredient_count', a.ingredient_count,
    'last_cost_update', a.last_cost_update,
    'cost_per_portion', a.cost_per_portion
  )
  INTO v_result
  FROM recipe_cost_analysis a
  WHERE a.recipe_id = p_recipe_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_recipe_cost(uuid) IS
  'Return one recipe cost analysis row as JSON. Returns null when the recipe is not found.';

GRANT EXECUTE ON FUNCTION get_recipe_cost(uuid) TO authenticated;
