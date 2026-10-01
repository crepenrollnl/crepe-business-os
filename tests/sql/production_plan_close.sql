-- SQL test: production plan close and cancel (sql/131).
-- Scenarios A-F and H. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including
-- sql/131_production_plan_close.sql, plus
-- tests/sql/bootstrap/prelude_auth.sql and
-- tests/sql/bootstrap/stub_owner_profile.sql (applied by
-- .github/workflows/sql-tests.yml job production-plan-close,
-- same prelude as sql-full-replay).
--
-- Runs as the table owner with JWT emulation (same pattern as
-- tests/sql/production_plan_readiness.sql). It does not SET ROLE.
-- Scenario A updates production_sessions.status directly. The plan is
-- closed by production_sessions_close_plan, which is the same status
-- change complete_production_session already performs. That function
-- also posts stock, batches, and the journal, so it is not called here.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/production_plan_close.sql

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_status text;
  v_stock numeric;
  v_stock_after numeric;
  v_count integer;
  v_count_after integer;
  v_purchase_status text;
  v_plan uuid;
  v_plan_completed uuid;
  v_plan_cancelled uuid;
  v_session uuid;
  v_ing uuid;
  v_supplier uuid;
  v_purchase uuid;
  v_open_status text;
BEGIN
  SELECT p.auth_user_id
  INTO v_actor
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles — cannot emulate require_role.';
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'auth.uid() emulation failed (got %, expected %).',
      auth.uid(), v_actor;
  END IF;

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION
      'get_my_role() after JWT emulation is % — require_role would fail first.',
      get_my_role();
  END IF;

  -- ------------------------------------------------------------------
  -- A. Session status → completed closes the plan
  -- ------------------------------------------------------------------
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_A_' || v_suffix, CURRENT_DATE, 'ready_to_produce')
  RETURNING id INTO v_plan_completed;

  INSERT INTO production_sessions (production_plan_id, status)
  VALUES (v_plan_completed, 'in_progress')
  RETURNING id INTO v_session;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
  WHERE id = v_session;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan_completed;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: plan status is %', v_status;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- ------------------------------------------------------------------
  -- B. Notes-only session update does not close the plan
  -- ------------------------------------------------------------------
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_B_' || v_suffix, CURRENT_DATE, 'ready_to_produce')
  RETURNING id INTO v_plan;

  INSERT INTO production_sessions (production_plan_id, status)
  VALUES (v_plan, 'in_progress')
  RETURNING id INTO v_session;

  UPDATE production_sessions
  SET notes = 'TEST_CLOSE_131 notes only'
  WHERE id = v_session;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT status INTO v_open_status FROM production_sessions WHERE id = v_session;
  IF v_status IS DISTINCT FROM 'ready_to_produce'
     OR v_open_status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: plan % session %', v_status, v_open_status;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- ------------------------------------------------------------------
  -- C. Start is refused once the plan is completed
  -- ------------------------------------------------------------------
  BEGIN
    PERFORM start_production_session(v_plan_completed);
    RAISE EXCEPTION 'SCENARIO C FAIL: start succeeded on a completed plan';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%not ready for execution%' THEN
        RAISE EXCEPTION 'SCENARIO C FAIL: unexpected message %', v_err;
      END IF;
  END;

  RAISE NOTICE 'SCENARIO C PASS';

  -- ------------------------------------------------------------------
  -- D. Cancel each open status. Stock, shopping rows, purchase stay.
  -- ------------------------------------------------------------------
  FOREACH v_open_status IN ARRAY ARRAY[
    'draft', 'planned', 'waiting_for_purchases', 'ready_to_produce'
  ]
  LOOP
    INSERT INTO ingredients (
      name, unit, current_stock, minimum_stock, cost_per_unit, active
    ) VALUES (
      'TEST_CLOSE_131_D_' || v_open_status || '_' || v_suffix,
      'kg', 4, 0, 1, true
    )
    RETURNING id INTO v_ing;

    INSERT INTO production_plans (name, planning_date, status)
    VALUES (
      'TEST_CLOSE_131_D_' || v_open_status || '_' || v_suffix,
      CURRENT_DATE,
      v_open_status
    )
    RETURNING id INTO v_plan;

    INSERT INTO production_plan_shopping_items (
      production_plan_id, ingredient_id, ingredient_name, quantity, unit
    ) VALUES (
      v_plan, v_ing, 'TEST_CLOSE_131_D_' || v_open_status, 1, 'kg'
    );

    INSERT INTO suppliers (code, name, is_active)
    VALUES (
      'TEST131D' || left(v_open_status, 1) || right(v_suffix, 12),
      'TEST_CLOSE_131_D_supplier_' || v_open_status || '_' || v_suffix,
      true
    )
    RETURNING id INTO v_supplier;

    INSERT INTO purchases (supplier_id, status, production_plan_id, notes)
    VALUES (v_supplier, 'draft', v_plan, 'TEST_CLOSE_131')
    RETURNING id INTO v_purchase;

    SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
    SELECT count(*) INTO v_count
    FROM production_plan_shopping_items
    WHERE production_plan_id = v_plan;

    PERFORM cancel_production_plan(v_plan);

    SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
    SELECT current_stock INTO v_stock_after FROM ingredients WHERE id = v_ing;
    SELECT count(*) INTO v_count_after
    FROM production_plan_shopping_items
    WHERE production_plan_id = v_plan;
    SELECT status INTO v_purchase_status FROM purchases WHERE id = v_purchase;

    IF v_status IS DISTINCT FROM 'cancelled' THEN
      RAISE EXCEPTION 'SCENARIO D FAIL: % status is %', v_open_status, v_status;
    END IF;
    IF v_stock_after IS DISTINCT FROM v_stock
       OR v_count_after IS DISTINCT FROM v_count
       OR v_purchase_status IS DISTINCT FROM 'draft'
       OR v_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION
        'SCENARIO D FAIL: % stock %→% shopping %→% purchase %',
        v_open_status, v_stock, v_stock_after, v_count, v_count_after,
        v_purchase_status;
    END IF;
  END LOOP;

  RAISE NOTICE 'SCENARIO D PASS';

  -- ------------------------------------------------------------------
  -- E. Cancel refuses started, completed, and already-cancelled plans
  -- ------------------------------------------------------------------
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_E_open_' || v_suffix, CURRENT_DATE, 'ready_to_produce')
  RETURNING id INTO v_plan;

  INSERT INTO production_sessions (production_plan_id, status)
  VALUES (v_plan, 'in_progress');

  BEGIN
    PERFORM cancel_production_plan(v_plan);
    RAISE EXCEPTION 'SCENARIO E FAIL: cancel succeeded with an open session';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM
        'Production has already started for this plan. It cannot be cancelled.' THEN
        RAISE EXCEPTION 'SCENARIO E FAIL: open-session message %', v_err;
      END IF;
  END;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: open plan status changed to %', v_status;
  END IF;

  BEGIN
    PERFORM cancel_production_plan(v_plan_completed);
    RAISE EXCEPTION 'SCENARIO E FAIL: cancel succeeded on a completed plan';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM 'This production plan is already completed.' THEN
        RAISE EXCEPTION 'SCENARIO E FAIL: completed message %', v_err;
      END IF;
  END;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_E_cancel_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan_cancelled;

  PERFORM cancel_production_plan(v_plan_cancelled);

  BEGIN
    PERFORM cancel_production_plan(v_plan_cancelled);
    RAISE EXCEPTION 'SCENARIO E FAIL: second cancel succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM 'This production plan is already cancelled.' THEN
        RAISE EXCEPTION 'SCENARIO E FAIL: cancelled message %', v_err;
      END IF;
  END;

  RAISE NOTICE 'SCENARIO E PASS';

  -- ------------------------------------------------------------------
  -- F. Readiness does not reopen a completed or cancelled plan
  -- ------------------------------------------------------------------
  PERFORM check_production_plan_readiness(v_plan_completed);
  SELECT status INTO v_status FROM production_plans WHERE id = v_plan_completed;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: completed plan became %', v_status;
  END IF;

  PERFORM check_production_plan_readiness(v_plan_cancelled);
  SELECT status INTO v_status FROM production_plans WHERE id = v_plan_cancelled;
  IF v_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: cancelled plan became %', v_status;
  END IF;

  RAISE NOTICE 'SCENARIO F PASS';

  -- ------------------------------------------------------------------
  -- H. Backfill skips a plan that still has an open session.
  --    Completing that session closes the plan via the trigger.
  -- ------------------------------------------------------------------
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_H_' || v_suffix, CURRENT_DATE, 'ready_to_produce')
  RETURNING id INTO v_plan;

  INSERT INTO production_sessions (production_plan_id, status, completed_at)
  VALUES (v_plan, 'completed', now());

  INSERT INTO production_sessions (production_plan_id, status)
  VALUES (v_plan, 'in_progress')
  RETURNING id INTO v_session;

  UPDATE production_plans AS p
  SET status = 'completed', updated_at = now()
  WHERE p.id = v_plan
    AND p.status NOT IN ('completed', 'cancelled')
    AND EXISTS (
      SELECT 1
      FROM production_sessions AS s
      WHERE s.production_plan_id = p.id
        AND s.status = 'completed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM production_sessions AS s
      WHERE s.production_plan_id = p.id
        AND s.status IN ('ready', 'in_progress')
    );

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: backfill changed status to %', v_status;
  END IF;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
  WHERE id = v_session;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: plan status is %', v_status;
  END IF;

  RAISE NOTICE 'SCENARIO H PASS';
  RAISE NOTICE 'production_plan_close.sql PASS';
END;
$test$;

ROLLBACK;
