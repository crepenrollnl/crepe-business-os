-- Operational Dashboard KPIs (DEV-044)
-- Run in Supabase SQL editor after sql/021_dashboard_summary.sql
-- (and production session / stock_movements scripts if applied).
--
-- Extends dashboard_summary with operational inventory, production, sales,
-- purchase, and activity timestamps. Prior DEV-042 columns are preserved.
--
-- Reuses report_*_summary where possible.
-- Production session / batch / stock_movements reads are projections only.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers / Suppliers
--   - recalculate FIFO or rewrite ledger / consumptions
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
  -- DEV-042 foundation KPIs
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
  ) AS active_suppliers_count,

  -- Inventory operational KPIs
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_inventory_summary i
      WHERE i.current_stock > 0
        AND i.current_stock <= i.minimum_stock
    ),
    0
  ) AS low_stock_items,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_inventory_summary i
      WHERE i.current_stock <= 0
    ),
    0
  ) AS out_of_stock_items,

  -- Production operational KPIs
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM production_sessions ps
      WHERE ps.status = 'in_progress'
    ),
    0
  ) AS batches_in_progress,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM production_batches pb
      WHERE pb.produced_at::date = CURRENT_DATE
    ),
    0
  ) AS finished_batches_today,

  -- Sales operational KPIs
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_sales_summary s
      WHERE s.status = 'draft'
    ),
    0
  ) AS draft_sales_count,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_sales_summary s
      WHERE s.status IN ('confirmed', 'paid')
        AND s.confirmed_at IS NOT NULL
        AND s.confirmed_at::date = CURRENT_DATE
    ),
    0
  ) AS confirmed_sales_today,

  -- Purchase operational KPIs
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_purchase_summary p
      WHERE p.status = 'draft'
    ),
    0
  ) AS draft_purchase_count,
  COALESCE(
    (
      SELECT COUNT(*)::bigint
      FROM report_purchase_summary p
      WHERE p.status = 'received'
        AND p.purchased_at::date = CURRENT_DATE
    ),
    0
  ) AS completed_purchases_today,

  -- Activity timestamps
  (
    SELECT MAX(sm.occurred_at)
    FROM stock_movements sm
  ) AS last_inventory_movement_at,
  (
    SELECT MAX(s.confirmed_at)
    FROM report_sales_summary s
    WHERE s.confirmed_at IS NOT NULL
  ) AS last_sale_at,
  (
    SELECT MAX(p.purchased_at)
    FROM report_purchase_summary p
  ) AS last_purchase_at;

COMMENT ON VIEW dashboard_summary IS
  'Read-only single-row dashboard KPIs (DEV-042 + DEV-044 operational). Projects report_*_summary and production/stock activity. No mutations; no FIFO/ledger recalculation.';

GRANT SELECT ON dashboard_summary TO authenticated;
