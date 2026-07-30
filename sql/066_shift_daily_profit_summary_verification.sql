-- Daily Profit Summary Server-Side Verification (V1 plan 1.2)
-- Run in Supabase SQL editor after sql/063_create_shift_daily_profit_summaries.sql.
--
-- Problem: daily-profit-summary-service.ts computes net_revenue / total_cogs /
-- gross_profit / gross_margin_percent in JS (buildDailyProfitSummary, reusing
-- frozen per-sale profit facts) and inserts directly into the append-only
-- shift_daily_profit_summaries table with no server-side check. A JS bug or
-- stale client could freeze a wrong historical record that can never be
-- corrected afterwards.
--
-- Fix: an independent SQL recomputation of the same aggregate directly from
-- `sales` (frozen subtotal = net revenue) and `finished_goods_batch_consumptions`
-- (frozen COGS layers for sale lines), compared against the JS-built values.
-- The service must call this RPC and reject the insert on any mismatch.
--
-- Additive only:
--   function: verify_daily_profit_summary(...) -> boolean
--
-- Does NOT:
--   - change shift_daily_profit_summaries schema
--   - perform the insert itself (verification only)
--   - change Sales / Finished Goods module logic

CREATE OR REPLACE FUNCTION verify_daily_profit_summary(
  p_shift_id uuid,
  p_net_revenue numeric,
  p_total_cogs numeric,
  p_gross_profit numeric,
  p_gross_margin_percent numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift shifts%ROWTYPE;
  v_net_revenue numeric;
  v_total_cogs numeric;
  v_gross_profit numeric;
  v_gross_margin_percent numeric;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % was not found.', p_shift_id;
  END IF;

  IF v_shift.status <> 'closed' OR v_shift.closed_at IS NULL THEN
    RAISE EXCEPTION 'Only a closed shift can have a daily profit summary.';
  END IF;

  SELECT round(COALESCE(SUM(s.subtotal), 0), 2)
  INTO v_net_revenue
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  SELECT round(COALESCE(SUM(fgbc.total_cost), 0), 2)
  INTO v_total_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  JOIN sales s ON s.id = sl.sale_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  v_gross_profit := round(v_net_revenue - v_total_cogs, 2);
  v_gross_margin_percent := CASE
    WHEN v_net_revenue = 0 THEN NULL
    ELSE round((v_gross_profit / v_net_revenue) * 100, 2)
  END;

  RETURN v_net_revenue = round(p_net_revenue, 2)
    AND v_total_cogs = round(p_total_cogs, 2)
    AND v_gross_profit = round(p_gross_profit, 2)
    AND (
      (v_gross_margin_percent IS NULL AND p_gross_margin_percent IS NULL)
      OR (
        v_gross_margin_percent IS NOT NULL
        AND p_gross_margin_percent IS NOT NULL
        AND v_gross_margin_percent = round(p_gross_margin_percent, 2)
      )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION verify_daily_profit_summary(
  uuid, numeric, numeric, numeric, numeric
) TO authenticated;
