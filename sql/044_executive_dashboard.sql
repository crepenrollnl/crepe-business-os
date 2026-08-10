-- Executive Dashboard Foundation (DEV-067)
-- Run in Supabase SQL editor after:
--   sql/040_sales_trend_analytics.sql
--   sql/041_inventory_dashboard.sql
--   sql/042_production_dashboard.sql
--   sql/043_company_dashboard.sql
--
-- Read-only executive dashboard projection + get RPC:
--   executive_dashboard
--   get_executive_dashboard()
--
-- Combines highest-level KPIs from company_dashboard, inventory_dashboard,
-- production_dashboard, and sales_trend_analytics (monthly growth).
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
--     Company Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- executive_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW executive_dashboard AS
WITH inv AS (
  SELECT
    d.total_inventory_value,
    d.low_stock_count,
    d.out_of_stock_count,
    d.last_purchase_date
  FROM inventory_dashboard d
  LIMIT 1
),
prod AS (
  SELECT
    d.total_batches,
    d.last_production_date
  FROM production_dashboard d
  LIMIT 1
),
comp AS (
  SELECT
    d.total_sales,
    d.total_purchases,
    d.last_sale_date,
    d.last_purchase_date,
    d.last_production_date
  FROM company_dashboard d
  LIMIT 1
),
monthly_ranked AS (
  SELECT
    t.total_revenue,
    ROW_NUMBER() OVER (ORDER BY t.period_start DESC) AS rn
  FROM sales_trend_analytics t
  WHERE t.period_type = 'monthly'
),
sales_growth_cte AS (
  SELECT
    CASE
      WHEN prev.total_revenue IS NULL OR prev.total_revenue = 0 THEN NULL
      WHEN curr.total_revenue IS NULL THEN NULL
      ELSE (
        (curr.total_revenue - prev.total_revenue)
        / prev.total_revenue
        * 100
      )::numeric(14, 2)
    END AS sales_growth
  FROM monthly_ranked curr
  LEFT JOIN monthly_ranked prev
    ON prev.rn = 2
  WHERE curr.rn = 1
)
SELECT
  CASE
    WHEN COALESCE(inv.out_of_stock_count, 0) > 0 THEN 'critical'
    WHEN COALESCE(inv.low_stock_count, 0) > 0 THEN 'attention'
    WHEN COALESCE(comp.total_sales, 0) = 0
     AND COALESCE(comp.total_purchases, 0) = 0 THEN 'unknown'
    ELSE 'ok'
  END AS company_health,
  COALESCE(inv.total_inventory_value, 0)::numeric(14, 4) AS inventory_value,
  COALESCE(inv.low_stock_count, 0)::integer AS low_stock_count,
  COALESCE(comp.total_sales, 0)::integer AS total_sales,
  COALESCE(comp.total_purchases, 0)::integer AS total_purchases,
  COALESCE(prod.total_batches, 0)::integer AS total_batches,
  (
    SELECT g.sales_growth
    FROM sales_growth_cte g
    LIMIT 1
  ) AS sales_growth,
  comp.last_sale_date,
  COALESCE(comp.last_purchase_date, inv.last_purchase_date) AS last_purchase_date,
  COALESCE(comp.last_production_date, prod.last_production_date) AS last_production_date
FROM inv
CROSS JOIN prod
CROSS JOIN comp;

COMMENT ON VIEW executive_dashboard IS
  'Read-only executive dashboard. Projects KPIs from company/inventory/production dashboards and monthly sales_trend_analytics growth. No writes or stock mutation.';

GRANT SELECT ON executive_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_executive_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_executive_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company_health', d.company_health,
    'inventory_value', d.inventory_value,
    'low_stock_count', d.low_stock_count,
    'total_sales', d.total_sales,
    'total_purchases', d.total_purchases,
    'total_batches', d.total_batches,
    'sales_growth', d.sales_growth,
    'last_sale_date', d.last_sale_date,
    'last_purchase_date', d.last_purchase_date,
    'last_production_date', d.last_production_date
  )
  INTO v_result
  FROM executive_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_executive_dashboard() IS
  'Return executive dashboard summary as JSON. Read-only composition of company, inventory, production, and sales trend projections.';

GRANT EXECUTE ON FUNCTION get_executive_dashboard() TO authenticated;
