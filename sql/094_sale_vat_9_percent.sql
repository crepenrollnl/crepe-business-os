-- Fixed 9% NL VAT on sales (food + non-alcoholic beverages).
-- Run in Supabase SQL editor after sql/093.
--
-- Problem: recalculate_sale_commercial_totals (sql/017) hard-coded
-- tax_total = 0 and total = subtotal. The tax engine was never
-- implemented for Sales; VAT on sales has never been calculated.
--
-- Agreed scope (with the business owner before implementation):
-- the entire assortment (food + non-alcoholic drinks) is taxed at a
-- single 9% Netherlands rate; alcohol is not sold and is not planned.
-- The rate is therefore a fixed constant 0.09 -- not a copy of the
-- Purchases tax engine (calculate_purchase_taxes).
--
-- Prices in sale_lines.unit_price / line_total already include VAT
-- (what the customer sees and pays). SUM(line_total) is therefore
-- gross; it stays as sales.total. Net = round(gross / 1.09, 2);
-- tax_total = round(gross - net, 2) so net + tax_total = gross
-- with no leftover cent (same split as recordExpense).
--
-- CREATE OR REPLACE of the internal helper only. Same signature as
-- sql/017. add_sale_line / update_sale_line / delete_sale_line are
-- unchanged; they already call this helper.
--
-- Does NOT:
--   - change sale_lines / sales schema
--   - change GRANT / REVOKE (this function is internal SECURITY DEFINER
--     and is not granted to authenticated; callers keep their grants)
--   - backfill already-confirmed sales
--   - apply itself (operator runs this in SQL Editor)

CREATE OR REPLACE FUNCTION recalculate_sale_commercial_totals(
  p_sale_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gross numeric(12, 2);
  v_net numeric(12, 2);
  v_tax numeric(12, 2);
  v_now timestamptz := now();
  c_vat_rate constant numeric := 0.09;
BEGIN
  SELECT COALESCE(round(SUM(line_total), 2), 0)
  INTO v_gross
  FROM sale_lines
  WHERE sale_id = p_sale_id;

  v_net := round(v_gross / (1 + c_vat_rate), 2);
  v_tax := round(v_gross - v_net, 2);

  UPDATE sales
  SET
    subtotal = v_net,
    tax_total = v_tax,
    total = v_gross,
    updated_at = v_now
  WHERE id = p_sale_id;
END;
$$;

COMMENT ON FUNCTION recalculate_sale_commercial_totals(uuid) IS
  'Internal: recompute sales.subtotal (net excl. VAT)/tax_total/total (gross incl. VAT) from sale_lines. Fixed 9% NL VAT rate (food + non-alcoholic beverages only, sql/094) -- prices in sale_lines are VAT-inclusive, so total is unchanged and subtotal/tax_total are derived from it.';
