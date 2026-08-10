-- Sale Cost & Profit Verification (V1 plan 1.8)
-- Run in Supabase SQL editor after sql/066_shift_daily_profit_summary_verification.sql.
--
-- Problem: sale-cogs-builder.ts / sale-profit-builder.ts compute a completed
-- sale's frozen COGS (Σ finished_goods_batch_consumptions.total_cost for its
-- sale lines) and gross profit / margin (net_revenue − COGS) entirely in TS,
-- and the sale detail page (useSale hook) displays the result with no
-- independent server-side check. Unlike the closed V1 blockers this path
-- never writes to the immutable ledger — it is read-only display — but a
-- client bug or stale build could still show a wrong COGS/margin figure for
-- a business decision, with nothing catching it (docs/SALES.md: COGS comes
-- from Sale Batch Consumption records only).
--
-- Fix: reuse the same independent SQL recomputation already proven in
-- verify_daily_profit_summary (sql/066), scoped to one sale instead of a
-- shift window. The service calls this RPC after building the frozen COGS +
-- profit summaries and rejects the read on any mismatch — same
-- verify-before-write/show shape as sql/065-067 (V1 plan 1.2) and sql/076
-- (V1 plan 1.7).
--
-- Additive only:
--   function: verify_sale_cost_and_profit(...) -> boolean
--
-- Does NOT:
--   - change sales / sale_lines / finished_goods_batch_consumptions schema
--   - write anything (verification only)
--   - change Sales / Finished Goods module logic

CREATE OR REPLACE FUNCTION verify_sale_cost_and_profit(
  p_sale_id uuid,
  p_total_cogs numeric,
  p_net_revenue numeric,
  p_gross_profit numeric,
  p_gross_margin_percent numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_net_revenue numeric;
  v_total_cogs numeric;
  v_gross_profit numeric;
  v_gross_margin_percent numeric;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % was not found.', p_sale_id;
  END IF;

  IF v_sale.status NOT IN ('confirmed', 'paid') OR v_sale.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Only a completed sale (confirmed or paid) can have verified COGS and profit.';
  END IF;

  v_net_revenue := round(COALESCE(v_sale.subtotal, 0), 2);

  SELECT round(COALESCE(SUM(fgbc.total_cost), 0), 2)
  INTO v_total_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND fgbc.reason = 'sale'
    AND sl.sale_id = p_sale_id;

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
-- membership (see sql/074) — both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) TO authenticated;
