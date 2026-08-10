-- Daily Sales Summary Server-Side Verification (V1 plan 1.2)
-- Run in Supabase SQL editor after sql/062_create_shift_daily_sales_summaries.sql.
--
-- Problem: daily-sales-summary-service.ts computes sales_count / items_sold /
-- gross_revenue / net_revenue / average_receipt in JS (buildDailySalesSummary)
-- and inserts directly into the append-only shift_daily_sales_summaries table
-- with no server-side check. A JS bug or stale client could freeze a wrong
-- historical record that can never be corrected afterwards.
--
-- Fix: an independent SQL recomputation of the same aggregate from `sales` /
-- `sale_lines`, compared against the JS-built values. The service must call
-- this RPC and reject the insert on any mismatch before writing.
--
-- Additive only:
--   function: verify_daily_sales_summary(...) -> boolean
--
-- Does NOT:
--   - change shift_daily_sales_summaries schema
--   - perform the insert itself (verification only)
--   - change Sales module logic

CREATE OR REPLACE FUNCTION verify_daily_sales_summary(
  p_shift_id uuid,
  p_sales_count integer,
  p_items_sold numeric,
  p_gross_revenue numeric,
  p_net_revenue numeric,
  p_average_receipt numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_sales_count integer;
  v_items_sold numeric;
  v_gross_revenue numeric;
  v_net_revenue numeric;
  v_average_receipt numeric;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % was not found.', p_shift_id;
  END IF;

  IF v_shift.status <> 'closed' OR v_shift.closed_at IS NULL THEN
    RAISE EXCEPTION 'Only a closed shift can have a daily sales summary.';
  END IF;

  SELECT
    COUNT(*)::integer,
    round(COALESCE(SUM(s.total), 0), 2),
    round(COALESCE(SUM(s.subtotal), 0), 2)
  INTO
    v_sales_count,
    v_gross_revenue,
    v_net_revenue
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  SELECT round(COALESCE(SUM(sl.quantity), 0), 3)
  INTO v_items_sold
  FROM sale_lines sl
  JOIN sales s ON s.id = sl.sale_id
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  v_average_receipt := CASE
    WHEN v_sales_count > 0 THEN round(v_gross_revenue / v_sales_count, 2)
    ELSE 0
  END;

  RETURN v_sales_count = p_sales_count
    AND v_items_sold = round(p_items_sold, 3)
    AND v_gross_revenue = round(p_gross_revenue, 2)
    AND v_net_revenue = round(p_net_revenue, 2)
    AND v_average_receipt = round(p_average_receipt, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_daily_sales_summary(
  uuid, integer, numeric, numeric, numeric, numeric
) TO authenticated;
