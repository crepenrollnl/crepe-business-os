-- Inventory Movement History Foundation (DEV-062)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/007_complete_production.sql
--
-- Read-only inventory movement history projection + get RPCs:
--   inventory_movement_history
--   get_inventory_movement_history()
--   get_inventory_movement_history_by_ingredient(ingredient_id)
--
-- Reuses:
--   - received purchase_items as purchase_in (Purchases do not yet post
--     purchase_in stock_movements)
--   - stock_movements rows with ingredient_id (production_out today;
--     sale_out / adjustments when present)
-- Sales confirm finished-goods consumption, not raw-material stock_movements.
-- No writes, no new inventory mutation logic.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- inventory_movement_history (read-only view - one row per ingredient movement)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW inventory_movement_history AS
-- Purchases: received purchase lines as ingredient inflows
SELECT
  pi.id AS movement_id,
  pi.ingredient_id,
  i.name AS ingredient_name,
  'purchase_in'::text AS movement_type,
  pi.quantity,
  i.unit,
  'purchase'::text AS source_type,
  p.id AS source_id,
  p.purchased_at AS occurred_at
FROM purchase_items pi
INNER JOIN purchases p
  ON p.id = pi.purchase_id
 AND p.status = 'received'
INNER JOIN ingredients i
  ON i.id = pi.ingredient_id

UNION ALL

-- Ledger: ingredient stock_movements (production_out and any future types)
SELECT
  sm.id AS movement_id,
  sm.ingredient_id,
  i.name AS ingredient_name,
  sm.movement_type,
  sm.quantity,
  i.unit,
  sm.reference_type AS source_type,
  sm.reference_id AS source_id,
  sm.occurred_at
FROM stock_movements sm
INNER JOIN ingredients i
  ON i.id = sm.ingredient_id
WHERE sm.ingredient_id IS NOT NULL;

COMMENT ON VIEW inventory_movement_history IS
  'Read-only ingredient movement history. Projects received purchase lines and ingredient stock_movements. No writes or stock mutation.';

GRANT SELECT ON inventory_movement_history TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inventory_movement_history
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_inventory_movement_history()
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
        'movement_id', h.movement_id,
        'ingredient_id', h.ingredient_id,
        'ingredient_name', h.ingredient_name,
        'movement_type', h.movement_type,
        'quantity', h.quantity,
        'unit', h.unit,
        'source_type', h.source_type,
        'source_id', h.source_id,
        'occurred_at', h.occurred_at
      )
      ORDER BY h.occurred_at DESC, h.ingredient_name ASC, h.movement_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM inventory_movement_history h;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_inventory_movement_history() IS
  'Return all inventory movement history rows as JSON. Read-only projection over purchases and ingredient stock_movements.';

GRANT EXECUTE ON FUNCTION get_inventory_movement_history() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inventory_movement_history_by_ingredient
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_inventory_movement_history_by_ingredient(
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
        'movement_id', h.movement_id,
        'ingredient_id', h.ingredient_id,
        'ingredient_name', h.ingredient_name,
        'movement_type', h.movement_type,
        'quantity', h.quantity,
        'unit', h.unit,
        'source_type', h.source_type,
        'source_id', h.source_id,
        'occurred_at', h.occurred_at
      )
      ORDER BY h.occurred_at DESC, h.ingredient_name ASC, h.movement_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM inventory_movement_history h
  WHERE h.ingredient_id = p_ingredient_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_inventory_movement_history_by_ingredient(uuid) IS
  'Return inventory movement history rows for one ingredient as JSON. Empty array when none exist.';

GRANT EXECUTE ON FUNCTION get_inventory_movement_history_by_ingredient(uuid) TO authenticated;
