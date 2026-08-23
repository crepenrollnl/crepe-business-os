-- Receive: increment current_stock and recompute ingredients.cost_per_unit
-- as a moving weighted average of stock-on-hand + this receipt (not full
-- purchase history).
--
-- Run in Supabase SQL editor after sql/001_create_purchases.sql
-- (and after sql/098_role_guard_purchases_production.sql on databases
-- that use require_role).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Does NOT:
--   - change increment_ingredient_stock (still used by inventory
--     stock-mutation-service and must stay qty-only)
--   - backfill existing ingredients.cost_per_unit
--   - revalue already-created production batches
--
-- Formula (RHS of UPDATE reads the pre-update row — one statement, no
-- JS read-then-write race on the same ingredient):
--
--   new_cost = (GREATEST(COALESCE(current_stock, 0), 0) * COALESCE(cost_per_unit, 0)
--               + qty * net_unit_cost)
--              / (GREATEST(COALESCE(current_stock, 0), 0) + qty)
--
-- Guards:
--   - negative / NULL current_stock → 0 in the average only
--     (GREATEST); the stock column still receives +qty
--   - NULL / <= 0 net_unit_cost → stock still increases, cost_per_unit
--     is left unchanged, warning returned in jsonb (do not fail)
--
-- reverse_receive_purchase_line_stock_and_cost restores the snapshot
-- returned by the forward function. Needed because increment_ingredient_stock
-- rejects quantity <= 0 (sql/001 and sql/098), so the old JS -qty
-- compensation cannot unwind a receive, and would not restore cost anyway.

-- ---------------------------------------------------------------------------
-- 1. Forward: stock + weighted-average cost
-- ---------------------------------------------------------------------------

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
  v_skip_cost boolean;
  v_warning text := NULL;
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

  v_skip_cost := p_net_unit_cost IS NULL OR p_net_unit_cost <= 0;

  IF v_skip_cost THEN
    v_warning :=
      'Purchase line net unit cost is missing or not positive; stock increased without updating cost_per_unit.';
  END IF;

  UPDATE ingredients AS i
  SET
    current_stock = COALESCE(i.current_stock, 0) + p_quantity,
    cost_per_unit = CASE
      WHEN p_net_unit_cost IS NULL OR p_net_unit_cost <= 0 THEN i.cost_per_unit
      ELSE round(
        (
          GREATEST(COALESCE(i.current_stock, 0), 0) * COALESCE(i.cost_per_unit, 0)
          + p_quantity * p_net_unit_cost
        ) / (GREATEST(COALESCE(i.current_stock, 0), 0) + p_quantity),
        4
      )
    END
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
    'new_cost_per_unit', v_new_cost,
    'cost_updated', NOT v_skip_cost,
    'warning', v_warning
  );
END;
$$;

COMMENT ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) IS
  'Purchases Receive: add qty to ingredients.current_stock and set cost_per_unit to the moving weighted average of on-hand stock + this receipt. Skips the cost write when net unit cost is NULL or <= 0 and returns a warning.';

REVOKE ALL ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION receive_purchase_line_stock_and_cost(uuid, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Compensation: restore the snapshot from the forward RETURNING
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reverse_receive_purchase_line_stock_and_cost(
  p_ingredient_id uuid,
  p_previous_stock numeric,
  p_previous_cost_per_unit numeric
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient id is required';
  END IF;

  UPDATE ingredients
  SET
    current_stock = p_previous_stock,
    cost_per_unit = p_previous_cost_per_unit
  WHERE id = p_ingredient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION reverse_receive_purchase_line_stock_and_cost(uuid, numeric, numeric) IS
  'Compensates receive_purchase_line_stock_and_cost by restoring the snapshot stock and cost_per_unit from the forward jsonb. Used when a later line in the same Receive fails.';

REVOKE ALL ON FUNCTION reverse_receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION reverse_receive_purchase_line_stock_and_cost(uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION reverse_receive_purchase_line_stock_and_cost(uuid, numeric, numeric) TO authenticated;
