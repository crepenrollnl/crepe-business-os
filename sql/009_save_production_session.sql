-- Save Production Session Progress (DEV-019)
-- Run in Supabase SQL editor after 006_create_production_sessions.sql
-- (and 007 / 008 if already applied).
--
-- Atomically updates Production Session notes + all provided session lines
-- in one database transaction. Does NOT mutate inventory, create batches,
-- or complete the session.

CREATE OR REPLACE FUNCTION save_production_session(
  p_session_id uuid,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_line jsonb;
  v_line_id uuid;
  v_actual numeric;
  v_actual_raw text;
  v_updated integer;
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Production session id is required.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Production session lines are required.';
  END IF;

  SELECT *
  INTO v_session
  FROM production_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;

  IF v_session.status IN ('completed', 'cancelled')
     OR v_session.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;

  UPDATE production_sessions
  SET
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id
    AND status = 'in_progress';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := (v_line ->> 'line_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more session lines are invalid.';
    END;

    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;

    v_actual_raw := v_line ->> 'actual_produced_quantity';

    IF v_actual_raw IS NULL OR btrim(v_actual_raw) = '' THEN
      v_actual := NULL;
    ELSE
      BEGIN
        v_actual := v_actual_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid produced quantity.';
      END;

      IF v_actual < 0 THEN
        RAISE EXCEPTION 'Produced quantity cannot be negative.';
      END IF;
    END IF;

    UPDATE production_session_lines
    SET
      actual_produced_quantity = v_actual,
      updated_at = v_now
    WHERE id = v_line_id
      AND production_session_id = p_session_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', p_session_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION save_production_session(uuid, text, jsonb) TO authenticated;
