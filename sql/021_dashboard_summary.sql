-- Dashboard Foundation (DEV-042)
-- Run in Supabase SQL editor after sql/020_reporting_foundation.sql
-- (and sql/018_create_customers.sql / sql/019_create_suppliers.sql for active counts).
--
-- Single read-only KPI row for future dashboard widgets:
--   dashboard_summary
--
-- Reuses report_*_summary views for operational totals.
-- Active customer/supplier counts come from masters (no report views yet).
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Finished Goods / Sales
--   - modify Customers / Suppliers / Reporting module code or report views
--   - recalculate FIFO or rewrite ledger / consumptions
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
  COALESCE(
    (SELECT SUM(i.stock_value) FROM report_inventory_summary i),
    0
  ) AS total_inventory_value,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_inventory_summary i
      WHERE i.is_below_minimum IS TRUE
    ),
    0
  ) AS inventory_items_below_minimum,
  COALESCE(
    (SELECT SUM(f.available_quantity) FROM report_finished_goods_summary f),
    0
  ) AS finished_goods_available,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM report_sales_summary s),
    0
  ) AS total_sales_count,
  COALESCE(
    (SELECT COUNT(*)::bigint FROM report_purchase_summary p),
    0
  ) AS total_purchase_count,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM customers c
      WHERE c.is_active IS TRUE
    ),
    0
  ) AS active_customers_count,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM suppliers s
      WHERE s.is_active IS TRUE
    ),
    0
  ) AS active_suppliers_count;

COMMENT ON VIEW dashboard_summary IS
  'Read-only single-row dashboard KPIs. Projects report_*_summary + active customer/supplier counts. No mutations; no FIFO/ledger recalculation.';

GRANT SELECT ON dashboard_summary TO authenticated;
