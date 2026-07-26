-- Reporting Foundation (DEV-041)
-- Run in Supabase SQL editor after:
--   sql/001_create_purchases.sql
--   sql/012_finished_goods_availability.sql
--   sql/015_sales_read_model.sql
--
-- Read-only reporting views for dashboards and future reporting APIs:
--   report_inventory_summary
--   report_finished_goods_summary
--   report_sales_summary
--   report_purchase_summary
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Finished Goods / Sales
--   - recalculate FIFO or rewrite ledger / consumptions
--   - store remaining_quantity or product-level finished-goods stock
--   - create RPCs, triggers, hooks, services, UI, or tests

-- ---------------------------------------------------------------------------
-- report_inventory_summary — one row per ingredient
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW report_inventory_summary AS
SELECT
  i.id AS ingredient_id,
  i.name AS ingredient_name,
  i.unit,
  i.category_id,
  i.supplier_id,
  i.current_stock,
  i.minimum_stock,
  i.cost_per_unit,
  (i.current_stock * i.cost_per_unit) AS stock_value,
  (i.current_stock <= i.minimum_stock) AS is_below_minimum
FROM ingredients i;

COMMENT ON VIEW report_inventory_summary IS
  'Read-only inventory reporting DTO. One row per ingredient. Projects current_stock (read-optimized); no stock mutations.';

GRANT SELECT ON report_inventory_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- report_finished_goods_summary — one row per product with batches
-- Reuses finished_goods_batch_availability (produced − Σ ledger), never
-- recomputes FIFO or writes production_batches / consumptions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW report_finished_goods_summary AS
SELECT
  a.product_id,
  r.name AS product_name,
  COALESCE(
    SUM(a.available_quantity) FILTER (WHERE a.available_quantity > 0),
    0
  ) AS available_quantity,
  COUNT(*) FILTER (WHERE a.available_quantity > 0) AS active_batch_count,
  CASE
    WHEN COALESCE(
      SUM(a.available_quantity) FILTER (WHERE a.available_quantity > 0),
      0
    ) <= 0 THEN NULL
    ELSE
      SUM(a.available_quantity * a.unit_cost)
        FILTER (WHERE a.available_quantity > 0)
      / SUM(a.available_quantity)
        FILTER (WHERE a.available_quantity > 0)
  END AS average_unit_cost,
  CASE
    WHEN COALESCE(
      SUM(a.available_quantity) FILTER (WHERE a.available_quantity > 0),
      0
    ) <= 0 THEN NULL
    ELSE
      SUM(a.available_quantity * a.unit_cost)
        FILTER (WHERE a.available_quantity > 0)
  END AS inventory_value,
  MIN(a.produced_at) FILTER (WHERE a.available_quantity > 0)
    AS oldest_batch_at,
  MAX(a.produced_at) FILTER (WHERE a.available_quantity > 0)
    AS newest_batch_at,
  CASE
    WHEN COALESCE(
      SUM(a.available_quantity) FILTER (WHERE a.available_quantity > 0),
      0
    ) <= 0 THEN 'out_of_stock'
    ELSE 'available'
  END AS production_status
FROM finished_goods_batch_availability a
LEFT JOIN recipes r
  ON r.id = a.product_id
GROUP BY
  a.product_id,
  r.name;

COMMENT ON VIEW report_finished_goods_summary AS
  'Read-only finished-goods reporting DTO. Product-level projection over finished_goods_batch_availability. No FIFO/ledger mutation; remaining never stored.';

GRANT SELECT ON report_finished_goods_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- report_sales_summary — one row per sale (reuses sales_list_view)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW report_sales_summary AS
SELECT
  v.sale_id,
  v.sale_number,
  v.status,
  v.sale_date,
  v.customer_id,
  v.subtotal,
  v.tax_total,
  v.total,
  v.confirmed_at,
  v.paid_at,
  v.cancelled_at
FROM sales_list_view v;

COMMENT ON VIEW report_sales_summary AS
  'Read-only sales reporting DTO. One row per sale via sales_list_view. No FIFO, ledger, or COGS.';

GRANT SELECT ON report_sales_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- report_purchase_summary — one row per purchase
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW report_purchase_summary AS
SELECT
  p.id AS purchase_id,
  p.supplier_id,
  p.status,
  p.invoice_number,
  p.subtotal,
  p.tax_total,
  p.total,
  p.currency,
  p.purchased_at,
  p.created_at,
  p.updated_at
FROM purchases p;

COMMENT ON VIEW report_purchase_summary AS
  'Read-only purchase reporting DTO. One row per purchase header. No stock mutations.';

GRANT SELECT ON report_purchase_summary TO authenticated;
