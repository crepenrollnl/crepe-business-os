-- Reject purchase Receive when the line net unit cost is NULL or <= 0.
--
-- Run in Supabase SQL editor after sql/105_receive_purchase_line_stock_and_cost.sql.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Replaces receive_purchase_line_stock_and_cost only. The compensation
-- function reverse_receive_purchase_line_stock_and_cost is unchanged.
--
-- sql/105 skipped the cost_per_unit write, still incremented current_stock,
-- and returned a jsonb warning. That left stock inflated and unit cost
-- stale — a silent wrong number. This file RAISES before the UPDATE.
-- Free supplier samples are out of scope (separate future path).
--
-- Does NOT:
--   - change reverse_receive_purchase_line_stock_and_cost
--   - change increment_ingredient_stock
--   - change Save Draft (TS still allows unit_cost = 0 on drafts)
--   - backfill ingredients.cost_per_unit
--   - touch calculate_purchase_taxes

CREATE OR REPLACE FUNCTION receive_purchase_line_stock_and_cost(
  p_ingredient_id uuid,
  p_quantity numeric,
  p_net_unit_cost numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ingredient_name text;
  v_previous_stock numeric;
  v_previous_cost numeric;
  v_new_stock numeric;
  v_new_cost numeric;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient id is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Stock increase quantity must be greater than zero';
  END IF;

  SELECT i.name
  INTO v_ingredient_name
  FROM ingredients AS i
  WHERE i.id = p_ingredient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;

  IF p_net_unit_cost IS NULL OR p_net_unit_cost <= 0 THEN
    RAISE EXCEPTION
      'Cannot receive this purchase. This ingredient has no net unit cost (zero or missing): %. Enter a positive unit cost on the purchase line and try again.',
      v_ingredient_name;
  END IF;

  UPDATE ingredients AS i
  SET
    current_stock = COALESCE(i.current_stock, 0) + p_quantity,
    cost_per_unit = round(
      (
        GREATEST(COALESCE(i.current_stock, 0), 0) * COALESCE(i.cost_per_unit, 0)
        + p_quantity * p_net_unit_cost
      ) / (GREATEST(COALESCE(i.current_stock, 0), 0) + p_quantity),
      4
    )
  FROM ingredients AS snapshot
  WHERE i.id = p_ingredient_id
    AND snapshot.id = p_ingredient_id
  RETURNING
    snapshot.current_stock,
    snapshot.cost_per_unit,
    i.current_stock,
    i.cost_per_unit
  INTO
    v_previous_stock,
    v_previous_cost,
    v_new_stock,
    v_new_cost;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;

  RETURN jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'previous_stock', v_previous_stock,
    'previous_cost_per_unit', v_previous_cost,
    'new_stock', v_new_stock,
    'new_cost_per_unit', v_new_cost
  );
END;
$$;

COMMENT ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) IS
  'Purchases Receive: add qty to ingredients.current_stock and set cost_per_unit to the moving weighted average of on-hand stock + this receipt. Raises when net unit cost is NULL or <= 0; does not increment stock in that case.';

REVOKE ALL ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) TO authenticated;
