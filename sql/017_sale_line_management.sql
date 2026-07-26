-- Sale Line Management (DEV-035)
-- Run in Supabase SQL editor after sql/013_create_sales.sql
-- and sql/016_create_draft_sale.sql (recommended).
--
-- Atomic draft-only line RPCs:
--   add_sale_line / update_sale_line / delete_sale_line
-- Each locks the sale, mutates lines, recalculates commercial totals in SQL,
-- and returns the updated sale document (header + lines).
--
-- Does NOT:
--   - allocate FIFO / call allocate_finished_goods_fifo
--   - mutate inventory, finished_goods, or production_batches
--   - confirm sales / calculate COGS
--   - create services, hooks, or UI
--
-- Product identity follows the Finished Goods convention:
--   product_id = recipes.id (= production_batches.finished_good_id).
-- Tax engine is not implemented; tax_total is always 0; total = subtotal.

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to authenticated)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_sale_commercial_totals(
  p_sale_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subtotal numeric(12, 2);
  v_now timestamptz := now();
BEGIN
  SELECT COALESCE(round(SUM(line_total), 2), 0)
  INTO v_subtotal
  FROM sale_lines
  WHERE sale_id = p_sale_id;

  UPDATE sales
  SET
    subtotal = v_subtotal,
    tax_total = 0,
    total = v_subtotal,
    updated_at = v_now
  WHERE id = p_sale_id;
END;
$$;

COMMENT ON FUNCTION recalculate_sale_commercial_totals(uuid) IS
  'Internal: recompute sales.subtotal/tax_total/total from sale_lines. tax_total is 0 until Accounting tax rules exist.';

CREATE OR REPLACE FUNCTION build_sale_document(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_lines jsonb;
BEGIN
  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'line_id', sl.id,
        'product_id', sl.product_id,
        'quantity', sl.quantity,
        'unit_price', sl.unit_price,
        'line_total', sl.line_total
      )
      ORDER BY sl.created_at ASC, sl.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM sale_lines sl
  WHERE sl.sale_id = p_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'status', v_sale.status,
    'sale_date', v_sale.sale_date,
    'customer_id', v_sale.customer_id,
    'subtotal', v_sale.subtotal,
    'tax_total', v_sale.tax_total,
    'total', v_sale.total,
    'notes', v_sale.notes,
    'confirmed_at', v_sale.confirmed_at,
    'paid_at', v_sale.paid_at,
    'cancelled_at', v_sale.cancelled_at,
    'lines', v_lines
  );
END;
$$;

COMMENT ON FUNCTION build_sale_document(uuid) IS
  'Internal: build sale header + lines JSON for draft line-management RPCs.';

-- ---------------------------------------------------------------------------
-- add_sale_line
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION add_sale_line(
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_product_exists boolean;
  v_line_total numeric(12, 2);
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater.';
  END IF;

  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be modified.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM recipes r
    WHERE r.id = p_product_id
      AND r.is_active = true
  )
  INTO v_product_exists;

  IF NOT v_product_exists THEN
    RAISE EXCEPTION 'Product was not found.';
  END IF;

  v_line_total := round(p_quantity * p_unit_price, 2);

  INSERT INTO sale_lines (
    sale_id,
    product_id,
    quantity,
    unit_price,
    line_total
  )
  VALUES (
    p_sale_id,
    p_product_id,
    p_quantity,
    p_unit_price,
    v_line_total
  );

  PERFORM recalculate_sale_commercial_totals(p_sale_id);

  RETURN build_sale_document(p_sale_id);
END;
$$;

COMMENT ON FUNCTION add_sale_line(uuid, uuid, numeric, numeric) IS
  'Add a line to a draft sale, recalculate commercial totals in SQL, return updated sale. No FIFO / inventory / COGS.';

GRANT EXECUTE ON FUNCTION add_sale_line(uuid, uuid, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_sale_line
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_sale_line(
  p_sale_line_id uuid,
  p_quantity numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line sale_lines%ROWTYPE;
  v_sale sales%ROWTYPE;
  v_sale_id uuid;
  v_line_total numeric(12, 2);
BEGIN
  IF p_sale_line_id IS NULL THEN
    RAISE EXCEPTION 'Sale line id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  SELECT sl.sale_id
  INTO v_sale_id
  FROM sale_lines sl
  WHERE sl.id = p_sale_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale line was not found.';
  END IF;

  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = v_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be modified.';
  END IF;

  SELECT *
  INTO v_line
  FROM sale_lines
  WHERE id = p_sale_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale line was not found.';
  END IF;

  v_line_total := round(p_quantity * v_line.unit_price, 2);

  UPDATE sale_lines
  SET
    quantity = p_quantity,
    line_total = v_line_total
  WHERE id = p_sale_line_id;

  PERFORM recalculate_sale_commercial_totals(v_sale_id);

  RETURN build_sale_document(v_sale_id);
END;
$$;

COMMENT ON FUNCTION update_sale_line(uuid, numeric) IS
  'Update quantity on a draft sale line, recalculate commercial totals in SQL, return updated sale. No FIFO / inventory / COGS.';

GRANT EXECUTE ON FUNCTION update_sale_line(uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- delete_sale_line
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_sale_line(
  p_sale_line_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line sale_lines%ROWTYPE;
  v_sale sales%ROWTYPE;
  v_sale_id uuid;
BEGIN
  IF p_sale_line_id IS NULL THEN
    RAISE EXCEPTION 'Sale line id is required.';
  END IF;

  SELECT sl.sale_id
  INTO v_sale_id
  FROM sale_lines sl
  WHERE sl.id = p_sale_line_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale line was not found.';
  END IF;

  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = v_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be modified.';
  END IF;

  SELECT *
  INTO v_line
  FROM sale_lines
  WHERE id = p_sale_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale line was not found.';
  END IF;

  DELETE FROM sale_lines
  WHERE id = p_sale_line_id;

  PERFORM recalculate_sale_commercial_totals(v_sale_id);

  RETURN build_sale_document(v_sale_id);
END;
$$;

COMMENT ON FUNCTION delete_sale_line(uuid) IS
  'Delete a draft sale line, recalculate commercial totals in SQL, return updated sale. No FIFO / inventory / COGS.';

GRANT EXECUTE ON FUNCTION delete_sale_line(uuid) TO authenticated;
