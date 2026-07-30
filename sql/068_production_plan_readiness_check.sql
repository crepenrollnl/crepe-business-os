-- Production Plan Readiness Check (V1 plan 1.4)
-- Run in Supabase SQL editor after sql/004_create_production_plans.sql.
--
-- Problem: production-service.ts decided whether a plan is ready_to_produce
-- by loading production_plan_ingredients (as already fetched by the caller)
-- and current ingredient stock in two separate JS-side round trips, then
-- issuing a separate UPDATE. Nothing tied the "is it sufficient" read to the
-- status write, so two concurrent viewers of the same plan (or a stock
-- change landing between the reads and the write) could see/produce a wrong
-- ready_to_produce status.
--
-- Fix: a single RPC that re-reads requirements and current stock live from
-- the database and performs the status transition in the same statement
-- sequence, under a row lock on the plan. Only this function may transition
-- a plan into ready_to_produce.
--
-- Additive only:
--   function: check_production_plan_readiness(p_plan_id uuid) -> jsonb
--
-- Does NOT:
--   - change production_plans / production_plan_ingredients schema
--   - change any other plan status transition
--   - create UI, hooks, or other services

CREATE OR REPLACE FUNCTION check_production_plan_readiness(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_sufficient boolean;
  v_plan production_plans%ROWTYPE;
BEGIN
  SELECT status INTO v_status
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;

  -- Same eligibility guard as the previous JS check: only plans still in
  -- planned / waiting_for_purchases can transition to ready_to_produce.
  IF v_status IN ('planned', 'waiting_for_purchases') THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM production_plan_ingredients ppi
      JOIN ingredients i ON i.id = ppi.ingredient_id
      WHERE ppi.production_plan_id = p_plan_id
        AND i.current_stock + 1e-9 < ppi.required_quantity
    )
    INTO v_sufficient;

    IF v_sufficient THEN
      UPDATE production_plans
      SET status = 'ready_to_produce', updated_at = now()
      WHERE id = p_plan_id;
    END IF;
  END IF;

  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;

  RETURN to_jsonb(v_plan);
END;
$$;

GRANT EXECUTE ON FUNCTION check_production_plan_readiness(uuid) TO authenticated;
