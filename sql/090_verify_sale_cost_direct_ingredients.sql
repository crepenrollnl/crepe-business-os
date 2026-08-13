-- Verify Sale Cost & Profit -- account for direct raw-ingredient consumption
-- Run in Supabase SQL editor after sql/089_recipe_components_ingredients.sql.
--
-- Problem: verify_sale_cost_and_profit (sql/077) independently recomputes a
-- completed sale's COGS by summing finished_goods_batch_consumptions only.
-- sql/089 added a second, equally legitimate way confirm_sale accrues COGS
-- for an assembly line -- a direct raw-ingredient decrement (recipe_components
-- .ingredient_id), which never touches finished_goods_batch_consumptions and
-- instead appends a stock_movements row (reference_type='sale',
-- movement_type='sale_out'). For any sale whose COGS includes that
-- ingredient portion, this RPC's own recomputation systematically
-- undercounts it -- the verification would (once the client-side read is
-- also fixed to see the full total_cogs) start failing for every such sale,
-- not because the figure is wrong, but because the *check* itself has the
-- same blind spot the display bug had.
--
-- Fix: sum both ledgers, exactly mirroring confirm_sale's own two branches
-- (sql/089) -- same filters, same quantity * unit_cost. Everything else in
-- this function (revenue, profit, margin, return shape, grants) is carried
-- forward from sql/077 unchanged.
--
-- Additive only:
--   function: verify_sale_cost_and_profit(...) -> boolean (CREATE OR REPLACE,
--   same signature as sql/077)
--
-- Does NOT:
--   - change sales / sale_lines / finished_goods_batch_consumptions /
--     stock_movements schema
--   - write anything (verification only)
--   - change confirm_sale or any other sql/089 function

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
  v_finished_goods_cogs numeric;
  v_ingredient_cogs numeric;
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

  -- Component-recipe_id part of an assembly (or a directly-sold component):
  -- FIFO-allocated finished goods, same source as sql/077.
  SELECT COALESCE(SUM(fgbc.total_cost), 0)
  INTO v_finished_goods_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND fgbc.reason = 'sale'
    AND sl.sale_id = p_sale_id;

  -- ingredient_id part of an assembly (sql/089): direct raw-ingredient
  -- decrement via decrement_ingredient_stock, recorded as a stock_movements
  -- row instead of a finished_goods_batch_consumptions row. Mirrors
  -- confirm_sale's own ingredient branch exactly -- same filter, same
  -- quantity * unit_cost.
  SELECT COALESCE(SUM(sm.quantity * sm.unit_cost), 0)
  INTO v_ingredient_cogs
  FROM stock_movements sm
  JOIN sale_lines sl ON sl.id = sm.reference_id
  WHERE sm.reference_type = 'sale'
    AND sm.movement_type = 'sale_out'
    AND sl.sale_id = p_sale_id;

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
REVOKE ALL ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric) TO authenticated;
