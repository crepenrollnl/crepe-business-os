-- Sales by Product (read-only period aggregate)
-- Run in Supabase SQL editor after sql/094 (VAT-inclusive line_total) and
-- sql/092 (COGS ledgers: finished_goods_batch_consumptions + stock_movements).
--
-- One row per product_id for confirmed/paid sales whose confirmed_at is
-- inside [p_from, p_to] (inclusive timestamptz — the client owns local TZ
-- day/shift/week bounds).
--
-- Revenue (A1): line_net_raw = line_total * (subtotal / NULLIF(total, 0)).
-- SUM raw per product_id, then round once. line_total is VAT-inclusive
-- (sql/094); this allocates the sale's stored net (subtotal) across lines
-- so product nets add up to SUM(subtotal) before per-SKU rounding.
--
-- Quantity: round(SUM(sale_lines.quantity), 3).
-- COGS: SUM(fgbc.total_cost) + SUM(sm.quantity * unit_cost) for sale_line
-- layers in the same window, then round once per SKU (sql/092 order, SKU
-- grain — not round-per-sale).
-- Profit / margin from already-rounded revenue and COGS. Margin NULL when
-- revenue is 0.
--
-- Window identity: SUM(line_net_raw) = SUM(sales.subtotal) before SKU
-- rounding. After round-once-per-product, SUM(revenue) may differ from
-- that net by at most 1 cent (plan A1). V1 check for shift
-- c52d5474-6594-4061-91cc-42672111ef19 (opened 09:23 UTC, closed 13:30 UTC):
--
--   SELECT round(SUM(revenue), 2)
--   FROM get_sales_by_product(
--     '2026-08-29 09:23:00+00',
--     '2026-08-29 13:30:00+00'
--   );
--   -- expect 571.60 (±0.01 vs shift_daily_profit_summaries.net_revenue)
--
-- Does NOT:
--   - change sales / sale_lines / ledger schema
--   - write anything
--   - round per sale line or per sale

CREATE OR REPLACE FUNCTION get_sales_by_product(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  quantity numeric,
  revenue numeric,
  cogs numeric,
  gross_profit numeric,
  gross_margin_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_from IS NULL THEN
    RAISE EXCEPTION 'Period start is required.';
  END IF;

  IF p_to IS NULL THEN
    RAISE EXCEPTION 'Period end is required.';
  END IF;

  IF p_from > p_to THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH window_lines AS (
    SELECT
      sl.id AS sale_line_id,
      sl.product_id AS product_id,
      sl.quantity AS quantity,
      sl.line_total AS line_total,
      s.subtotal AS sale_subtotal,
      s.total AS sale_total
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    WHERE s.status IN ('confirmed', 'paid')
      AND s.confirmed_at IS NOT NULL
      AND s.confirmed_at >= p_from
      AND s.confirmed_at <= p_to
  ),
  line_facts AS (
    SELECT
      wl.sale_line_id,
      wl.product_id,
      wl.quantity,
      CASE
        WHEN wl.sale_total IS NULL OR wl.sale_total = 0 THEN 0::numeric
        ELSE wl.line_total * (wl.sale_subtotal / wl.sale_total)
      END AS line_net_raw
    FROM window_lines wl
  ),
  cogs_fg AS (
    SELECT
      lf.product_id,
      COALESCE(SUM(fgbc.total_cost), 0) AS fg_cogs
    FROM line_facts lf
    JOIN finished_goods_batch_consumptions fgbc
      ON fgbc.source_id = lf.sale_line_id
    WHERE fgbc.source_type = 'sale_line'
      AND fgbc.direction = 'out'
      AND fgbc.reason = 'sale'
    GROUP BY lf.product_id
  ),
  cogs_sm AS (
    SELECT
      lf.product_id,
      COALESCE(SUM(sm.quantity * sm.unit_cost), 0) AS sm_cogs
    FROM line_facts lf
    JOIN stock_movements sm
      ON sm.reference_id = lf.sale_line_id
    WHERE sm.reference_type = 'sale'
      AND sm.movement_type = 'sale_out'
    GROUP BY lf.product_id
  ),
  grouped AS (
    SELECT
      qty.product_id,
      qty.raw_qty,
      qty.raw_revenue,
      COALESCE(fg.fg_cogs, 0) + COALESCE(sm.sm_cogs, 0) AS raw_cogs
    FROM (
      SELECT
        lf.product_id,
        SUM(lf.quantity) AS raw_qty,
        SUM(lf.line_net_raw) AS raw_revenue
      FROM line_facts lf
      GROUP BY lf.product_id
    ) qty
    LEFT JOIN cogs_fg fg ON fg.product_id = qty.product_id
    LEFT JOIN cogs_sm sm ON sm.product_id = qty.product_id
  )
  SELECT
    g.product_id,
    COALESCE(r.name, g.product_id::text),
    round(g.raw_qty, 3),
    round(g.raw_revenue, 2),
    round(g.raw_cogs, 2),
    round(round(g.raw_revenue, 2) - round(g.raw_cogs, 2), 2),
    CASE
      WHEN round(g.raw_revenue, 2) = 0 THEN NULL
      ELSE round(
        (
          (round(g.raw_revenue, 2) - round(g.raw_cogs, 2))
          / round(g.raw_revenue, 2)
        ) * 100,
        2
      )
    END
  FROM grouped g
  LEFT JOIN recipes r ON r.id = g.product_id
  ORDER BY 2;
END;
$$;

COMMENT ON FUNCTION get_sales_by_product(timestamptz, timestamptz) IS
  'Read-only product sales P&L for a confirmed_at window. Net revenue allocates sales.subtotal by VAT-inclusive line_total share (A1). COGS sums FG + sale_out layers. Round once per product.';

REVOKE ALL ON FUNCTION get_sales_by_product(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_sales_by_product(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION get_sales_by_product(timestamptz, timestamptz) TO authenticated;
