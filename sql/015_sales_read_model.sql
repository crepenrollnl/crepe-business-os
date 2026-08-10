-- Sales Read Model (DEV-028)
-- Run in Supabase SQL editor after sql/013_create_sales.sql
-- (and sql/014_confirm_sale.sql if already applied).
--
-- Read-only views for Sales screens.
-- UI must read these views only — never assemble Sales from base tables.
--
-- Does NOT:
--   - create RPCs or triggers
--   - modify sales / sale_lines tables
--   - expose FIFO, ledger, or COGS
--   - calculate inventory / remaining quantity

-- ---------------------------------------------------------------------------
-- sales_list_view — one row per Sale (list page)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sales_list_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at
FROM sales s;

COMMENT ON VIEW sales_list_view IS
  'Read-only Sales list. One row per sale. No lines, FIFO, ledger, or COGS.';

GRANT SELECT ON sales_list_view TO authenticated;

-- ---------------------------------------------------------------------------
-- sale_details_view — sale header + lines (details page)
-- One row per sale line; header columns repeated. Drafts with no lines
-- still appear once (LEFT JOIN) with null line fields.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sale_details_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  sl.id AS line_id,
  sl.product_id,
  sl.quantity,
  sl.unit_price,
  sl.line_total
FROM sales s
LEFT JOIN sale_lines sl
  ON sl.sale_id = s.id;

COMMENT ON VIEW sale_details_view IS
  'Read-only Sale details. Header + lines per row. No FIFO, ledger, or COGS.';

GRANT SELECT ON sale_details_view TO authenticated;
