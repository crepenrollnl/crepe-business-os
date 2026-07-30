-- Purchase Totals Calculation (V1 plan 1.5)
-- Run in Supabase SQL editor.
--
-- Problem: purchase-service.ts computed line_total / subtotal / tax_total /
-- total in TypeScript (buildTotals()) before any insert, with no server-side
-- calculation or check. A JS rounding bug or stale client build could send a
-- purchase total that disagrees with what is shown to the user and later
-- posted to Accounting.
--
-- Fix: full server-side computation, mirroring the pattern already used by
-- Sales (recalculate_sale_commercial_totals in sql/017_sale_line_management.sql)
-- of keeping commercial-total arithmetic in SQL rather than JS. Unlike Sales,
-- Purchases builds subtotal/tax_total/total BEFORE any row is persisted
-- (single header insert, then a separate items insert), so there is nothing
-- already stored to recompute from — this RPC instead takes the raw line
-- inputs directly and returns the calculated totals for the service to
-- persist as-is.
--
-- Additive only:
--   function: calculate_purchase_totals(p_lines jsonb, p_tax_total numeric) -> jsonb
--
-- Does NOT:
--   - touch purchases / purchase_items tables (calculation only, no writes)
--   - change any other Purchases logic

CREATE OR REPLACE FUNCTION calculate_purchase_totals(
  p_lines jsonb,
  p_tax_total numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_discount numeric;
  v_line_total numeric;
  v_prepared_lines jsonb := '[]'::jsonb;
  v_subtotal numeric := 0;
  v_tax_total numeric;
  v_total numeric;
BEGIN
  IF p_lines IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0
  THEN
    RAISE EXCEPTION 'At least one purchase line is required.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_ingredient_id := (v_line ->> 'ingredient_id')::uuid;
      v_quantity := (v_line ->> 'quantity')::numeric;
      v_unit_cost := (v_line ->> 'unit_cost')::numeric;
      v_discount := COALESCE((v_line ->> 'discount')::numeric, 0);
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more purchase lines are invalid.';
    END;

    IF v_ingredient_id IS NULL
       OR v_quantity IS NULL OR v_quantity <= 0
       OR v_unit_cost IS NULL OR v_unit_cost < 0
    THEN
      RAISE EXCEPTION 'One or more purchase lines are invalid.';
    END IF;

    -- Mirrors calculateMoneyLineTotal (round qty*unit_cost, then subtract
    -- discount and round again) from src/lib/money.ts.
    v_line_total := round(round(v_quantity * v_unit_cost, 2) - v_discount, 2);
    v_subtotal := v_subtotal + v_line_total;

    v_prepared_lines := v_prepared_lines || jsonb_build_object(
      'ingredient_id', v_ingredient_id,
      'quantity', v_quantity,
      'unit_cost', v_unit_cost,
      'line_total', v_line_total
    );
  END LOOP;

  v_subtotal := round(v_subtotal, 2);
  v_tax_total := round(COALESCE(p_tax_total, 0), 2);
  v_total := round(v_subtotal + v_tax_total, 2);

  RETURN jsonb_build_object(
    'lines', v_prepared_lines,
    'subtotal', v_subtotal,
    'tax_total', v_tax_total,
    'total', v_total
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_purchase_totals(jsonb, numeric) TO authenticated;
