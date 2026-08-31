-- SQL test: apply_sale_header_discount (sql/110) + A1 identity
-- after a header discount (sql/109 get_sales_by_product).
-- Not a migration. Always ends in ROLLBACK.
-- Do not run against crepe-business-V1.
--
-- Bootstrap: tests/sql/bootstrap/complete_production_session.list
-- then sql/094, sql/104, sql/107, sql/110 (CI applies those before this file).
-- sql/109 is already applied by the get_sales_by_product step.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/sale_header_discount.sql

BEGIN;

DO $test$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_sku_a uuid := gen_random_uuid();
  v_sku_b uuid := gen_random_uuid();
  v_sale uuid := gen_random_uuid();
  v_line_a uuid := gen_random_uuid();
  v_line_b uuid := gen_random_uuid();
  v_sum_lines numeric;
  v_total numeric;
  v_subtotal numeric;
  v_a1 numeric;
  v_lt_a numeric;
  v_lt_b numeric;
  v_rev_sum numeric;
  v_from timestamptz := '2026-08-30 09:00:00+00';
  v_to timestamptz := '2026-08-30 12:00:00+00';
BEGIN
  INSERT INTO recipes (id, name, yield_quantity, yield_unit)
  VALUES
    (v_sku_a, 'Disc A ' || v_suffix, 1, 'pcs'),
    (v_sku_b, 'Disc B ' || v_suffix, 1, 'pcs');

  -- Catalog gross 10.90 + 5.45 = 16.35. Amount discount 1.00 does not
  -- divide evenly (largest remainder).
  INSERT INTO sales (
    id, sale_number, status, subtotal, tax_total, total
  )
  VALUES (
    v_sale,
    'T-D-' || v_suffix,
    'draft',
    0,
    0,
    0
  );

  INSERT INTO sale_lines (
    id, sale_id, product_id, quantity, unit_price, line_total
  )
  VALUES
    (v_line_a, v_sale, v_sku_a, 1, 10.90, 10.90),
    (v_line_b, v_sale, v_sku_b, 1, 5.45, 5.45);

  PERFORM apply_sale_header_discount(v_sale, 'amount', 1.00);

  SELECT
    COALESCE(SUM(line_total), 0),
    (SELECT total FROM sales WHERE id = v_sale),
    (SELECT subtotal FROM sales WHERE id = v_sale)
  INTO v_sum_lines, v_total, v_subtotal
  FROM sale_lines
  WHERE sale_id = v_sale;

  IF v_sum_lines IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'invariant: SUM(line_total) % <> total %', v_sum_lines, v_total;
  END IF;

  IF v_total IS DISTINCT FROM 15.35 THEN
    RAISE EXCEPTION 'payable total: expected 15.35, got %', v_total;
  END IF;

  SELECT line_total INTO v_lt_a FROM sale_lines WHERE id = v_line_a;
  SELECT line_total INTO v_lt_b FROM sale_lines WHERE id = v_line_b;

  -- 10.90 * 15.35 / 16.35 = 10.2339… → 10.23
  -- 5.45  * 15.35 / 16.35 = 5.1160…  → 5.11 + leftover cent → 5.12
  IF v_lt_a IS DISTINCT FROM 10.23 OR v_lt_b IS DISTINCT FROM 5.12 THEN
    RAISE EXCEPTION 'largest remainder: expected 10.23 + 5.12, got % + %',
      v_lt_a, v_lt_b;
  END IF;

  IF v_lt_a + v_lt_b IS DISTINCT FROM 15.35 THEN
    RAISE EXCEPTION 'allocated lines must sum to payable, got %', v_lt_a + v_lt_b;
  END IF;

  SELECT COALESCE(SUM(sl.line_total * (s.subtotal / s.total)), 0)
  INTO v_a1
  FROM sale_lines sl
  JOIN sales s ON s.id = sl.sale_id
  WHERE s.id = v_sale;

  IF round(v_a1, 2) IS DISTINCT FROM v_subtotal THEN
    RAISE EXCEPTION 'A1 raw: expected subtotal %, got %', v_subtotal, round(v_a1, 2);
  END IF;

  IF (SELECT discount_type FROM sales WHERE id = v_sale) IS DISTINCT FROM 'amount'
    OR (SELECT discount_value FROM sales WHERE id = v_sale) IS DISTINCT FROM 1.00
    OR (SELECT discount_amount FROM sales WHERE id = v_sale) IS DISTINCT FROM 1.00
  THEN
    RAISE EXCEPTION 'header discount fields were not stored.';
  END IF;

  UPDATE sales
  SET
    status = 'confirmed',
    confirmed_at = '2026-08-30 10:00:00+00'
  WHERE id = v_sale;

  SELECT COALESCE(SUM(revenue), 0)
  INTO v_rev_sum
  FROM get_sales_by_product(v_from, v_to)
  WHERE product_id IN (v_sku_a, v_sku_b);

  IF v_rev_sum IS DISTINCT FROM v_subtotal THEN
    RAISE EXCEPTION
      'get_sales_by_product: expected revenue % (= subtotal), got %',
      v_subtotal, v_rev_sum;
  END IF;
END;
$test$;

ROLLBACK;
