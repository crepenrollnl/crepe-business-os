-- Supplier Performance Foundation (DEV-060)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/019_create_suppliers.sql
--
-- Read-only supplier performance projection + get RPCs:
--   supplier_performance
--   get_supplier_performance()
--   get_supplier_performance_by_supplier(supplier_id)
--
-- Reuses received purchases totals and supplier master names.
-- No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- supplier_performance (read-only view - one row per supplier)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW supplier_performance AS
WITH received_purchases AS (
  SELECT
    p.supplier_id,
    COUNT(*)::integer AS purchase_count,
    COALESCE(SUM(p.total), 0) AS total_spent,
    MAX(p.purchased_at) AS last_purchase_date
  FROM purchases p
  WHERE p.status = 'received'
  GROUP BY p.supplier_id
)
SELECT
  s.id AS supplier_id,
  s.name AS supplier_name,
  COALESCE(rp.purchase_count, 0)::integer AS purchase_count,
  COALESCE(rp.total_spent, 0)::numeric(14, 2) AS total_spent,
  CASE
    WHEN COALESCE(rp.purchase_count, 0) > 0 THEN
      (COALESCE(rp.total_spent, 0) / rp.purchase_count)::numeric(14, 2)
    ELSE 0::numeric(14, 2)
  END AS average_order_value,
  rp.last_purchase_date
FROM suppliers s
LEFT JOIN received_purchases rp
  ON rp.supplier_id = s.id;

COMMENT ON VIEW supplier_performance IS
  'Read-only supplier performance. Aggregates received purchases (count, spend, AOV, last purchase). No writes or stock mutation.';

GRANT SELECT ON supplier_performance TO authenticated;

-- ---------------------------------------------------------------------------
-- get_supplier_performance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_supplier_performance()
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
        'supplier_id', sp.supplier_id,
        'supplier_name', sp.supplier_name,
        'purchase_count', sp.purchase_count,
        'total_spent', sp.total_spent,
        'average_order_value', sp.average_order_value,
        'last_purchase_date', sp.last_purchase_date
      )
      ORDER BY sp.supplier_name ASC, sp.supplier_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM supplier_performance sp;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_supplier_performance() IS
  'Return all supplier performance rows as JSON. Read-only aggregation over received purchases.';

GRANT EXECUTE ON FUNCTION get_supplier_performance() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_supplier_performance_by_supplier
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_supplier_performance_by_supplier(
  p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier id is required.';
  END IF;

  SELECT jsonb_build_object(
    'supplier_id', sp.supplier_id,
    'supplier_name', sp.supplier_name,
    'purchase_count', sp.purchase_count,
    'total_spent', sp.total_spent,
    'average_order_value', sp.average_order_value,
    'last_purchase_date', sp.last_purchase_date
  )
  INTO v_result
  FROM supplier_performance sp
  WHERE sp.supplier_id = p_supplier_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_supplier_performance_by_supplier(uuid) IS
  'Return one supplier performance row as JSON. Returns null when the supplier is not found.';

GRANT EXECUTE ON FUNCTION get_supplier_performance_by_supplier(uuid) TO authenticated;
