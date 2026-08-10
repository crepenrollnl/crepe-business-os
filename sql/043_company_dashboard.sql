-- Company Dashboard Foundation (DEV-066)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/002_create_recipes.sql
--   sql/013_create_sales.sql
--   sql/018_create_customers.sql
--   sql/019_create_suppliers.sql
--   sql/041_inventory_dashboard.sql
--   sql/042_production_dashboard.sql
--
-- Read-only company dashboard projection + get RPC:
--   company_dashboard
--   get_company_dashboard()
--
-- Aggregates high-level business metrics from master data and existing
-- inventory / production dashboard projections. No writes, no ledger
-- updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History /
--     Sales Trend Analytics / Inventory Dashboard / Production Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- company_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW company_dashboard AS
SELECT
  (
    SELECT COUNT(*)::integer
    FROM suppliers s
  ) AS total_suppliers,
  (
    SELECT COUNT(*)::integer
    FROM customers c
  ) AS total_customers,
  (
    SELECT COUNT(*)::integer
    FROM recipes r
  ) AS total_recipes,
  (
    SELECT d.total_ingredients
    FROM inventory_dashboard d
    LIMIT 1
  ) AS total_ingredients,
  (
    SELECT d.total_finished_goods
    FROM production_dashboard d
    LIMIT 1
  ) AS total_finished_goods,
  (
    SELECT COUNT(*)::integer
    FROM sales s
    WHERE s.status IN ('confirmed', 'paid')
  ) AS total_sales,
  (
    SELECT COUNT(*)::integer
    FROM purchases p
    WHERE p.status = 'received'
  ) AS total_purchases,
  (
    SELECT d.total_batches
    FROM production_dashboard d
    LIMIT 1
  ) AS total_production_batches,
  (
    SELECT MAX(s.confirmed_at)
    FROM sales s
    WHERE s.status IN ('confirmed', 'paid')
      AND s.confirmed_at IS NOT NULL
  ) AS last_sale_date,
  (
    SELECT d.last_purchase_date
    FROM inventory_dashboard d
    LIMIT 1
  ) AS last_purchase_date,
  (
    SELECT d.last_production_date
    FROM production_dashboard d
    LIMIT 1
  ) AS last_production_date;

COMMENT ON VIEW company_dashboard IS
  'Read-only company dashboard summary. Aggregates master-data counts and reuses inventory/production dashboard metrics. No writes or stock mutation.';

GRANT SELECT ON company_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_company_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_company_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_suppliers', d.total_suppliers,
    'total_customers', d.total_customers,
    'total_recipes', d.total_recipes,
    'total_ingredients', d.total_ingredients,
    'total_finished_goods', d.total_finished_goods,
    'total_sales', d.total_sales,
    'total_purchases', d.total_purchases,
    'total_production_batches', d.total_production_batches,
    'last_sale_date', d.last_sale_date,
    'last_purchase_date', d.last_purchase_date,
    'last_production_date', d.last_production_date
  )
  INTO v_result
  FROM company_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_company_dashboard() IS
  'Return company dashboard summary as JSON. Read-only aggregation over master data and inventory/production dashboard projections.';

GRANT EXECUTE ON FUNCTION get_company_dashboard() TO authenticated;
