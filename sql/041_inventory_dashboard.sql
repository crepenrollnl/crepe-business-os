-- Inventory Dashboard Foundation (DEV-064)
-- Run in Supabase SQL editor after:
--   sql/006_create_production_sessions.sql
--   sql/023_inventory_alerts.sql
--   sql/035_inventory_valuation.sql
--
-- Read-only inventory dashboard projection + get RPC:
--   inventory_dashboard
--   get_inventory_dashboard()
--
-- Reuses inventory_alerts, inventory_valuation, and production_sessions
-- completion metadata. No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History /
--     Sales Trend Analytics
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- inventory_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW inventory_dashboard AS
SELECT
  (
    SELECT COUNT(*)::integer
    FROM inventory_valuation v
  ) AS total_ingredients,
  (
    SELECT COUNT(*)::integer
    FROM inventory_alerts a
    WHERE a.alert_type = 'LOW_STOCK'
  ) AS low_stock_count,
  (
    SELECT COUNT(*)::integer
    FROM inventory_alerts a
    WHERE a.alert_type = 'OUT_OF_STOCK'
  ) AS out_of_stock_count,
  (
    SELECT COALESCE(SUM(v.stock_value), 0)::numeric(14, 4)
    FROM inventory_valuation v
  ) AS total_inventory_value,
  (
    SELECT MAX(v.last_purchase_date)
    FROM inventory_valuation v
  ) AS last_purchase_date,
  (
    SELECT MAX(ps.completed_at)
    FROM production_sessions ps
    WHERE ps.completed_at IS NOT NULL
  ) AS last_production_date;

COMMENT ON VIEW inventory_dashboard IS
  'Read-only inventory dashboard summary. Projects alert counts, valuation totals, and latest purchase/production dates. No writes or stock mutation.';

GRANT SELECT ON inventory_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inventory_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_inventory_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_ingredients', d.total_ingredients,
    'low_stock_count', d.low_stock_count,
    'out_of_stock_count', d.out_of_stock_count,
    'total_inventory_value', d.total_inventory_value,
    'last_purchase_date', d.last_purchase_date,
    'last_production_date', d.last_production_date
  )
  INTO v_result
  FROM inventory_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_inventory_dashboard() IS
  'Return inventory dashboard summary as JSON. Read-only projection over inventory_alerts, inventory_valuation, and production_sessions.';

GRANT EXECUTE ON FUNCTION get_inventory_dashboard() TO authenticated;
