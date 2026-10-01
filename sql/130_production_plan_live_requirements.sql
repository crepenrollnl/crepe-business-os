-- Live production-plan requirements (prod-plan-resync-gap).
-- Run in Supabase SQL editor after sql/129_ingredient_categories_rls_fix.sql.
-- Apply on both databases (dev + prod):
--   Part 1 dry run (BEGIN...ROLLBACK, proves itself, leaves nothing behind)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone catalog checks, fresh tab, no transaction
--
-- production_plan_live_requirements is the only definition of a plan's
-- ingredient needs. confirm_production_plan, check_production_plan_readiness,
-- and start_production_session all call it. Root scale is
-- planned_quantity / recipes.yield_quantity (live yield, same denominator
-- as complete_production_session). Lines that round to 0 are omitted so
-- production_plan_ingredients.required_quantity > 0 still holds.
--
-- FK check (repo, re-checked at the start of Part 1 against pg_constraint):
--   nothing references production_plan_ingredients. production_plan_shopping_items
--   references ingredients and production_plans, not the snapshot row.
--   Resync therefore DELETEs ingredients that are no longer required.
--   That delete cannot fail on an FK and does not cascade. Shopping-list
--   rows are a separate snapshot and are not rewritten here.
--
-- Grants: confirm, readiness, and start are what the app calls, so
-- EXECUTE is granted to authenticated (and revoked from PUBLIC and anon).
-- production_plan_live_requirements is also granted to authenticated.
-- start_production_session is SECURITY INVOKER (sql/098), so it cannot
-- call a helper whose EXECUTE is revoked from authenticated. The helper
-- still runs require_role('owner','partner') and is SECURITY DEFINER.
-- confirm and readiness stay SECURITY DEFINER. start stays INVOKER.
--
-- Does NOT:
--   - change the TypeScript Calculate Requirements calculator
--   - call check_production_plan_readiness from the execution queue
--   - rewrite inventory_quantity_at_planning on existing snapshot rows
--   - demote or resync a plan that already has a ready, in_progress,
--     or completed production session
--
-- ============================================================================
-- PART 0 of 3 -- IMPACT PREVIEW. One read-only SELECT. No BEGIN, no writes,
-- no new functions. Run this on dev and prod BEFORE Part 1.
-- The formula below duplicates production_plan_live_requirements on purpose:
-- that function does not exist until Part 2 commits. It calls the existing
-- explode_component_recipe_leaves (sql/101), which does not call require_role.
-- ============================================================================

-- >>> IMPACT PREVIEW START
WITH eligible AS (
  SELECT p.id, p.name, p.status
  FROM production_plans p
  WHERE p.status IN ('planned', 'waiting_for_purchases', 'ready_to_produce')
    AND p.name NOT ILIKE 'TEST%'
    AND NOT EXISTS (
      SELECT 1
      FROM production_sessions s
      WHERE s.production_plan_id = p.id
        AND s.status IN ('ready', 'in_progress', 'completed')
    )
),
live_lines AS (
  SELECT
    e.id AS plan_id,
    x.ingredient_id,
    x.quantity
  FROM eligible e
  JOIN production_plan_products ppp ON ppp.production_plan_id = e.id
  JOIN recipes r ON r.id = ppp.recipe_id
  CROSS JOIN LATERAL explode_component_recipe_leaves(
    ppp.recipe_id,
    ppp.planned_quantity / r.yield_quantity
  ) x
),
live_req AS (
  SELECT
    plan_id,
    ingredient_id,
    round(SUM(quantity), 3) AS new_required
  FROM live_lines
  GROUP BY plan_id, ingredient_id
  HAVING round(SUM(quantity), 3) > 0
),
snap AS (
  SELECT
    ppi.production_plan_id AS plan_id,
    ppi.ingredient_id,
    ppi.ingredient_name,
    ppi.required_quantity AS old_required
  FROM production_plan_ingredients ppi
  JOIN eligible e ON e.id = ppi.production_plan_id
),
changed AS (
  SELECT
    COALESCE(s.plan_id, l.plan_id) AS plan_id,
    COALESCE(s.ingredient_id, l.ingredient_id) AS ingredient_id,
    COALESCE(s.ingredient_name, i.name) AS ingredient_name,
    s.old_required,
    l.new_required
  FROM snap s
  FULL OUTER JOIN live_req l
    ON l.plan_id = s.plan_id
   AND l.ingredient_id = s.ingredient_id
  LEFT JOIN ingredients i
    ON i.id = COALESCE(s.ingredient_id, l.ingredient_id)
  WHERE s.ingredient_id IS NULL
     OR l.ingredient_id IS NULL
     OR s.old_required IS DISTINCT FROM l.new_required
),
product_counts AS (
  SELECT e.id AS plan_id, count(ppp.id) AS product_count
  FROM eligible e
  LEFT JOIN production_plan_products ppp ON ppp.production_plan_id = e.id
  GROUP BY e.id
),
sufficiency AS (
  SELECT
    e.id AS plan_id,
    (
      COALESCE(pc.product_count, 0) >= 1
      AND EXISTS (
        SELECT 1 FROM live_req r WHERE r.plan_id = e.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM live_req r
        JOIN ingredients i ON i.id = r.ingredient_id
        WHERE r.plan_id = e.id
          AND i.current_stock + 1e-9 < r.new_required
      )
    ) AS is_sufficient
  FROM eligible e
  LEFT JOIN product_counts pc ON pc.plan_id = e.id
)
SELECT
  e.id AS plan_id,
  e.name AS plan_name,
  e.status AS current_status,
  CASE
    WHEN s.is_sufficient
         AND e.status IN ('planned', 'waiting_for_purchases')
      THEN 'ready_to_produce'
    WHEN NOT s.is_sufficient
         AND e.status = 'ready_to_produce'
      THEN 'planned'
    ELSE e.status
  END AS would_be_status,
  c.ingredient_id,
  c.ingredient_name,
  c.old_required,
  c.new_required
FROM eligible e
JOIN sufficiency s ON s.plan_id = e.id
LEFT JOIN changed c ON c.plan_id = e.id
ORDER BY e.name, c.ingredient_name NULLS FIRST;
-- <<< IMPACT PREVIEW END

-- ============================================================================
-- PART 1 of 3 -- DRY RUN. Copy everything between "-- >>> DRY RUN START"
-- and "-- <<< DRY RUN END" into the Supabase SQL Editor and run it after
-- Part 0. Scenarios raise on failure. The transaction rolls back.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION production_plan_live_requirements(
  p_plan_id uuid
)
RETURNS TABLE (
  ingredient_id uuid,
  unit text,
  required_quantity numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM require_role('owner', 'partner');
  RETURN QUERY
  SELECT
    req.ingredient_id,
    req.unit,
    req.required_quantity
  FROM (
    SELECT
      e.ingredient_id,
      round(SUM(e.quantity), 3) AS required_quantity,
      MIN(e.unit) AS unit
    FROM production_plan_products ppp
    JOIN recipes r ON r.id = ppp.recipe_id
    CROSS JOIN LATERAL explode_component_recipe_leaves(
      ppp.recipe_id,
      ppp.planned_quantity / r.yield_quantity
    ) e
    WHERE ppp.production_plan_id = p_plan_id
    GROUP BY e.ingredient_id
  ) req
  WHERE req.required_quantity > 0;
END;
$$;

COMMENT ON FUNCTION production_plan_live_requirements(uuid) IS
  'Live ingredient needs for a production plan: explode_component_recipe_leaves scaled by planned_quantity / recipes.yield_quantity, grouped by ingredient, rounded to 3 dp. Sole definition used by confirm, readiness, and start.';

REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM anon;
REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION production_plan_live_requirements(uuid) TO authenticated;

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
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
  v_nested_name text;
BEGIN
  PERFORM require_role('owner', 'partner');
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

  SELECT r.name INTO v_nested_name
  FROM production_plan_products ppp
  JOIN recipes r ON r.id = ppp.recipe_id
  WHERE ppp.production_plan_id = p_plan_id
    AND is_nested_component_recipe(ppp.recipe_id)
  LIMIT 1;
  IF v_nested_name IS NOT NULL THEN
    RAISE EXCEPTION
      'This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    WHERE ppp.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1 FROM explode_component_recipe_leaves(ppp.recipe_id, 1)
      )
  ) THEN
    RAISE EXCEPTION 'One or more recipes on this plan have no ingredients.';
  END IF;

  SELECT e.ingredient_id, i.name, string_agg(DISTINCT e.unit, ', ' ORDER BY e.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_plan_products ppp
  CROSS JOIN LATERAL explode_component_recipe_leaves(ppp.recipe_id, 1) e
  JOIN ingredients i ON i.id = e.ingredient_id
  WHERE ppp.production_plan_id = p_plan_id
  GROUP BY e.ingredient_id, i.name
  HAVING COUNT(DISTINCT e.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes on this plan (found: %). Fix the affected recipes before confirming this plan.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;

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
  FROM production_plan_live_requirements(p_plan_id) req
  JOIN ingredients i ON i.id = req.ingredient_id;

  UPDATE production_plans
  SET status = 'planned', updated_at = now()
  WHERE id = p_plan_id;
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

COMMENT ON FUNCTION confirm_production_plan(uuid) IS
  'Confirm a draft production plan: snapshot production_plan_live_requirements into production_plan_ingredients, set planned / ready_to_produce. Rejects recipes currently used as nested sub-components.';

REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_production_plan(uuid) TO authenticated;

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
  v_has_session boolean;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT status INTO v_status
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM production_sessions
    WHERE production_plan_id = p_plan_id
      AND status IN ('ready', 'in_progress', 'completed')
  ) INTO v_has_session;

  IF v_status IN ('planned', 'waiting_for_purchases', 'ready_to_produce')
     AND NOT v_has_session THEN
    UPDATE production_plan_ingredients AS ppi
    SET
      required_quantity = req.required_quantity,
      unit = req.unit,
      ingredient_name = i.name,
      missing_quantity = GREATEST(req.required_quantity - i.current_stock, 0)
    FROM production_plan_live_requirements(p_plan_id) AS req
    JOIN ingredients AS i ON i.id = req.ingredient_id
    WHERE ppi.production_plan_id = p_plan_id
      AND ppi.ingredient_id = req.ingredient_id;

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
    FROM production_plan_live_requirements(p_plan_id) AS req
    JOIN ingredients AS i ON i.id = req.ingredient_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM production_plan_ingredients AS ppi
      WHERE ppi.production_plan_id = p_plan_id
        AND ppi.ingredient_id = req.ingredient_id
    );

    DELETE FROM production_plan_ingredients AS ppi
    WHERE ppi.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id) AS req
        WHERE req.ingredient_id = ppi.ingredient_id
      );

    SELECT
      (
        SELECT count(*)
        FROM production_plan_products
        WHERE production_plan_id = p_plan_id
      ) >= 1
      AND EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id) AS req
        JOIN ingredients AS i ON i.id = req.ingredient_id
        WHERE i.current_stock + 1e-9 < req.required_quantity
      )
    INTO v_sufficient;

    IF v_sufficient AND v_status IN ('planned', 'waiting_for_purchases') THEN
      UPDATE production_plans
      SET status = 'ready_to_produce', updated_at = now()
      WHERE id = p_plan_id;
    ELSIF NOT v_sufficient AND v_status = 'ready_to_produce' THEN
      UPDATE production_plans
      SET status = 'planned', updated_at = now()
      WHERE id = p_plan_id;
    END IF;
  END IF;

  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

COMMENT ON FUNCTION check_production_plan_readiness(uuid) IS
  'While a plan is planned, waiting_for_purchases, or ready_to_produce and has no ready, in-progress, or completed session: resync production_plan_ingredients from production_plan_live_requirements (never rewriting inventory_quantity_at_planning on existing rows). Sufficient means at least one product, a non-empty live requirement set, and no shortage. Promote to ready_to_produce, or demote ready_to_produce to planned. Otherwise no-op.';

REVOKE ALL ON FUNCTION check_production_plan_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_production_plan_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION check_production_plan_readiness(uuid) TO authenticated;

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
  v_short_name text;
  v_short_need numeric;
  v_short_have numeric;
BEGIN
  PERFORM require_role('owner', 'partner');
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
  SELECT i.name, req.required_quantity, i.current_stock
  INTO v_short_name, v_short_need, v_short_have
  FROM production_plan_live_requirements(p_production_plan_id) AS req
  JOIN ingredients AS i ON i.id = req.ingredient_id
  WHERE i.current_stock + 1e-9 < req.required_quantity
  ORDER BY i.name
  LIMIT 1;
  IF v_short_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot start production. Not enough "%" in stock for the current recipe (need %, have %). Open the plan to recalculate.',
      v_short_name,
      round(v_short_need, 3),
      round(v_short_have, 3);
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

COMMENT ON FUNCTION start_production_session(uuid) IS
  'Open a production session for a ready_to_produce plan. Refuses to insert when live production_plan_live_requirements are short of current stock. Does not change the plan status.';

REVOKE ALL ON FUNCTION start_production_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_production_session(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION start_production_session(uuid) TO authenticated;

-- Dry-run only (this transaction rolls back). Vanilla Postgres replay does
-- not grant these tables to authenticated; Supabase does. The grants let
-- SET LOCAL ROLE authenticated insert the TEST rows below.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  ingredients,
  recipes,
  recipe_items,
  production_plans,
  production_plan_products,
  production_plan_ingredients,
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
  v_required numeric;
  v_at_planning numeric;
  v_missing numeric;
  v_count integer;
  v_plan uuid;
  v_recipe uuid;
  v_recipe_b uuid;
  v_ing uuid;
  v_ing_b uuid;
  v_product_b uuid;
  v_session uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.confrelid = 'public.production_plan_ingredients'::regclass
  ) THEN
    RAISE EXCEPTION
      'production_plan_ingredients is referenced by a foreign key. DELETE during resync is not safe; stop and revisit.';
  END IF;

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
  -- A. Recipe edit lowers requirement → resync + promote
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_A_flour_' || v_suffix, 'kg', 5, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_A_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 10, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_A_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_A_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: after confirm status is %', v_status;
  END IF;

  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_required IS DISTINCT FROM 10
     OR v_at_planning IS DISTINCT FROM 5
     OR v_missing IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: snapshot required % at_planning % missing %',
      v_required, v_at_planning, v_missing;
  END IF;

  UPDATE recipe_items
  SET quantity = 4
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: after readiness status is %', v_status;
  END IF;
  IF v_required IS DISTINCT FROM 4
     OR v_missing IS DISTINCT FROM 0
     OR v_at_planning IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: after resync required % missing % at_planning %',
      v_required, v_missing, v_at_planning;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- ------------------------------------------------------------------
  -- B. Quantity increased after ready → demote to planned
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_B_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_B_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_B_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_B_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: confirm status is %', v_status;
  END IF;

  UPDATE production_plan_products
  SET planned_quantity = 20
  WHERE production_plan_id = v_plan;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity, missing_quantity
  INTO v_required, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: demoted status is %', v_status;
  END IF;
  IF v_required IS DISTINCT FROM 20 OR v_missing IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: required % missing %',
      v_required, v_missing;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- ------------------------------------------------------------------
  -- C. Add product → new row; remove product → its row disappears
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_C_flour_' || v_suffix, 'kg', 100, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_C_milk_' || v_suffix, 'l', 100, 0, 1, true)
  RETURNING id INTO v_ing_b;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_C_recipe_a_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_C_recipe_b_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe_b;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');
  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe_b, v_ing_b, 2, 'l');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_C_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_C_recipe_a_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  IF NOT EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan AND ingredient_id = v_ing
  ) OR EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan AND ingredient_id = v_ing_b
  ) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: confirm snapshot was not flour-only';
  END IF;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe_b, 'TEST_RESYNC_130_C_recipe_b_' || v_suffix,
    1, 1, 'kg', 1
  )
  RETURNING id INTO v_product_b;

  PERFORM check_production_plan_readiness(v_plan);

  IF NOT EXISTS (
    SELECT 1 FROM production_plan_ingredients
    WHERE production_plan_id = v_plan
      AND ingredient_id = v_ing_b
      AND required_quantity = 2
  ) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: milk row did not appear';
  END IF;

  DELETE FROM production_plan_products WHERE id = v_product_b;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: milk row still present (%).', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: flour row count is %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS';

  -- ------------------------------------------------------------------
  -- D. inventory_quantity_at_planning stays frozen on existing rows
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_D_flour_' || v_suffix, 'kg', 8, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_D_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 2, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_D_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_D_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT inventory_quantity_at_planning
  INTO v_at_planning
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_at_planning IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: at_planning after confirm is %', v_at_planning;
  END IF;

  -- sql/125 rejects current_stock changes when current_user = authenticated.
  RESET ROLE;
  UPDATE ingredients SET current_stock = 1 WHERE id = v_ing;
  SET LOCAL ROLE authenticated;
  UPDATE recipe_items
  SET quantity = 3
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT required_quantity, inventory_quantity_at_planning, missing_quantity
  INTO v_required, v_at_planning, v_missing
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_at_planning IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: at_planning changed to %', v_at_planning;
  END IF;
  IF v_required IS DISTINCT FROM 3 OR v_missing IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: required % missing % (resync did not apply)',
      v_required, v_missing;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS';

  -- ------------------------------------------------------------------
  -- E. in_progress session → readiness changes nothing
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_E_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_E_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_E_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_E_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: confirm status is %', v_status;
  END IF;

  v_session := (start_production_session(v_plan) ->> 'session_id')::uuid;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: start returned no session';
  END IF;

  UPDATE recipe_items
  SET quantity = 50
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  SELECT required_quantity INTO v_required
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan AND ingredient_id = v_ing;

  IF v_status IS DISTINCT FROM 'ready_to_produce' OR v_required IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: status % required % (expected ready_to_produce / 1)',
      v_status, v_required;
  END IF;

  RAISE NOTICE 'SCENARIO E PASS';

  -- ------------------------------------------------------------------
  -- F. start refuses when live stock is short; status stays ready
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_F_flour_' || v_suffix, 'kg', 5, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_F_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_F_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_F_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  UPDATE recipe_items
  SET quantity = 20
  WHERE recipe_id = v_recipe AND ingredient_id = v_ing;

  BEGIN
    PERFORM start_production_session(v_plan);
    RAISE EXCEPTION 'SCENARIO F FAIL: start succeeded while stock was short';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Cannot start production. Not enough "TEST_RESYNC_130_F_flour_' || v_suffix || '"%'
         OR v_err NOT LIKE '%Open the plan to recalculate.'
         OR v_err NOT LIKE '%need 20%'
         OR v_err NOT LIKE '%have 5%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: unexpected message [%] %', v_sqlstate, v_err;
      END IF;
  END;

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: status changed to %', v_status;
  END IF;
  IF EXISTS (
    SELECT 1 FROM production_sessions WHERE production_plan_id = v_plan
  ) THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: a session row was inserted';
  END IF;

  RAISE NOTICE 'SCENARIO F PASS';

  -- ------------------------------------------------------------------
  -- G. Unchanged recipe: snapshot matches the old yield-denominator formula
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_G_flour_' || v_suffix, 'kg', 100, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_G_milk_' || v_suffix, 'l', 100, 0, 1, true)
  RETURNING id INTO v_ing_b;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_G_recipe_' || v_suffix, 2, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES
    (v_recipe, v_ing, 1.25, 'kg'),
    (v_recipe, v_ing_b, 0.2, 'l');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_G_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_G_recipe_' || v_suffix,
    3, 2, 'kg', 0
  );

  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    JOIN recipes r ON r.id = ppp.recipe_id
    WHERE ppp.production_plan_id = v_plan
      AND ppp.yield_quantity IS DISTINCT FROM r.yield_quantity
  ) THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: plan yield and live yield differ';
  END IF;

  PERFORM confirm_production_plan(v_plan);

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        e.ingredient_id,
        round(SUM(e.quantity), 3) AS required_quantity
      FROM production_plan_products ppp
      CROSS JOIN LATERAL explode_component_recipe_leaves(
        ppp.recipe_id,
        ppp.planned_quantity / ppp.yield_quantity
      ) e
      WHERE ppp.production_plan_id = v_plan
      GROUP BY e.ingredient_id
    ) old_formula
    FULL OUTER JOIN (
      SELECT *
      FROM production_plan_ingredients
      WHERE production_plan_id = v_plan
    ) ppi
      ON ppi.ingredient_id = old_formula.ingredient_id
    WHERE ppi.ingredient_id IS NULL
       OR old_formula.ingredient_id IS NULL
       OR ppi.required_quantity IS DISTINCT FROM old_formula.required_quantity
  ) THEN
    RAISE EXCEPTION
      'SCENARIO G FAIL: snapshot does not match the old planned/yield formula';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_plan_live_requirements(v_plan) live
    FULL OUTER JOIN (
      SELECT *
      FROM production_plan_ingredients
      WHERE production_plan_id = v_plan
    ) ppi
      ON ppi.ingredient_id = live.ingredient_id
    WHERE ppi.ingredient_id IS NULL
       OR live.ingredient_id IS NULL
       OR ppi.required_quantity IS DISTINCT FROM live.required_quantity
  ) THEN
    RAISE EXCEPTION
      'SCENARIO G FAIL: snapshot does not match production_plan_live_requirements';
  END IF;

  RAISE NOTICE 'SCENARIO G PASS';

  -- ------------------------------------------------------------------
  -- H. Seller JWT is rejected by require_role
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_H_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_H_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_H_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_H_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  BEGIN
    BEGIN
      PERFORM confirm_production_plan(v_plan);
      RAISE EXCEPTION 'SCENARIO H FAIL: seller confirm succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
        IF v_err LIKE 'SCENARIO H FAIL:%' THEN
          RAISE;
        END IF;
        IF v_sqlstate IS DISTINCT FROM '42501'
           AND v_err NOT ILIKE '%Insufficient permissions%' THEN
          RAISE EXCEPTION
            'SCENARIO H FAIL: confirm expected require_role, got % / %',
            v_sqlstate, v_err;
        END IF;
    END;

    BEGIN
      PERFORM check_production_plan_readiness(v_plan);
      RAISE EXCEPTION 'SCENARIO H FAIL: seller readiness succeeded';
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
        IF v_err LIKE 'SCENARIO H FAIL:%' THEN
          RAISE;
        END IF;
        IF v_sqlstate IS DISTINCT FROM '42501'
           AND v_err NOT ILIKE '%Insufficient permissions%' THEN
          RAISE EXCEPTION
            'SCENARIO H FAIL: readiness expected require_role, got % / %',
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
    RAISE EXCEPTION 'SCENARIO H FAIL: seller confirm changed status to %', v_status;
  END IF;

  RAISE NOTICE 'SCENARIO H PASS';

  -- ------------------------------------------------------------------
  -- I. All products removed after confirm → demote, do not promote
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RESYNC_130_I_flour_' || v_suffix, 'kg', 10, 0, 1, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RESYNC_130_I_recipe_' || v_suffix, 1, 'kg', true, 'component')
  RETURNING id INTO v_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe, v_ing, 1, 'kg');

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RESYNC_130_I_' || v_suffix, CURRENT_DATE, 'draft')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name,
    planned_quantity, yield_quantity, yield_unit, sort_order
  ) VALUES (
    v_plan, v_recipe, 'TEST_RESYNC_130_I_recipe_' || v_suffix,
    1, 1, 'kg', 0
  );

  PERFORM confirm_production_plan(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: confirm status is %', v_status;
  END IF;

  DELETE FROM production_plan_products WHERE production_plan_id = v_plan;

  PERFORM check_production_plan_readiness(v_plan);

  SELECT status INTO v_status FROM production_plans WHERE id = v_plan;
  IF v_status IS DISTINCT FROM 'planned' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: status is %', v_status;
  END IF;

  SELECT count(*) INTO v_count
  FROM production_plan_ingredients
  WHERE production_plan_id = v_plan;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: snapshot row count is %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO I PASS';
  RAISE NOTICE 'sql/130 dry run: scenarios A-I passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- REAL MIGRATION. Run only after Part 1 passes.
-- Identical function bodies and grants. No scenarios, no report.
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

CREATE OR REPLACE FUNCTION production_plan_live_requirements(
  p_plan_id uuid
)
RETURNS TABLE (
  ingredient_id uuid,
  unit text,
  required_quantity numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM require_role('owner', 'partner');
  RETURN QUERY
  SELECT
    req.ingredient_id,
    req.unit,
    req.required_quantity
  FROM (
    SELECT
      e.ingredient_id,
      round(SUM(e.quantity), 3) AS required_quantity,
      MIN(e.unit) AS unit
    FROM production_plan_products ppp
    JOIN recipes r ON r.id = ppp.recipe_id
    CROSS JOIN LATERAL explode_component_recipe_leaves(
      ppp.recipe_id,
      ppp.planned_quantity / r.yield_quantity
    ) e
    WHERE ppp.production_plan_id = p_plan_id
    GROUP BY e.ingredient_id
  ) req
  WHERE req.required_quantity > 0;
END;
$$;

COMMENT ON FUNCTION production_plan_live_requirements(uuid) IS
  'Live ingredient needs for a production plan: explode_component_recipe_leaves scaled by planned_quantity / recipes.yield_quantity, grouped by ingredient, rounded to 3 dp. Sole definition used by confirm, readiness, and start.';

REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM anon;
REVOKE ALL ON FUNCTION production_plan_live_requirements(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION production_plan_live_requirements(uuid) TO authenticated;

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
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
  v_nested_name text;
BEGIN
  PERFORM require_role('owner', 'partner');
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

  SELECT r.name INTO v_nested_name
  FROM production_plan_products ppp
  JOIN recipes r ON r.id = ppp.recipe_id
  WHERE ppp.production_plan_id = p_plan_id
    AND is_nested_component_recipe(ppp.recipe_id)
  LIMIT 1;
  IF v_nested_name IS NOT NULL THEN
    RAISE EXCEPTION
      'This recipe is used as a sub-component of another Component recipe and cannot be planned or produced on its own.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    WHERE ppp.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1 FROM explode_component_recipe_leaves(ppp.recipe_id, 1)
      )
  ) THEN
    RAISE EXCEPTION 'One or more recipes on this plan have no ingredients.';
  END IF;

  SELECT e.ingredient_id, i.name, string_agg(DISTINCT e.unit, ', ' ORDER BY e.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_plan_products ppp
  CROSS JOIN LATERAL explode_component_recipe_leaves(ppp.recipe_id, 1) e
  JOIN ingredients i ON i.id = e.ingredient_id
  WHERE ppp.production_plan_id = p_plan_id
  GROUP BY e.ingredient_id, i.name
  HAVING COUNT(DISTINCT e.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes on this plan (found: %). Fix the affected recipes before confirming this plan.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;

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
  FROM production_plan_live_requirements(p_plan_id) req
  JOIN ingredients i ON i.id = req.ingredient_id;

  UPDATE production_plans
  SET status = 'planned', updated_at = now()
  WHERE id = p_plan_id;
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

COMMENT ON FUNCTION confirm_production_plan(uuid) IS
  'Confirm a draft production plan: snapshot production_plan_live_requirements into production_plan_ingredients, set planned / ready_to_produce. Rejects recipes currently used as nested sub-components.';

REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_production_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_production_plan(uuid) TO authenticated;

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
  v_has_session boolean;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT status INTO v_status
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM production_sessions
    WHERE production_plan_id = p_plan_id
      AND status IN ('ready', 'in_progress', 'completed')
  ) INTO v_has_session;

  IF v_status IN ('planned', 'waiting_for_purchases', 'ready_to_produce')
     AND NOT v_has_session THEN
    UPDATE production_plan_ingredients AS ppi
    SET
      required_quantity = req.required_quantity,
      unit = req.unit,
      ingredient_name = i.name,
      missing_quantity = GREATEST(req.required_quantity - i.current_stock, 0)
    FROM production_plan_live_requirements(p_plan_id) AS req
    JOIN ingredients AS i ON i.id = req.ingredient_id
    WHERE ppi.production_plan_id = p_plan_id
      AND ppi.ingredient_id = req.ingredient_id;

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
    FROM production_plan_live_requirements(p_plan_id) AS req
    JOIN ingredients AS i ON i.id = req.ingredient_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM production_plan_ingredients AS ppi
      WHERE ppi.production_plan_id = p_plan_id
        AND ppi.ingredient_id = req.ingredient_id
    );

    DELETE FROM production_plan_ingredients AS ppi
    WHERE ppi.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id) AS req
        WHERE req.ingredient_id = ppi.ingredient_id
      );

    SELECT
      (
        SELECT count(*)
        FROM production_plan_products
        WHERE production_plan_id = p_plan_id
      ) >= 1
      AND EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM production_plan_live_requirements(p_plan_id) AS req
        JOIN ingredients AS i ON i.id = req.ingredient_id
        WHERE i.current_stock + 1e-9 < req.required_quantity
      )
    INTO v_sufficient;

    IF v_sufficient AND v_status IN ('planned', 'waiting_for_purchases') THEN
      UPDATE production_plans
      SET status = 'ready_to_produce', updated_at = now()
      WHERE id = p_plan_id;
    ELSIF NOT v_sufficient AND v_status = 'ready_to_produce' THEN
      UPDATE production_plans
      SET status = 'planned', updated_at = now()
      WHERE id = p_plan_id;
    END IF;
  END IF;

  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

COMMENT ON FUNCTION check_production_plan_readiness(uuid) IS
  'While a plan is planned, waiting_for_purchases, or ready_to_produce and has no ready, in-progress, or completed session: resync production_plan_ingredients from production_plan_live_requirements (never rewriting inventory_quantity_at_planning on existing rows). Sufficient means at least one product, a non-empty live requirement set, and no shortage. Promote to ready_to_produce, or demote ready_to_produce to planned. Otherwise no-op.';

REVOKE ALL ON FUNCTION check_production_plan_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_production_plan_readiness(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION check_production_plan_readiness(uuid) TO authenticated;

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
  v_short_name text;
  v_short_need numeric;
  v_short_have numeric;
BEGIN
  PERFORM require_role('owner', 'partner');
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
  SELECT i.name, req.required_quantity, i.current_stock
  INTO v_short_name, v_short_need, v_short_have
  FROM production_plan_live_requirements(p_production_plan_id) AS req
  JOIN ingredients AS i ON i.id = req.ingredient_id
  WHERE i.current_stock + 1e-9 < req.required_quantity
  ORDER BY i.name
  LIMIT 1;
  IF v_short_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot start production. Not enough "%" in stock for the current recipe (need %, have %). Open the plan to recalculate.',
      v_short_name,
      round(v_short_need, 3),
      round(v_short_have, 3);
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

COMMENT ON FUNCTION start_production_session(uuid) IS
  'Open a production session for a ready_to_produce plan. Refuses to insert when live production_plan_live_requirements are short of current stock. Does not change the plan status.';

REVOKE ALL ON FUNCTION start_production_session(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_production_session(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION start_production_session(uuid) TO authenticated;

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION.
-- Fresh SQL Editor tab. Do not wrap this in a transaction.
-- Expect the SELECT to show prosecdef true for the three DEFINER functions,
-- false for start_production_session (still INVOKER), require_role in every
-- body, confirm calling production_plan_live_requirements, anon and PUBLIC
-- without EXECUTE, authenticated with EXECUTE.
-- PUBLIC is not a role name, so has_function_privilege cannot take it;
-- public_can_execute reads the ACL (grantee 0). A NULL proacl means the
-- default PUBLIC EXECUTE grant is still in force.
-- ============================================================================

DO $catalog$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT
      p.proname,
      p.prosecdef,
      pg_get_functiondef(p.oid) AS body,
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
      END AS public_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'production_plan_live_requirements',
        'confirm_production_plan',
        'check_production_plan_readiness',
        'start_production_session'
      )
  LOOP
    IF v_rec.proname = 'start_production_session' THEN
      IF v_rec.prosecdef THEN
        RAISE EXCEPTION
          'start_production_session should stay SECURITY INVOKER';
      END IF;
    ELSIF NOT v_rec.prosecdef THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER', v_rec.proname;
    END IF;

    IF v_rec.body NOT LIKE '%require_role%' THEN
      RAISE EXCEPTION '% is missing require_role', v_rec.proname;
    END IF;

    IF v_rec.proname = 'confirm_production_plan'
       AND v_rec.body NOT LIKE '%production_plan_live_requirements%' THEN
      RAISE EXCEPTION
        'confirm_production_plan does not call production_plan_live_requirements';
    END IF;

    IF v_rec.anon_execute THEN
      RAISE EXCEPTION 'anon can EXECUTE %', v_rec.proname;
    END IF;

    IF v_rec.public_execute THEN
      RAISE EXCEPTION 'PUBLIC can EXECUTE %', v_rec.proname;
    END IF;

    IF NOT v_rec.authenticated_execute THEN
      RAISE EXCEPTION 'authenticated cannot EXECUTE %', v_rec.proname;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'production_plan_live_requirements',
        'confirm_production_plan',
        'check_production_plan_readiness',
        'start_production_session'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Expected 4 functions in public';
  END IF;
END;
$catalog$;

SELECT
  p.proname,
  p.prosecdef,
  pg_get_functiondef(p.oid) LIKE '%require_role%' AS has_require_role,
  pg_get_functiondef(p.oid) LIKE '%production_plan_live_requirements%'
    AS body_mentions_live_requirements,
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
  END AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'production_plan_live_requirements',
    'confirm_production_plan',
    'check_production_plan_readiness',
    'start_production_session'
  )
ORDER BY p.proname;
