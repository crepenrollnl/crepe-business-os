-- Confirm Production Plan (V1 critical finding, Фаза 4 — Production Execution deadlock)
-- Run in Supabase SQL editor after sql/068_production_plan_readiness_check.sql.
--
-- Problem: a Draft production plan has no way to reach the Production
-- Execution queue when every ingredient is already sufficiently stocked.
-- The only status-changing code path in the whole project is
-- sendPurchaseDraftToPurchases (draft/planned -> waiting_for_purchases),
-- and it refuses to run when there is nothing to purchase. The "planned"
-- status is declared in the schema/enum/filter and referenced by
-- check_production_plan_readiness (sql/068), but nothing anywhere ever
-- assigns it. production_plan_ingredients is documented in sql/004 as an
-- "Ingredient requirements snapshot at planning time (immutable after
-- create)" but is never written by any code path either — meaning
-- check_production_plan_readiness's sufficiency check
-- (NOT EXISTS ... WHERE stock < required) is vacuously true whenever a
-- plan reaches planned/waiting_for_purchases, since there are never any
-- rows to violate it. That is an already-live correctness gap on the
-- existing waiting_for_purchases path, not just a risk of new code.
--
-- Fix (Architecture decision: Вариант А): a single RPC that, under a lock
-- on the plan, recomputes ingredient requirements server-side (mirrors
-- src/features/production-planning/mappers/planning-mappers.ts
-- scaleRecipeIngredientNeed: required = recipe_items.quantity *
-- production_plan_products.planned_quantity / production_plan_products.
-- yield_quantity, rounded to 3 decimal places to match the numeric(12,3)
-- columns), writes the real snapshot into production_plan_ingredients for
-- the first time, moves the plan to 'planned', then immediately re-checks
-- sufficiency against the snapshot it just wrote and — if every ingredient
-- is covered — advances the same row straight to 'ready_to_produce' in the
-- same transaction. This also retroactively fixes the vacuous-truth gap in
-- check_production_plan_readiness: once this function has run at least
-- once for a plan, production_plan_ingredients holds real data for it.
--
-- Additive only:
--   function: confirm_production_plan(p_plan_id uuid) -> jsonb
--
-- Does NOT:
--   - change production_plans / production_plan_products /
--     production_plan_ingredients schema
--   - touch the waiting_for_purchases path (sendPurchaseDraftToPurchases
--     is unchanged and remains the only way out of a plan with real
--     shortages)
--   - get wired into any TS service/hook/UI yet (separate follow-up step)

CREATE OR REPLACE FUNCTION confirm_production_plan(
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
  v_product_count integer;
  v_sufficient boolean;
BEGIN
  -- 1. Lock the plan.
  SELECT * INTO v_plan
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;

  IF v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft production plan can be confirmed.';
  END IF;

  SELECT COUNT(*) INTO v_product_count
  FROM production_plan_products
  WHERE production_plan_id = p_plan_id;

  IF v_product_count = 0 THEN
    RAISE EXCEPTION 'Add at least one product before confirming the plan.';
  END IF;

  -- Same validation as the TS calculator (runDomainPlanCalculation): every
  -- product's recipe must have at least one recipe_items row, otherwise its
  -- ingredients would be silently omitted from the snapshot below.
  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    WHERE ppp.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1 FROM recipe_items ri WHERE ri.recipe_id = ppp.recipe_id
      )
  ) THEN
    RAISE EXCEPTION 'One or more recipes on this plan have no ingredients.';
  END IF;

  -- 2 + 3. Server-side requirement recompute (mirrors
  -- scaleRecipeIngredientNeed: quantity * planned_quantity / yield_quantity,
  -- aggregated per ingredient across all products on the plan) and snapshot
  -- into production_plan_ingredients — the real data this table was always
  -- meant to hold.
  INSERT INTO production_plan_ingredients (
    production_plan_id,
    ingredient_id,
    ingredient_name,
    unit,
    required_quantity,
    inventory_quantity_at_planning,
    missing_quantity
  )
  SELECT
    p_plan_id,
    req.ingredient_id,
    i.name,
    req.unit,
    req.required_quantity,
    i.current_stock,
    GREATEST(req.required_quantity - i.current_stock, 0)
  FROM (
    SELECT
      ri.ingredient_id,
      round(
        SUM(ri.quantity * ppp.planned_quantity / ppp.yield_quantity),
        3
      ) AS required_quantity,
      MIN(ri.unit) AS unit
    FROM production_plan_products ppp
    JOIN recipe_items ri ON ri.recipe_id = ppp.recipe_id
    WHERE ppp.production_plan_id = p_plan_id
    GROUP BY ri.ingredient_id
  ) req
  JOIN ingredients i ON i.id = req.ingredient_id;

  -- 4. Move to planned — the first and only place in the project that ever
  -- assigns this status.
  UPDATE production_plans
  SET status = 'planned', updated_at = now()
  WHERE id = p_plan_id;

  -- 5. Sufficiency check against the snapshot just written — same principle
  -- as check_production_plan_readiness (sql/068), but reading real rows for
  -- the first time instead of an always-empty table.
  SELECT NOT EXISTS (
    SELECT 1
    FROM production_plan_ingredients
    WHERE production_plan_id = p_plan_id
      AND missing_quantity > 0
  ) INTO v_sufficient;

  IF v_sufficient THEN
    UPDATE production_plans
    SET status = 'ready_to_produce', updated_at = now()
    WHERE id = p_plan_id;
  END IF;

  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;

  RETURN to_jsonb(v_plan);
END;
$$;

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) — both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_production_plan(uuid) TO authenticated;
