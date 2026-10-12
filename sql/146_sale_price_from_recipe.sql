-- sql/146 — audit D4: the sale price always comes from the product
-- (recipes.selling_price), never from the browser.
--
-- Owner's rule (12.10.2026): a seller never changes a dish price; any
-- deviation is a discount on the whole sale (apply_sale_header_discount,
-- already called inside create_and_confirm_sale).
--
-- Change: add_sale_line — the single place every sale line is created
-- (POS, Quick Sale, /sales/[id], and create_and_confirm_sale composes it):
--   * reads the product's selling_price;
--   * no selling_price set            -> refuses: '"<name>" has no selling price. Set it in Recipes.'
--   * a client price that differs     -> refuses: 'The price of "<name>" is now €X. Refresh the screen and try again.'
--   * p_unit_price may be NULL        -> the catalog price is used;
--   * the stored unit_price is ALWAYS selling_price.
-- Components have no selling_price, so they cannot be sold directly either.
-- Everything else in the function is unchanged, including the sql/145 role
-- line. Signature, SECURITY DEFINER, search_path and grants are unchanged
-- (CREATE OR REPLACE keeps grants).
--
-- Safety: before replacing, the live body must be exactly the one this file
-- was written against (sql/017 + the sql/145 line; compared without CR
-- characters) or already be the sql/146 version — otherwise nothing changes.

DO $pre146$
DECLARE
  v_src text;
BEGIN
  SELECT replace(p.prosrc, chr(13), '') INTO v_src
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.add_sale_line(uuid, uuid, numeric, numeric)');

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'sql/146 precheck: add_sale_line(uuid, uuid, numeric, numeric) not found';
  END IF;
  IF position('-- sql/146' IN v_src) = 0
     AND md5(v_src) <> '7188492a0e4d1289b66d194f5d589ded' THEN
    RAISE EXCEPTION 'sql/146 precheck: live add_sale_line differs from the reviewed version (md5 %) — stop and review', md5(v_src);
  END IF;
END;
$pre146$;

CREATE OR REPLACE FUNCTION public.add_sale_line(
  p_sale_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale sales%ROWTYPE;
  v_product_name text;
  v_selling_price numeric;
  v_line_total numeric(12, 2);
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');  -- sql/145
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  IF p_unit_price IS NOT NULL AND p_unit_price < 0 THEN
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

  -- sql/146: the price comes from the product, not from the caller.
  SELECT r.name, r.selling_price
  INTO v_product_name, v_selling_price
  FROM recipes r
  WHERE r.id = p_product_id
    AND r.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product was not found.';
  END IF;

  IF v_selling_price IS NULL THEN
    RAISE EXCEPTION '"%" has no selling price. Set it in Recipes.', v_product_name;
  END IF;

  IF p_unit_price IS NOT NULL AND p_unit_price <> v_selling_price THEN
    RAISE EXCEPTION 'The price of "%" is now €%. Refresh the screen and try again.',
      v_product_name, to_char(v_selling_price, 'FM999999990.00');
  END IF;

  v_line_total := round(p_quantity * v_selling_price, 2);

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
    v_selling_price,
    v_line_total
  );

  PERFORM recalculate_sale_commercial_totals(p_sale_id);

  RETURN build_sale_document(p_sale_id);
END;
$function$;

COMMENT ON COLUMN recipes.selling_price IS
  'List price of the product, VAT-inclusive (gross). Since sql/146 add_sale_line always stores this as sale_lines.unit_price and refuses a sale line when it is NULL or when the caller sends a different price. Deviations go through the sale header discount only.';
