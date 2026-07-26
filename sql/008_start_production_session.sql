-- Start Production Session (DEV-018)
-- Run in Supabase SQL editor after 006_create_production_sessions.sql
-- (and 007_complete_production.sql if already applied).
--
-- Atomically creates a Production Session header + all session lines
-- in one database transaction. Reuses an existing open session when present.
-- Does NOT mutate inventory, create batches, or change the Production Plan.

CREATE OR REPLACE FUNCTION start_production_session(
  p_production_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
  v_open_id uuid;
  v_session_id uuid;
  v_now timestamptz := now();
  v_product_count integer;
BEGIN
  IF p_production_plan_id IS NULL THEN
    RAISE EXCEPTION 'Production plan id is required.';
  END IF;

  SELECT *
  INTO v_plan
  FROM production_plans
  WHERE id = p_production_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan was not found.';
  END IF;

  IF v_plan.status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION
      'This production plan is not ready for execution. Only plans with status Ready for Production can start a session.';
  END IF;

  SELECT id
  INTO v_open_id
  FROM production_sessions
  WHERE production_plan_id = p_production_plan_id
    AND status IN ('ready', 'in_progress')
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_open_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_open_id,
      'reused', true
    );
  END IF;

  SELECT count(*)::integer
  INTO v_product_count
  FROM production_plan_products
  WHERE production_plan_id = p_production_plan_id;

  IF v_product_count = 0 THEN
    RAISE EXCEPTION
      'This production plan has no products. Add products before starting production.';
  END IF;

  BEGIN
    INSERT INTO production_sessions (
      production_plan_id,
      status,
      started_at,
      operator_name,
      notes,
      updated_at
    )
    VALUES (
      p_production_plan_id,
      'in_progress',
      v_now,
      NULL,
      NULL,
      v_now
    )
    RETURNING id INTO v_session_id;

    INSERT INTO production_session_lines (
      production_session_id,
      production_plan_product_id,
      recipe_id,
      product_name,
      planned_quantity,
      actual_produced_quantity,
      yield_unit,
      sort_order,
      updated_at
    )
    SELECT
      v_session_id,
      p.id,
      p.recipe_id,
      p.recipe_name,
      p.planned_quantity,
      NULL,
      p.yield_unit,
      p.sort_order,
      v_now
    FROM production_plan_products p
    WHERE p.production_plan_id = p_production_plan_id
    ORDER BY p.sort_order ASC, p.created_at ASC;
  EXCEPTION
    WHEN unique_violation THEN
      -- Concurrent start: open-session unique index won the race.
      SELECT id
      INTO v_open_id
      FROM production_sessions
      WHERE production_plan_id = p_production_plan_id
        AND status IN ('ready', 'in_progress')
      ORDER BY started_at DESC
      LIMIT 1;

      IF v_open_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'session_id', v_open_id,
          'reused', true
        );
      END IF;

      RAISE;
  END;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'reused', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION start_production_session(uuid) TO authenticated;
