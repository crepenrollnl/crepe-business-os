-- SQL test: get_sales_by_product (sql/109).
-- Not a migration. Always ends in ROLLBACK.
-- Do not run against crepe-business-V1.
--
-- Bootstrap: tests/sql/bootstrap/complete_production_session.list
-- then sql/109_get_sales_by_product.sql (CI applies both before this file).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/get_sales_by_product.sql

BEGIN;

DO $test$
DECLARE
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_sku_a uuid := gen_random_uuid();
  v_sku_b uuid := gen_random_uuid();
  v_sale_1 uuid := gen_random_uuid();
  v_sale_2 uuid := gen_random_uuid();
  v_sale_split uuid := gen_random_uuid();
  v_line_1 uuid := gen_random_uuid();
  v_line_2 uuid := gen_random_uuid();
  v_line_a uuid := gen_random_uuid();
  v_line_b uuid := gen_random_uuid();
  v_from timestamptz := '2026-08-29 09:00:00+00';
  v_to timestamptz := '2026-08-29 14:00:00+00';
  v_cogs numeric;
  v_revenue numeric;
  v_qty numeric;
  v_profit numeric;
  v_margin numeric;
  v_rev_b numeric;
  v_sum_rev numeric;
BEGIN
  INSERT INTO recipes (id, name, yield_quantity, yield_unit)
  VALUES
    (v_sku_a, 'Sku A ' || v_suffix, 1, 'pcs'),
    (v_sku_b, 'Sku B ' || v_suffix, 1, 'pcs');

  -- Two confirmed sales of the same SKU: net 1.00 each, gross 1.09.
  INSERT INTO sales (
    id, sale_number, status, confirmed_at, subtotal, tax_total, total
  )
  VALUES
    (
      v_sale_1,
      'T-A-' || v_suffix,
      'confirmed',
      '2026-08-29 10:00:00+00',
      1.00,
      0.09,
      1.09
    ),
    (
      v_sale_2,
      'T-B-' || v_suffix,
      'confirmed',
      '2026-08-29 11:00:00+00',
      1.00,
      0.09,
      1.09
    );

  INSERT INTO sale_lines (
    id, sale_id, product_id, quantity, unit_price, line_total
  )
  VALUES
    (v_line_1, v_sale_1, v_sku_a, 1, 1.09, 1.09),
    (v_line_2, v_sale_2, v_sku_a, 1, 1.09, 1.09);

  -- Draft in the same window must not appear (sku B only exists as draft here).
  INSERT INTO sales (
    id, sale_number, status, confirmed_at, subtotal, tax_total, total
  )
  VALUES (
    gen_random_uuid(),
    'T-D-' || v_suffix,
    'draft',
    '2026-08-29 10:30:00+00',
    9.00,
    0.81,
    9.81
  );

  INSERT INTO sale_lines (
    sale_id, product_id, quantity, unit_price, line_total
  )
  SELECT id, v_sku_b, 1, 9.81, 9.81
  FROM sales
  WHERE sale_number = 'T-D-' || v_suffix;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    unit_cost,
    reference_type,
    reference_id
  )
  VALUES
    (v_sku_a, 'sale_out', 1, 1.004, 'sale', v_line_1),
    (v_sku_a, 'sale_out', 1, 1.004, 'sale', v_line_2);

  SELECT quantity, revenue, cogs, gross_profit, gross_margin_percent
  INTO v_qty, v_revenue, v_cogs, v_profit, v_margin
  FROM get_sales_by_product(v_from, v_to)
  WHERE product_id = v_sku_a;

  IF v_qty IS DISTINCT FROM 2.000 THEN
    RAISE EXCEPTION 'qty: expected 2.000, got %', v_qty;
  END IF;

  IF v_revenue IS DISTINCT FROM 2.00 THEN
    RAISE EXCEPTION 'A1 revenue: expected 2.00, got %', v_revenue;
  END IF;

  -- round(1.004 + 1.004, 2) = 2.01 — not 2.00 from round-per-sale.
  IF v_cogs IS DISTINCT FROM 2.01 THEN
    RAISE EXCEPTION 'cogs round-once: expected 2.01, got %', v_cogs;
  END IF;

  IF v_profit IS DISTINCT FROM -0.01 THEN
    RAISE EXCEPTION 'profit: expected -0.01, got %', v_profit;
  END IF;

  IF v_margin IS DISTINCT FROM -0.50 THEN
    RAISE EXCEPTION 'margin: expected -0.50, got %', v_margin;
  END IF;

  IF EXISTS (
    SELECT 1 FROM get_sales_by_product(v_from, v_to) WHERE product_id = v_sku_b
  ) THEN
    RAISE EXCEPTION 'draft sku B must not appear before the confirmed split sale';
  END IF;

  -- Split one sale across two SKUs: 5.45/5.45 of 10.90 gross, subtotal 10.00.
  INSERT INTO sales (
    id, sale_number, status, confirmed_at, subtotal, tax_total, total
  )
  VALUES (
    v_sale_split,
    'T-S-' || v_suffix,
    'confirmed',
    '2026-08-29 12:00:00+00',
    10.00,
    0.90,
    10.90
  );

  INSERT INTO sale_lines (
    id, sale_id, product_id, quantity, unit_price, line_total
  )
  VALUES
    (v_line_a, v_sale_split, v_sku_a, 1, 5.45, 5.45),
    (v_line_b, v_sale_split, v_sku_b, 1, 5.45, 5.45);

  SELECT revenue INTO v_rev_b
  FROM get_sales_by_product(v_from, v_to)
  WHERE product_id = v_sku_b;

  IF v_rev_b IS DISTINCT FROM 5.00 THEN
    RAISE EXCEPTION 'A1 split SKU B: expected 5.00, got %', v_rev_b;
  END IF;

  SELECT COALESCE(SUM(revenue), 0) INTO v_sum_rev
  FROM get_sales_by_product(v_from, v_to)
  WHERE product_id IN (v_sku_a, v_sku_b);

  -- 2.00 (two 1.00 sales of A) + 10.00 (split sale) = 12.00 = SUM(subtotal).
  IF v_sum_rev IS DISTINCT FROM 12.00 THEN
    RAISE EXCEPTION 'A1 window sum: expected 12.00, got %', v_sum_rev;
  END IF;

  -- Inverted window is empty (p_from > p_to).
  IF EXISTS (
    SELECT 1
    FROM get_sales_by_product(v_to, v_from)
    WHERE product_id IN (v_sku_a, v_sku_b)
  ) THEN
    RAISE EXCEPTION 'inverted window should be empty';
  END IF;
END;
$test$;

ROLLBACK;
