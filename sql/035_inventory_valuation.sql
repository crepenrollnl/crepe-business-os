-- Inventory Valuation Foundation (DEV-058)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--
-- Read-only inventory valuation projection + get RPCs:
--   inventory_valuation
--   get_inventory_valuation()
--   get_inventory_item_value(ingredient_id)
--
-- Reuses ingredients.current_stock / ingredients.cost_per_unit and received
-- purchase timestamps. No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- inventory_valuation (read-only view - one row per ingredient)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW inventory_valuation AS
WITH last_purchases AS (
  SELECT
    pi.ingredient_id,
    MAX(p.purchased_at) AS last_purchase_date
  FROM purchase_items pi
  INNER JOIN purchases p
    ON p.id = pi.purchase_id
   AND p.status = 'received'
  GROUP BY pi.ingredient_id
)
SELECT
  i.id AS ingredient_id,
  i.name AS ingredient_name,
  i.current_stock AS current_quantity,
  i.unit,
  COALESCE(i.cost_per_unit, 0)::numeric(14, 4) AS average_cost,
  (
    i.current_stock * COALESCE(i.cost_per_unit, 0)
  )::numeric(14, 4) AS stock_value,
  lp.last_purchase_date
FROM ingredients i
LEFT JOIN last_purchases lp
  ON lp.ingredient_id = i.id;

COMMENT ON VIEW inventory_valuation IS
  'Read-only inventory valuation. stock_value = current_stock * cost_per_unit; average_cost projects ingredients.cost_per_unit. No writes or stock mutation.';

GRANT SELECT ON inventory_valuation TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inventory_valuation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_inventory_valuation()
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
        'ingredient_id', v.ingredient_id,
        'ingredient_name', v.ingredient_name,
        'current_quantity', v.current_quantity,
        'unit', v.unit,
        'average_cost', v.average_cost,
        'stock_value', v.stock_value,
        'last_purchase_date', v.last_purchase_date
      )
      ORDER BY v.ingredient_name ASC, v.ingredient_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM inventory_valuation v;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_inventory_valuation() IS
  'Return all inventory valuation rows as JSON. Read-only projection over ingredient stock and cost.';

GRANT EXECUTE ON FUNCTION get_inventory_valuation() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inventory_item_value
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_inventory_item_value(p_ingredient_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient id is required.';
  END IF;

  SELECT jsonb_build_object(
    'ingredient_id', v.ingredient_id,
    'ingredient_name', v.ingredient_name,
    'current_quantity', v.current_quantity,
    'unit', v.unit,
    'average_cost', v.average_cost,
    'stock_value', v.stock_value,
    'last_purchase_date', v.last_purchase_date
  )
  INTO v_result
  FROM inventory_valuation v
  WHERE v.ingredient_id = p_ingredient_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_inventory_item_value(uuid) IS
  'Return one inventory valuation row as JSON. Returns null when the ingredient is not found.';

GRANT EXECUTE ON FUNCTION get_inventory_item_value(uuid) TO authenticated;
