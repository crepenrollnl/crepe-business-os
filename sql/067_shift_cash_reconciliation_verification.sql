-- Cash Reconciliation Server-Side Verification (V1 plan 1.2)
-- Run in Supabase SQL editor after sql/061_create_shift_cash_reconciliations.sql.
--
-- Problem: cash-reconciliation-service.ts computes expected_cash (opening +
-- cash_in - cash_out) and difference (counted - expected) in JS
-- (utils/cash-reconciliation.ts) and inserts directly into the append-only
-- shift_cash_reconciliations table. The table's own CHECK constraint
-- (shift_cash_reconciliations_difference_matches) already guarantees
-- difference = counted_cash - expected_cash for whatever expected_cash is
-- inserted, but nothing guarantees expected_cash itself was derived
-- correctly from the raw opening/cash_in/cash_out inputs (those raw inputs
-- are not persisted at all today). A JS arithmetic bug or stale client
-- could freeze a wrong historical reconciliation that can never be
-- corrected afterwards.
--
-- Fix: an independent SQL recomputation of the same formula, compared
-- against the JS-computed expected_cash / difference before insert.
--
-- Additive only:
--   function: verify_cash_reconciliation(...) -> boolean
--
-- Does NOT:
--   - change shift_cash_reconciliations schema
--   - perform the insert itself (verification only)
--   - change Sales / Shifts module logic

CREATE OR REPLACE FUNCTION verify_cash_reconciliation(
  p_opening_cash numeric,
  p_cash_in numeric,
  p_cash_out numeric,
  p_counted_cash numeric,
  p_expected_cash numeric,
  p_difference numeric
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_expected_cash numeric;
  v_difference numeric;
BEGIN
  v_expected_cash := round(
    COALESCE(p_opening_cash, 0) + COALESCE(p_cash_in, 0) - COALESCE(p_cash_out, 0),
    2
  );
  v_difference := round(p_counted_cash - v_expected_cash, 2);

  RETURN v_expected_cash = round(p_expected_cash, 2)
    AND v_difference = round(p_difference, 2);
END;
$$;

GRANT EXECUTE ON FUNCTION verify_cash_reconciliation(
  numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;
