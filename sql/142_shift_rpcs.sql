-- Shift open / close / cash count on the server (audit S1, step 4a of 2).
-- Run in the Supabase SQL editor after sql/141_rls_recipes_owner_partner.sql.
-- Apply on both databases (dev + prod). Idempotent CREATE OR REPLACE.
-- No BEGIN/COMMIT here. Nothing is closed by this file.
--
-- Today the browser writes the four shift tables directly through open
-- policies (FOR ALL USING true, sql/060-063):
--   openShift            INSERT shifts
--   closeShift           UPDATE shifts, then in separate requests
--   generateForClosedShift  INSERT shift_daily_sales_summaries  (totals computed in the browser)
--   generateForClosedShift  INSERT shift_daily_profit_summaries (totals computed in the browser)
--   reconcileShiftCash   INSERT shift_cash_reconciliations     (amounts computed in the browser)
-- so any signed-in user can write any numbers into a shift summary, and a
-- network drop between the steps leaves a closed shift without summaries.
--
-- This file adds three SECURITY DEFINER RPCs that do the same on the server.
-- A later file (step 4b) closes direct writes on the four tables after the
-- app uses these RPCs.
--
--   open_shift(p_notes)
--   close_shift(p_shift_id, p_notes)
--       closes the shift AND writes both summaries in ONE transaction.
--       The totals use exactly the formulas of verify_daily_sales_summary
--       (sql/065) and verify_daily_profit_summary (sql/092), the checks the
--       browser already had to pass: sales confirmed/paid with confirmed_at
--       inside [opened_at, closed_at]; net = SUM(subtotal), gross =
--       SUM(total), items = SUM(sale_lines.quantity), average = gross/count;
--       COGS = FIFO consumptions (sale_line, out, sale) + ingredient
--       sale_out movements (quantity × unit_cost), rounded once.
--   reconcile_shift_cash(p_shift_id, p_counted_cash, p_opening_cash,
--                        p_cash_in, p_cash_out, p_notes)
--       expected = opening + cash_in − cash_out (same as
--       verify_cash_reconciliation, sql/067), difference = counted − expected.
--
-- Who: owner, partner or seller (sellers run the POS shift and count the
-- till). The user id comes from the login (auth.uid()), not the browser.
-- Error messages are the ones the app already shows.
--
-- Does NOT: change sales, stock, journals, confirm_sale (which still opens a
-- shift itself when none is open), or the verify_* functions.

CREATE OR REPLACE FUNCTION open_shift(p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shift shifts%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF EXISTS (SELECT 1 FROM shifts WHERE status = 'open') THEN
    RAISE EXCEPTION 'A shift is already open. Close it before opening another.';
  END IF;

  BEGIN
    INSERT INTO shifts (status, opened_at, closed_at, notes, opened_by)
    VALUES ('open', now(), NULL, NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid())
    RETURNING * INTO v_shift;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'A shift is already open. Close it before opening another.';
  END;

  RETURN jsonb_build_object(
    'id', v_shift.id,
    'opened_at', v_shift.opened_at,
    'closed_at', v_shift.closed_at,
    'status', v_shift.status,
    'notes', v_shift.notes,
    'created_at', v_shift.created_at
  );
END;
$function$;

COMMENT ON FUNCTION open_shift(text) IS
  'Open a new shift (only one may be open). Owner, partner or seller. opened_by = auth.uid().';

REVOKE ALL ON FUNCTION open_shift(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION open_shift(text) FROM anon;
GRANT EXECUTE ON FUNCTION open_shift(text) TO authenticated;

CREATE OR REPLACE FUNCTION close_shift(p_shift_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shift shifts%ROWTYPE;
  v_sales_count integer;
  v_items_sold numeric;
  v_gross_revenue numeric;
  v_net_revenue numeric;
  v_average_receipt numeric;
  v_fg_cogs numeric;
  v_ingredient_cogs numeric;
  v_total_cogs numeric;
  v_gross_profit numeric;
  v_margin numeric;
  v_sales_summary shift_daily_sales_summaries%ROWTYPE;
  v_profit_summary shift_daily_profit_summaries%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'Shift id is required.';
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift was not found.';
  END IF;

  IF v_shift.status = 'closed' THEN
    RAISE EXCEPTION 'This shift is already closed.';
  END IF;

  IF v_shift.status <> 'open' THEN
    RAISE EXCEPTION 'Only an open shift can be closed.';
  END IF;

  UPDATE shifts
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      notes = CASE
        WHEN p_notes IS NULL THEN notes
        ELSE NULLIF(btrim(p_notes), '')
      END
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  -- Daily sales summary — same formula as verify_daily_sales_summary (sql/065).
  SELECT
    COUNT(*)::integer,
    round(COALESCE(SUM(s.total), 0), 2),
    round(COALESCE(SUM(s.subtotal), 0), 2)
  INTO v_sales_count, v_gross_revenue, v_net_revenue
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

  INSERT INTO shift_daily_sales_summaries (
    shift_id, sales_count, items_sold, gross_revenue, net_revenue, average_receipt
  )
  VALUES (
    v_shift.id, v_sales_count, v_items_sold, v_gross_revenue, v_net_revenue, v_average_receipt
  )
  RETURNING * INTO v_sales_summary;

  -- Daily profit summary — same formula as verify_daily_profit_summary (sql/092).
  SELECT COALESCE(SUM(fgbc.total_cost), 0)
  INTO v_fg_cogs
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

  v_total_cogs := round(v_fg_cogs + v_ingredient_cogs, 2);
  v_gross_profit := round(v_net_revenue - v_total_cogs, 2);
  v_margin := CASE
    WHEN v_net_revenue = 0 THEN NULL
    ELSE round((v_gross_profit / v_net_revenue) * 100, 2)
  END;

  INSERT INTO shift_daily_profit_summaries (
    shift_id, net_revenue, total_cogs, gross_profit, gross_margin_percent
  )
  VALUES (
    v_shift.id, v_net_revenue, v_total_cogs, v_gross_profit, v_margin
  )
  RETURNING * INTO v_profit_summary;

  RETURN jsonb_build_object(
    'shift', jsonb_build_object(
      'id', v_shift.id,
      'opened_at', v_shift.opened_at,
      'closed_at', v_shift.closed_at,
      'status', v_shift.status,
      'notes', v_shift.notes,
      'created_at', v_shift.created_at
    ),
    'sales_summary', to_jsonb(v_sales_summary),
    'profit_summary', to_jsonb(v_profit_summary)
  );
END;
$function$;

COMMENT ON FUNCTION close_shift(uuid, text) IS
  'Close an open shift and write its daily sales and profit summaries in one transaction (formulas of verify_daily_sales_summary / verify_daily_profit_summary). p_notes NULL keeps the notes. Owner, partner or seller.';

REVOKE ALL ON FUNCTION close_shift(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION close_shift(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION close_shift(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION reconcile_shift_cash(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_opening_cash numeric DEFAULT 0,
  p_cash_in numeric DEFAULT 0,
  p_cash_out numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_shift shifts%ROWTYPE;
  v_counted numeric(12, 2);
  v_expected numeric(12, 2);
  v_row shift_cash_reconciliations%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF p_shift_id IS NULL THEN
    RAISE EXCEPTION 'Shift id is required.';
  END IF;

  IF p_counted_cash IS NULL THEN
    RAISE EXCEPTION 'Counted cash is required.';
  END IF;

  IF p_counted_cash < 0 THEN
    RAISE EXCEPTION 'Counted cash cannot be negative.';
  END IF;

  IF COALESCE(p_opening_cash, 0) < 0 OR COALESCE(p_cash_in, 0) < 0 OR COALESCE(p_cash_out, 0) < 0 THEN
    RAISE EXCEPTION 'Opening cash, cash in and cash out cannot be negative.';
  END IF;

  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift was not found.';
  END IF;

  IF v_shift.status = 'open' THEN
    RAISE EXCEPTION 'Close the shift before reconciling cash.';
  END IF;

  IF v_shift.status <> 'closed' THEN
    RAISE EXCEPTION 'Only a closed shift can be reconciled.';
  END IF;

  IF EXISTS (SELECT 1 FROM shift_cash_reconciliations WHERE shift_id = p_shift_id) THEN
    RAISE EXCEPTION 'This shift is already reconciled.';
  END IF;

  v_counted := round(p_counted_cash, 2);
  v_expected := round(
    COALESCE(p_opening_cash, 0) + COALESCE(p_cash_in, 0) - COALESCE(p_cash_out, 0),
    2
  );

  INSERT INTO shift_cash_reconciliations (
    shift_id, expected_cash, counted_cash, difference, notes, reconciled_by
  )
  VALUES (
    p_shift_id, v_expected, v_counted, v_counted - v_expected,
    NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'shift_id', v_row.shift_id,
    'expected_cash', v_row.expected_cash,
    'counted_cash', v_row.counted_cash,
    'difference', v_row.difference,
    'notes', v_row.notes,
    'reconciled_at', v_row.reconciled_at,
    'created_at', v_row.created_at
  );
END;
$function$;

COMMENT ON FUNCTION reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text) IS
  'Cash count for a closed shift (one per shift). expected = opening + cash_in - cash_out; difference = counted - expected. Owner, partner or seller.';

REVOKE ALL ON FUNCTION reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION reconcile_shift_cash(uuid, numeric, numeric, numeric, numeric, text) TO authenticated;
