-- Close a production plan when its session completes, and allow cancel
-- before production starts (production-plan-never-closes).
-- Run in Supabase SQL editor after sql/130_production_plan_live_requirements.sql.
-- Apply on both databases (dev + prod):
--   Part 0 backfill preview (one read-only SELECT, run first)
--   Part 1 dry run (BEGIN...ROLLBACK)
--   Part 2 the real migration (BEGIN...COMMIT, includes the backfill)
--   Part 3 standalone catalog checks, fresh tab, no transaction
--
-- Does NOT edit complete_production_session. The close is an AFTER UPDATE
-- trigger on production_sessions.status, so that function's existing
-- status update closes the plan in the same transaction.
--
-- ============================================================================
-- PART 0 of 3 -- BACKFILL PREVIEW. One read-only SELECT. No BEGIN, no writes,
-- no new functions. Run this on dev and prod BEFORE Part 1.
-- has_open_session is true when the plan also has a ready or in_progress
-- session. Part 2 does not complete those plans. The open session stays
-- reachable. The trigger closes the plan when that session is completed.
-- ============================================================================

-- >>> BACKFILL PREVIEW START
SELECT DISTINCT ON (p.id)
  p.id AS plan_id,
  p.name,
  p.status,
  p.planning_date,
  s.id AS session_id,
  s.completed_at,
  EXISTS (
    SELECT 1
    FROM production_sessions o
    WHERE o.production_plan_id = p.id
      AND o.status IN ('ready', 'in_progress')
  ) AS has_open_session
FROM production_plans p
JOIN production_sessions s
  ON s.production_plan_id = p.id
 AND s.status = 'completed'
WHERE p.status NOT IN ('completed', 'cancelled')
ORDER BY p.id, s.completed_at DESC NULLS LAST;
-- <<< BACKFILL PREVIEW END

-- ============================================================================
-- PART 1 of 3 -- DRY RUN. Copy everything between "-- >>> DRY RUN START"
-- and "-- <<< DRY RUN END" into the Supabase SQL Editor and run it after
-- Part 0. Scenarios raise on failure. The transaction rolls back.
--
-- Scenario A updates production_sessions.status directly. It does not call
-- complete_production_session. That function posts stock, batches, and the
-- journal, and rejects a line with no unit cost. The plan is closed by the
-- trigger on the status change, which is the same UPDATE that function
-- already performs.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION close_plan_on_session_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'completed'
     AND NEW.status = 'completed' THEN
    UPDATE production_plans
    SET status = 'completed', updated_at = now()
    WHERE id = NEW.production_plan_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION close_plan_on_session_completed() IS
  'When a production session becomes completed, set its plan to completed unless the plan is already completed or cancelled. Does not call require_role. Invoker.';

REVOKE ALL ON FUNCTION close_plan_on_session_completed() FROM PUBLIC;
REVOKE ALL ON FUNCTION close_plan_on_session_completed() FROM anon;

DROP TRIGGER IF EXISTS production_sessions_close_plan ON production_sessions;

CREATE TRIGGER production_sessions_close_plan
  AFTER UPDATE OF status ON production_sessions
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM 'completed'
    AND NEW.status = 'completed'
  )
  EXECUTE FUNCTION close_plan_on_session_completed();

CREATE OR REPLACE FUNCTION cancel_production_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT *
  INTO v_plan
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;
  IF v_plan.status = 'completed' THEN
    RAISE EXCEPTION 'This production plan is already completed.';
  END IF;
  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'This production plan is already cancelled.';
  END IF;
  IF v_plan.status NOT IN (
    'draft',
    'planned',
    'waiting_for_purchases',
    'ready_to_produce'
  ) THEN
    RAISE EXCEPTION 'This production plan cannot be cancelled.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM production_sessions
    WHERE production_plan_id = p_plan_id
      AND status IN ('ready', 'in_progress', 'completed')
  ) THEN
    RAISE EXCEPTION
      'Production has already started for this plan. It cannot be cancelled.';
  END IF;
  UPDATE production_plans
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_plan_id;
  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

COMMENT ON FUNCTION cancel_production_plan(uuid) IS
  'Cancel a production plan that has not started. Sets status to cancelled only. Does not change stock, shopping items, or purchases.';

REVOKE ALL ON FUNCTION cancel_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_production_plan(uuid) TO authenticated;

-- Dry-run only (this transaction rolls back). Vanilla Postgres replay does
-- not grant these tables to authenticated; Supabase does.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  ingredients,
  suppliers,
  purchases,
  production_plans,
  production_plan_products,
  production_plan_ingredients,
  production_plan_shopping_items,
  production_sessions,
  production_session_lines
TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_sqlstate text;
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
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
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

  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- A. Session status → completed closes the plan (trigger, not the
  --    complete_production_session body). See the Part 1 header.
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
    SELECT status INTO v_purchase_status FROM purchases WHERE id = v_purchase;

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
  -- G. Seller JWT is rejected by require_role
  -- ------------------------------------------------------------------
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_CLOSE_131_G_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  BEGIN
    BEGIN
      PERFORM cancel_production_plan(v_plan);
      RAISE EXCEPTION 'SCENARIO G FAIL: seller cancel succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
        IF v_err LIKE 'SCENARIO G FAIL:%' THEN
          RAISE;
        END IF;
        IF v_sqlstate IS DISTINCT FROM '42501'
           AND v_err NOT ILIKE '%Insufficient permissions%' THEN
          RAISE EXCEPTION
            'SCENARIO G FAIL: expected require_role, got % / %',
            v_sqlstate, v_err;
        END IF;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      RAISE;
  END;

  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: seller cancel changed status to %', v_status;
  END IF;

  RAISE NOTICE 'SCENARIO G PASS';

  -- ------------------------------------------------------------------
  -- H. Backfill skips a plan that still has an open session.
  --    Completing that session closes the plan via the trigger.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

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
  RAISE NOTICE 'sql/131 dry run: scenarios A-H passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- REAL MIGRATION. Run only after Part 1 passes.
-- Identical function and trigger bodies and grants, then the backfill.
-- No scenarios.
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

CREATE OR REPLACE FUNCTION close_plan_on_session_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'completed'
     AND NEW.status = 'completed' THEN
    UPDATE production_plans
    SET status = 'completed', updated_at = now()
    WHERE id = NEW.production_plan_id
      AND status NOT IN ('completed', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION close_plan_on_session_completed() IS
  'When a production session becomes completed, set its plan to completed unless the plan is already completed or cancelled. Does not call require_role. Invoker.';

REVOKE ALL ON FUNCTION close_plan_on_session_completed() FROM PUBLIC;
REVOKE ALL ON FUNCTION close_plan_on_session_completed() FROM anon;

DROP TRIGGER IF EXISTS production_sessions_close_plan ON production_sessions;

CREATE TRIGGER production_sessions_close_plan
  AFTER UPDATE OF status ON production_sessions
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM 'completed'
    AND NEW.status = 'completed'
  )
  EXECUTE FUNCTION close_plan_on_session_completed();

CREATE OR REPLACE FUNCTION cancel_production_plan(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT *
  INTO v_plan
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;
  IF v_plan.status = 'completed' THEN
    RAISE EXCEPTION 'This production plan is already completed.';
  END IF;
  IF v_plan.status = 'cancelled' THEN
    RAISE EXCEPTION 'This production plan is already cancelled.';
  END IF;
  IF v_plan.status NOT IN (
    'draft',
    'planned',
    'waiting_for_purchases',
    'ready_to_produce'
  ) THEN
    RAISE EXCEPTION 'This production plan cannot be cancelled.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM production_sessions
    WHERE production_plan_id = p_plan_id
      AND status IN ('ready', 'in_progress', 'completed')
  ) THEN
    RAISE EXCEPTION
      'Production has already started for this plan. It cannot be cancelled.';
  END IF;
  UPDATE production_plans
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_plan_id;
  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

COMMENT ON FUNCTION cancel_production_plan(uuid) IS
  'Cancel a production plan that has not started. Sets status to cancelled only. Does not change stock, shopping items, or purchases.';

REVOKE ALL ON FUNCTION cancel_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION cancel_production_plan(uuid) TO authenticated;

UPDATE production_plans AS p
SET status = 'completed', updated_at = now()
WHERE p.status NOT IN ('completed', 'cancelled')
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

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION.
-- Fresh SQL Editor tab. Do not wrap this in a transaction.
-- The SELECT is the last statement.
-- PUBLIC is not a role name, so has_function_privilege cannot take it;
-- public_execute reads the ACL (grantee 0). A NULL proacl means the
-- default PUBLIC EXECUTE grant is still in force.
-- ============================================================================

DO $catalog$
DECLARE
  v_enabled text;
  v_trigger_count integer;
  v_prosecdef boolean;
  v_body text;
  v_anon boolean;
  v_authenticated boolean;
  v_public boolean;
  v_open_count integer;
BEGIN
  SELECT count(*), max(t.tgenabled)
  INTO v_trigger_count, v_enabled
  FROM pg_trigger t
  WHERE t.tgname = 'production_sessions_close_plan'
    AND t.tgrelid = 'public.production_sessions'::regclass
    AND NOT t.tgisinternal;

  IF v_trigger_count IS DISTINCT FROM 1 OR v_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION
      'production_sessions_close_plan count % enabled % (expected 1 / O)',
      v_trigger_count, v_enabled;
  END IF;

  SELECT p.prosecdef, pg_get_functiondef(p.oid)
  INTO v_prosecdef, v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'cancel_production_plan';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION 'cancel_production_plan is not SECURITY DEFINER';
  END IF;
  IF v_body NOT LIKE '%require_role%' THEN
    RAISE EXCEPTION 'cancel_production_plan is missing require_role';
  END IF;

  SELECT
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    CASE
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(p.proacl) AS x
        WHERE x.grantee = 0
          AND x.privilege_type = 'EXECUTE'
      )
    END
  INTO v_anon, v_authenticated, v_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'cancel_production_plan';

  IF v_anon OR v_public OR NOT v_authenticated THEN
    RAISE EXCEPTION
      'cancel_production_plan privileges anon % public % authenticated %',
      v_anon, v_public, v_authenticated;
  END IF;

  SELECT p.prosecdef
  INTO v_prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'close_plan_on_session_completed';

  IF v_prosecdef THEN
    RAISE EXCEPTION 'close_plan_on_session_completed should stay SECURITY INVOKER';
  END IF;

  SELECT
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    CASE
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(p.proacl) AS x
        WHERE x.grantee = 0
          AND x.privilege_type = 'EXECUTE'
      )
    END
  INTO v_anon, v_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'close_plan_on_session_completed';

  IF v_anon OR v_public THEN
    RAISE EXCEPTION
      'close_plan_on_session_completed privileges anon % public %',
      v_anon, v_public;
  END IF;

  SELECT count(*)
  INTO v_open_count
  FROM production_plans AS p
  WHERE p.status NOT IN ('completed', 'cancelled')
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

  IF v_open_count <> 0 THEN
    RAISE EXCEPTION
      '% plans have a completed session, no open session, and are not completed',
      v_open_count;
  END IF;
END;
$catalog$;

SELECT
  t.tgname::text,
  t.tgenabled::text,
  p.proname,
  p.prosecdef,
  pg_get_functiondef(p.oid) LIKE '%require_role%' AS has_require_role,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  CASE
    WHEN p.proacl IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM aclexplode(p.proacl) AS x
      WHERE x.grantee = 0
        AND x.privilege_type = 'EXECUTE'
    )
  END AS public_execute,
  (
    SELECT count(*)
    FROM production_plans AS plan
    WHERE plan.status NOT IN ('completed', 'cancelled')
      AND EXISTS (
        SELECT 1
        FROM production_sessions AS s
        WHERE s.production_plan_id = plan.id
          AND s.status = 'completed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM production_sessions AS s
        WHERE s.production_plan_id = plan.id
          AND s.status IN ('ready', 'in_progress')
      )
  ) AS plans_backfill_still_due
FROM pg_trigger t
JOIN pg_proc p
  ON p.oid = t.tgfoid
WHERE t.tgname = 'production_sessions_close_plan'
  AND t.tgrelid = 'public.production_sessions'::regclass
  AND NOT t.tgisinternal

UNION ALL

SELECT
  NULL::text,
  NULL::text,
  p.proname,
  p.prosecdef,
  pg_get_functiondef(p.oid) LIKE '%require_role%' AS has_require_role,
  has_function_privilege('anon', p.oid, 'EXECUTE'),
  has_function_privilege('authenticated', p.oid, 'EXECUTE'),
  CASE
    WHEN p.proacl IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM aclexplode(p.proacl) AS x
      WHERE x.grantee = 0
        AND x.privilege_type = 'EXECUTE'
    )
  END,
  (
    SELECT count(*)
    FROM production_plans AS plan
    WHERE plan.status NOT IN ('completed', 'cancelled')
      AND EXISTS (
        SELECT 1
        FROM production_sessions AS s
        WHERE s.production_plan_id = plan.id
          AND s.status = 'completed'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM production_sessions AS s
        WHERE s.production_plan_id = plan.id
          AND s.status IN ('ready', 'in_progress')
      )
  )
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'cancel_production_plan';
