-- Verify Daily Profit Summary -- account for direct raw-ingredient consumption
-- Run in Supabase SQL editor after sql/090_verify_sale_cost_direct_ingredients.sql.
--
-- Problem: verify_daily_profit_summary (sql/066) independently recomputes a
-- closed shift's COGS by summing finished_goods_batch_consumptions only.
-- sql/089 added a second, equally legitimate way confirm_sale accrues COGS
-- for an assembly line -- a direct raw-ingredient decrement (recipe_components
-- .ingredient_id), which never touches finished_goods_batch_consumptions and
-- instead appends a stock_movements row (reference_type='sale',
-- movement_type='sale_out'). daily-profit-summary-service.ts builds its
-- shift-level total_cogs by summing each sale's already-correct frozen COGS
-- (via saleProfitService -> saleCogsService, which already accounts for
-- both ledgers per sql/090) -- so the JS-built figure is correct, but this
-- verification RPC still only sees the finished-goods portion. For any shift
-- with at least one such sale, the JS total and this RPC's recomputation
-- diverge, and the RPC rejects the save entirely -- generateForClosedShift
-- fails outright for that shift's daily profit summary, not just a display
-- mismatch.
--
-- Fix: sum both ledgers, exactly mirroring confirm_sale's own two branches
-- (sql/089) and verify_sale_cost_and_profit's own fix (sql/090) -- same
-- filters, same quantity * unit_cost, scoped to the shift's opened_at/
-- closed_at window instead of one sale. Also adds the same
-- fgbc.reason = 'sale' filter sql/077/090 carry (sql/066 predates that
-- fix by one day and never picked it up -- not a live bug today, since
-- confirm_sale is the only writer and always hardcodes 'sale', but this
-- keeps the SQL an exact mirror of the TS filter instead of a coincidental
-- match). Everything else in this function (revenue, profit, margin,
-- shift lookup/status guard, return shape, grants) is carried forward
-- from sql/066 unchanged.
--
-- Additive only:
--   function: verify_daily_profit_summary(...) -> boolean (CREATE OR
--   REPLACE, same signature as sql/066)
--
-- Does NOT:
--   - change shifts / sales / sale_lines / finished_goods_batch_consumptions
--     / stock_movements schema
--   - write anything (verification only)
--   - change daily-profit-summary-service.ts, confirm_sale, or any other
--     sql/089/090 function

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
  v_finished_goods_cogs numeric;
  v_ingredient_cogs numeric;
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

  SELECT COALESCE(SUM(fgbc.total_cost), 0)
  INTO v_finished_goods_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  JOIN sales s ON s.id = sl.sale_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND fgbc.reason = 'sale'
    AND s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  SELECT COALESCE(SUM(sm.quantity * sm.unit_cost), 0)
  INTO v_ingredient_cogs
  FROM stock_movements sm
  JOIN sale_lines sl ON sl.id = sm.reference_id
  JOIN sales s ON s.id = sl.sale_id
  WHERE sm.reference_type = 'sale'
    AND sm.movement_type = 'sale_out'
    AND s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at >= v_shift.opened_at
    AND s.confirmed_at <= v_shift.closed_at;

  v_total_cogs := round(v_finished_goods_cogs + v_ingredient_cogs, 2);

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

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076, carried forward by sql/077).
REVOKE ALL ON FUNCTION verify_daily_profit_summary(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_daily_profit_summary(uuid, numeric, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION verify_daily_profit_summary(uuid, numeric, numeric, numeric, numeric) TO authenticated;
