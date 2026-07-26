-- Alerts Dashboard Foundation (DEV-069)
-- Run in Supabase SQL editor after:
--   sql/006_create_production_sessions.sql
--   sql/019_create_suppliers.sql
--   sql/030_import_jobs.sql
--   sql/031_export_jobs.sql
--   sql/032_system_health.sql
--   sql/035_inventory_valuation.sql
--   sql/041_inventory_dashboard.sql
--   sql/042_production_dashboard.sql
--   sql/044_executive_dashboard.sql
--
-- Read-only alerts dashboard projection + get RPC:
--   alerts_dashboard
--   get_alerts_dashboard()
--
-- Aggregates actionable operational alert counts/status from existing
-- inventory, production, executive, system_health, and master-data views.
-- No duplicated base aggregations, no writes, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History /
--     Sales Trend Analytics / Inventory Dashboard / Production Dashboard /
--     Company Dashboard / Executive Dashboard / KPI Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- alerts_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW alerts_dashboard AS
WITH inv AS (
  SELECT
    d.low_stock_count,
    d.out_of_stock_count
  FROM inventory_dashboard d
  LIMIT 1
),
prod AS (
  SELECT
    d.failed_batches
  FROM production_dashboard d
  LIMIT 1
),
exec AS (
  SELECT
    d.sales_growth
  FROM executive_dashboard d
  LIMIT 1
),
health AS (
  SELECT
    COALESCE(
      (
        SELECT h.status
        FROM system_health h
        WHERE h.component = 'company_settings'
        LIMIT 1
      ),
      'unavailable'
    ) AS company_settings_status,
    COALESCE(
      (
        SELECT h.status
        FROM system_health h
        WHERE h.component = 'backup'
        LIMIT 1
      ),
      'unknown'
    ) AS backup_status
)
SELECT
  COALESCE(inv.low_stock_count, 0)::integer AS low_stock_alerts,
  COALESCE(inv.out_of_stock_count, 0)::integer AS out_of_stock_alerts,
  (
    SELECT COUNT(*)::integer
    FROM production_sessions ps
    WHERE ps.status IN ('ready', 'in_progress')
      AND ps.started_at < (now() - interval '1 day')
  ) AS overdue_production,
  COALESCE(prod.failed_batches, 0)::integer AS failed_batches,
  (
    SELECT COUNT(*)::integer
    FROM inventory_valuation v
    WHERE v.last_purchase_date IS NULL
       OR v.last_purchase_date < (now() - interval '90 days')
  ) AS stale_purchase_prices,
  (
    SELECT COUNT(*)::integer
    FROM suppliers s
    WHERE s.is_active IS FALSE
  ) AS inactive_suppliers,
  CASE
    WHEN exec.sales_growth IS NOT NULL AND exec.sales_growth < 0 THEN true
    ELSE false
  END AS declining_sales,
  CASE
    WHEN COALESCE(health.company_settings_status, 'unavailable') = 'unavailable'
      THEN true
    ELSE false
  END AS missing_company_settings,
  COALESCE(health.backup_status, 'unknown')::text AS backup_status,
  (
    (
      SELECT COUNT(*)::integer
      FROM import_jobs j
      WHERE j.status = 'failed'
    )
    +
    (
      SELECT COUNT(*)::integer
      FROM export_jobs j
      WHERE j.status = 'failed'
    )
  )::integer AS import_export_failures
FROM inv
CROSS JOIN prod
CROSS JOIN exec
CROSS JOIN health;

COMMENT ON VIEW alerts_dashboard IS
  'Read-only alerts dashboard. Projects operational alert counts/status from inventory, production, executive, system_health, and job metadata. No writes or stock mutation.';

GRANT SELECT ON alerts_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_alerts_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_alerts_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'low_stock_alerts', d.low_stock_alerts,
    'out_of_stock_alerts', d.out_of_stock_alerts,
    'overdue_production', d.overdue_production,
    'failed_batches', d.failed_batches,
    'stale_purchase_prices', d.stale_purchase_prices,
    'inactive_suppliers', d.inactive_suppliers,
    'declining_sales', d.declining_sales,
    'missing_company_settings', d.missing_company_settings,
    'backup_status', d.backup_status,
    'import_export_failures', d.import_export_failures
  )
  INTO v_result
  FROM alerts_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_alerts_dashboard() IS
  'Return alerts dashboard summary as JSON. Read-only composition of existing alert and health projections.';

GRANT EXECUTE ON FUNCTION get_alerts_dashboard() TO authenticated;
