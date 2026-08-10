-- Purchase Price History Foundation (DEV-059)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/019_create_suppliers.sql
--
-- Read-only purchase price history projection + get RPCs:
--   purchase_price_history
--   get_purchase_price_history()
--   get_purchase_price_history_by_ingredient(ingredient_id)
--
-- Reuses received purchases / purchase_items with ingredient and supplier
-- names. No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- purchase_price_history (read-only view - one row per purchase line)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW purchase_price_history AS
SELECT
  pi.ingredient_id,
  i.name AS ingredient_name,
  s.name AS supplier_name,
  p.purchased_at AS purchase_date,
  pi.quantity,
  pi.unit_cost AS unit_price,
  pi.line_total AS total_price
FROM purchase_items pi
INNER JOIN purchases p
  ON p.id = pi.purchase_id
 AND p.status = 'received'
INNER JOIN ingredients i
  ON i.id = pi.ingredient_id
INNER JOIN suppliers s
  ON s.id = p.supplier_id;

COMMENT ON VIEW purchase_price_history IS
  'Read-only purchase price history. One row per received purchase line. Projects unit_cost / line_total; no writes or stock mutation.';

GRANT SELECT ON purchase_price_history TO authenticated;

-- ---------------------------------------------------------------------------
-- get_purchase_price_history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_purchase_price_history()
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
        'ingredient_id', h.ingredient_id,
        'ingredient_name', h.ingredient_name,
        'supplier_name', h.supplier_name,
        'purchase_date', h.purchase_date,
        'quantity', h.quantity,
        'unit_price', h.unit_price,
        'total_price', h.total_price
      )
      ORDER BY h.purchase_date DESC, h.ingredient_name ASC, h.ingredient_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM purchase_price_history h;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_purchase_price_history() IS
  'Return all purchase price history rows as JSON. Read-only projection over received purchase lines.';

GRANT EXECUTE ON FUNCTION get_purchase_price_history() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_purchase_price_history_by_ingredient
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_purchase_price_history_by_ingredient(
  p_ingredient_id uuid
)
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'ingredient_id', h.ingredient_id,
        'ingredient_name', h.ingredient_name,
        'supplier_name', h.supplier_name,
        'purchase_date', h.purchase_date,
        'quantity', h.quantity,
        'unit_price', h.unit_price,
        'total_price', h.total_price
      )
      ORDER BY h.purchase_date DESC, h.ingredient_name ASC, h.ingredient_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM purchase_price_history h
  WHERE h.ingredient_id = p_ingredient_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_purchase_price_history_by_ingredient(uuid) IS
  'Return purchase price history rows for one ingredient as JSON. Empty array when none exist.';

GRANT EXECUTE ON FUNCTION get_purchase_price_history_by_ingredient(uuid) TO authenticated;
