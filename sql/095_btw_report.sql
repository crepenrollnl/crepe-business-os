-- BTW Report (V1 — quarterly NL VAT declaration).
-- Run in Supabase SQL editor after sql/094.
--
-- Read-only quarterly aggregate matching the official Dutch BTW aangifte
-- structure (rubrieken 1a/1b/5a/5b/5c), sourced from posted journal_lines
-- (never recalculated from sales/purchases directly) -- entry_date drives
-- the period filter, status = 'posted' only (drafts/reversals excluded).
--
-- Scope agreed with the business owner: entire assortment (food +
-- non-alcoholic beverages) taxed at 9% (rubriek 1b); alcohol not sold or
-- planned, so rubriek 1a (21%) is always 0 but kept in the shape for
-- future extensibility. No history/archive -- always a live recompute for
-- the requested quarter, never persisted.
--
-- Does NOT:
--   - change accounts / journal_entries / journal_lines schema
--   - write anything (read-only)
--   - handle EU/export/reverse-charge rubrieken (not applicable to this
--     business: domestic-only food truck)

CREATE OR REPLACE FUNCTION get_btw_report(
  p_year integer,
  p_quarter integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start date;
  v_end date;
  v_rubriek_1a_revenue numeric(12, 2) := 0;
  v_rubriek_1a_vat numeric(12, 2) := 0;
  v_rubriek_1b_revenue numeric(12, 2);
  v_rubriek_1b_vat numeric(12, 2);
  v_rubriek_5a numeric(12, 2);
  v_rubriek_5b numeric(12, 2);
  v_rubriek_5c numeric(12, 2);
BEGIN
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'Year must be a valid year.';
  END IF;
  IF p_quarter IS NULL OR p_quarter NOT IN (1, 2, 3, 4) THEN
    RAISE EXCEPTION 'Quarter must be 1, 2, 3, or 4.';
  END IF;

  v_start := make_date(p_year, (p_quarter - 1) * 3 + 1, 1);
  v_end := (v_start + interval '3 months' - interval '1 day')::date;

  -- Rubriek 1b: 9% sales revenue + output VAT, from posted journal_lines
  -- on Sales Revenue (4000) and VAT Output (2100) accounts.
  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_revenue
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '4000'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  SELECT COALESCE(SUM(jl.credit_transaction - jl.debit_transaction), 0)
  INTO v_rubriek_1b_vat
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '2100'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  -- Rubriek 5b: deductible input VAT, from posted journal_lines on
  -- VAT Input (1200). Input VAT is a debit-normal asset account, so the
  -- deductible amount is debit minus credit (mirrors 1b's credit-minus-debit
  -- for the liability-normal VAT Output account).
  SELECT COALESCE(SUM(jl.debit_transaction - jl.credit_transaction), 0)
  INTO v_rubriek_5b
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.journal_entry_id
  JOIN accounts a ON a.id = jl.account_id
  WHERE a.code = '1200'
    AND je.status = 'posted'
    AND je.entry_date >= v_start
    AND je.entry_date <= v_end;

  v_rubriek_5a := round(v_rubriek_1a_vat + v_rubriek_1b_vat, 2);
  v_rubriek_5c := round(v_rubriek_5a - v_rubriek_5b, 2);

  RETURN jsonb_build_object(
    'year', p_year,
    'quarter', p_quarter,
    'period_start', v_start,
    'period_end', v_end,
    'rubriek_1a_revenue', v_rubriek_1a_revenue,
    'rubriek_1a_vat', v_rubriek_1a_vat,
    'rubriek_1b_revenue', round(v_rubriek_1b_revenue, 2),
    'rubriek_1b_vat', round(v_rubriek_1b_vat, 2),
    'rubriek_5a_total_vat_due', v_rubriek_5a,
    'rubriek_5b_input_vat_deductible', round(v_rubriek_5b, 2),
    'rubriek_5c_balance', v_rubriek_5c,
    'balance_direction', CASE
      WHEN v_rubriek_5c > 0 THEN 'to_pay'
      WHEN v_rubriek_5c < 0 THEN 'to_receive'
      ELSE 'zero'
    END
  );
END;
$$;

COMMENT ON FUNCTION get_btw_report(integer, integer) IS
  'Quarterly NL BTW declaration aggregate (rubrieken 1a/1b/5a/5b/5c) from posted journal_lines. Read-only, always a live recompute, no persisted history.';

REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_btw_report(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION get_btw_report(integer, integer) TO authenticated;
