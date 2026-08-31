-- Whole-sale discount (percent or fixed amount) for Quick Sale.
-- Run in Supabase SQL editor after sql/107 (create_and_confirm_sale +
-- kitchen views) and sql/094 (VAT-inclusive totals).
--
-- Header stores what the cashier typed. Money is allocated into
-- sale_lines.line_total (largest remainder) so
--   sales.total = SUM(sale_lines.line_total)
-- still holds and get_sales_by_product A1 stays valid.
-- unit_price stays the catalog (VAT-inclusive) list price.
--
-- Additive:
--   columns on sales
--   function: apply_sale_header_discount(uuid, text, numeric)
--   create_and_confirm_sale gains optional p_discount_type / p_discount_value
--   sale_details_view adds the three discount columns
--
-- Does NOT:
--   - change recalculate_sale_commercial_totals
--   - change get_sales_by_product
--   - add a discount reason
--   - touch POS UI

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS discount_type text;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS discount_value numeric(12, 2);

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12, 2);

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_discount_type_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_discount_type_check
  CHECK (discount_type IS NULL OR discount_type IN ('percent', 'amount'));

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_discount_value_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_discount_value_check
  CHECK (discount_value IS NULL OR discount_value >= 0);

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_discount_amount_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_discount_amount_check
  CHECK (discount_amount IS NULL OR discount_amount >= 0);

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_discount_triplet_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_discount_triplet_check
  CHECK (
    (
      discount_type IS NULL
      AND discount_value IS NULL
      AND discount_amount IS NULL
    )
    OR (
      discount_type IS NOT NULL
      AND discount_value IS NOT NULL
      AND discount_amount IS NOT NULL
    )
  );

COMMENT ON COLUMN sales.discount_type IS
  'Cashier discount kind: percent or amount. NULL means no header discount.';

COMMENT ON COLUMN sales.discount_value IS
  'Value as typed: 10 = 10% when type is percent, or €10.00 when type is amount.';

COMMENT ON COLUMN sales.discount_amount IS
  'Resolved VAT-inclusive discount actually removed from the sale (2 dp).';

-- ---------------------------------------------------------------------------
-- apply_sale_header_discount (internal — draft only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_sale_header_discount(
  p_sale_id uuid,
  p_discount_type text,
  p_discount_value numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_g numeric(12, 2);
  v_d numeric(12, 2);
  v_p numeric(12, 2);
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale is required.';
  END IF;

  SELECT status
  INTO v_status
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft sale can receive a header discount.';
  END IF;

  UPDATE sale_lines
  SET line_total = round(quantity * unit_price, 2)
  WHERE sale_id = p_sale_id;

  SELECT COALESCE(round(SUM(line_total), 2), 0)
  INTO v_g
  FROM sale_lines
  WHERE sale_id = p_sale_id;

  IF p_discount_type IS NULL AND p_discount_value IS NULL THEN
    UPDATE sales
    SET
      discount_type = NULL,
      discount_value = NULL,
      discount_amount = NULL
    WHERE id = p_sale_id;

    PERFORM recalculate_sale_commercial_totals(p_sale_id);
    RETURN;
  END IF;

  IF p_discount_type IS NULL OR p_discount_value IS NULL THEN
    RAISE EXCEPTION 'Discount type and value are required together.';
  END IF;

  IF p_discount_type NOT IN ('percent', 'amount') THEN
    RAISE EXCEPTION 'Discount type must be percent or amount.';
  END IF;

  IF p_discount_value < 0 THEN
    RAISE EXCEPTION 'Discount must not be negative.';
  END IF;

  IF p_discount_type = 'percent' THEN
    IF p_discount_value > 100 THEN
      RAISE EXCEPTION 'Percent discount cannot exceed 100.';
    END IF;
    v_d := round(v_g * p_discount_value / 100, 2);
  ELSE
    v_d := round(p_discount_value, 2);
    IF v_d > v_g THEN
      RAISE EXCEPTION 'Discount cannot exceed the sale total.';
    END IF;
  END IF;

  IF v_d = 0 OR v_g = 0 THEN
    UPDATE sales
    SET
      discount_type = NULL,
      discount_value = NULL,
      discount_amount = NULL
    WHERE id = p_sale_id;

    PERFORM recalculate_sale_commercial_totals(p_sale_id);
    RETURN;
  END IF;

  v_p := v_g - v_d;

  WITH catalog AS (
    SELECT
      sl.id,
      sl.line_total AS catalog_total,
      sl.line_total * (v_p / v_g) AS raw_payable
    FROM sale_lines sl
    WHERE sl.sale_id = p_sale_id
  ),
  ranked AS (
    SELECT
      id,
      trunc(raw_payable, 2) AS base,
      ROW_NUMBER() OVER (
        ORDER BY (raw_payable - trunc(raw_payable, 2)) DESC,
          catalog_total DESC,
          id
      ) AS rn
    FROM catalog
  ),
  sums AS (
    SELECT COALESCE(SUM(base), 0) AS base_sum FROM ranked
  ),
  allocated AS (
    SELECT
      r.id,
      r.base
        + CASE
          WHEN r.rn <= (round((v_p - s.base_sum) * 100, 0))::integer
          THEN 0.01
          ELSE 0
        END AS payable
    FROM ranked r
    CROSS JOIN sums s
  )
  UPDATE sale_lines sl
  SET line_total = a.payable
  FROM allocated a
  WHERE sl.id = a.id;

  UPDATE sales
  SET
    discount_type = p_discount_type,
    discount_value = round(p_discount_value, 2),
    discount_amount = v_d
  WHERE id = p_sale_id;

  PERFORM recalculate_sale_commercial_totals(p_sale_id);
END;
$$;

COMMENT ON FUNCTION apply_sale_header_discount(uuid, text, numeric) IS
  'Internal: resolve a draft sale header discount and allocate it into line_total (largest remainder) so sales.total = SUM(line_total). unit_price stays catalog.';

REVOKE ALL ON FUNCTION apply_sale_header_discount(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_sale_header_discount(uuid, text, numeric) FROM anon;

-- ---------------------------------------------------------------------------
-- create_and_confirm_sale — optional discount args at the end
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_and_confirm_sale(uuid, jsonb, text);

CREATE OR REPLACE FUNCTION create_and_confirm_sale(
  p_customer_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft jsonb;
  v_sale_id uuid;
  v_line jsonb;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  v_draft := create_draft_sale(p_customer_id, NULL, p_kitchen_note);
  v_sale_id := (v_draft ->> 'sale_id')::uuid;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM add_sale_line(
      v_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric
    );
  END LOOP;

  IF p_discount_type IS NOT NULL OR p_discount_value IS NOT NULL THEN
    PERFORM apply_sale_header_discount(
      v_sale_id,
      p_discount_type,
      p_discount_value
    );
  END IF;

  RETURN confirm_sale(v_sale_id);
END;
$$;

COMMENT ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric) IS
  'One-tap sale: create draft, add lines, optional header discount (allocated into line_total), then confirm. Optional p_kitchen_note is sales.kitchen_note only. Reuses create_draft_sale + add_sale_line + apply_sale_header_discount + confirm_sale.';

REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- sale_details_view — add discount columns (sql/107 shape + discount)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sale_details_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  sl.id AS line_id,
  sl.product_id,
  sl.quantity,
  sl.unit_price,
  sl.line_total,
  s.fulfilled_at,
  s.is_paid,
  s.kitchen_note,
  s.discount_type,
  s.discount_value,
  s.discount_amount
FROM sales s
LEFT JOIN sale_lines sl
  ON sl.sale_id = s.id;

COMMENT ON VIEW sale_details_view IS
  'Read-only Sale details. Header + lines per row, including optional header discount. No FIFO, ledger, or COGS.';

GRANT SELECT ON sale_details_view TO authenticated;
ALTER VIEW sale_details_view SET (security_invoker = true);
