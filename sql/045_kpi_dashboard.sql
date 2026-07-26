-- KPI Dashboard Foundation (DEV-068)
-- Run in Supabase SQL editor after:
--   sql/020_reporting_foundation.sql
--   sql/034_recipe_cost_analysis.sql
--   sql/040_sales_trend_analytics.sql
--   sql/041_inventory_dashboard.sql
--   sql/042_production_dashboard.sql
--   sql/043_company_dashboard.sql
--   sql/044_executive_dashboard.sql
--
-- Read-only KPI dashboard projection + get RPC:
--   kpi_dashboard
--   get_kpi_dashboard()
--
-- Aggregates key business KPIs from existing dashboard and reporting views.
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
--     Company Dashboard / Executive Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- kpi_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW kpi_dashboard AS
WITH exec AS (
  SELECT
    d.sales_growth,
    d.inventory_value,
    d.low_stock_count
  FROM executive_dashboard d
  LIMIT 1
),
comp AS (
  SELECT
    d.total_sales,
    d.total_suppliers,
    d.total_customers,
    d.total_ingredients
  FROM company_dashboard d
  LIMIT 1
),
prod AS (
  SELECT
    d.completed_batches,
    d.failed_batches
  FROM production_dashboard d
  LIMIT 1
),
sales_kpi AS (
  SELECT
    COALESCE(SUM(t.total_revenue), 0)::numeric(14, 2) AS gross_revenue
  FROM sales_trend_analytics t
  WHERE t.period_type = 'daily'
),
recipe_kpi AS (
  SELECT
    AVG(r.total_cost)::numeric(14, 4) AS recipe_cost_average
  FROM recipe_cost_analysis r
),
purchase_value AS (
  SELECT
    COALESCE(SUM(p.total), 0)::numeric(14, 2) AS received_purchase_value
  FROM report_purchase_summary p
  WHERE p.status = 'received'
)
SELECT
  sk.gross_revenue,
  COALESCE(comp.total_sales, 0)::integer AS total_orders,
  CASE
    WHEN COALESCE(comp.total_sales, 0) > 0 THEN
      (sk.gross_revenue / comp.total_sales)::numeric(14, 2)
    ELSE 0::numeric(14, 2)
  END AS average_order_value,
  CASE
    WHEN COALESCE(exec.inventory_value, 0) > 0 THEN
      (pv.received_purchase_value / exec.inventory_value)::numeric(14, 4)
    ELSE NULL
  END AS inventory_turnover,
  rk.recipe_cost_average,
  COALESCE(comp.total_suppliers, 0)::integer AS supplier_count,
  COALESCE(comp.total_customers, 0)::integer AS customer_count,
  CASE
    WHEN (COALESCE(prod.completed_batches, 0) + COALESCE(prod.failed_batches, 0)) > 0 THEN
      (
        prod.completed_batches::numeric
        / (prod.completed_batches + prod.failed_batches)
        * 100
      )::numeric(14, 2)
    ELSE NULL
  END AS production_efficiency,
  CASE
    WHEN COALESCE(comp.total_ingredients, 0) > 0 THEN
      (
        COALESCE(exec.low_stock_count, 0)::numeric
        / comp.total_ingredients
        * 100
      )::numeric(14, 2)
    ELSE NULL
  END AS low_stock_ratio,
  exec.sales_growth
FROM sales_kpi sk
CROSS JOIN exec
CROSS JOIN comp
CROSS JOIN prod
CROSS JOIN recipe_kpi rk
CROSS JOIN purchase_value pv;

COMMENT ON VIEW kpi_dashboard IS
  'Read-only KPI dashboard. Projects revenue/order KPIs from sales_trend_analytics and company/executive/production/recipe/purchase reporting views. inventory_turnover = received purchase value / inventory value. No writes or stock mutation.';

GRANT SELECT ON kpi_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_kpi_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_kpi_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'gross_revenue', d.gross_revenue,
    'total_orders', d.total_orders,
    'average_order_value', d.average_order_value,
    'inventory_turnover', d.inventory_turnover,
    'recipe_cost_average', d.recipe_cost_average,
    'supplier_count', d.supplier_count,
    'customer_count', d.customer_count,
    'production_efficiency', d.production_efficiency,
    'low_stock_ratio', d.low_stock_ratio,
    'sales_growth', d.sales_growth
  )
  INTO v_result
  FROM kpi_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_kpi_dashboard() IS
  'Return KPI dashboard summary as JSON. Read-only composition of existing dashboard and reporting projections.';

GRANT EXECUTE ON FUNCTION get_kpi_dashboard() TO authenticated;
