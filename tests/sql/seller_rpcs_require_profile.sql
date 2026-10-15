-- SQL test: sql/145 — the 13 seller-flow RPCs require an active profile
-- (audit S2 + S3, step 2).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/seller_rpcs_require_profile.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-E passed".
--
-- Scenarios:
--   A — catalog: each of the 13 is SECURITY DEFINER, has the sql/145 guard
--       line exactly once, authenticated may EXECUTE, anon may not
--   B — a signed-in user whose profile is not active gets 42501
--       "No active profile" from every one of the 13 (all arguments NULL:
--       the guard runs before any input check)
--   C — anon gets 42501 from every one of the 13
--   D — a SELLER still does the whole draft-sale flow and every read:
--       create_draft_sale, add_sale_line, update_sale_line, delete_sale_line,
--       confirm_sale, set_sale_paid_flag, verify_sale_cost_and_profit,
--       record_posting_failure, get_company_settings, get_reporting_workspace,
--       get_sales_by_product, get_inventory_movement_history_by_ingredient,
--       create_and_confirm_sale
--   E — the OWNER still sells with create_and_confirm_sale
--
-- Updated for sql/156 (audit S4/U5 phase 2b): get_reporting_workspace,
-- get_sales_by_product, verify_sale_cost_and_profit and
-- get_inventory_movement_history_by_ingredient now carry the sql/156
-- owner/partner guard instead of the sql/145 line, and
-- record_posting_failure is no longer executable by authenticated. So A
-- checks those, B expects "permission denied" for record_posting_failure,
-- and D no longer calls these five as a seller (sql/156's own test checks
-- that the seller is refused and the owner is not).
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun145_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S3_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S3_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S3_comp_' || p_tag,
          p_qty, p_qty, 'pcs', 1)
  RETURNING id INTO v_line;

  UPDATE production_sessions SET status = 'completed', completed_at = now()
  WHERE id = v_session;

  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id,
    recipe_id, produced_quantity, unit_cost, produced_at
  )
  VALUES (v_session, v_line, p_recipe_id, p_recipe_id, p_qty, p_unit_cost,
          now() - interval '1 hour')
  RETURNING id INTO v_batch;

  RETURN v_batch;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun145_expect(
  p_label text, p_sqlstate text, p_message_like text, p_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_state text;
  v_err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%] for: %',
          p_label, p_sqlstate, p_message_like, v_state, v_err, p_sql;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun145_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun145_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_targets text[] := ARRAY[
    'create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)',
    'create_draft_sale(uuid, text, text, uuid)',
    'add_sale_line(uuid, uuid, numeric, numeric)',
    'update_sale_line(uuid, numeric)',
    'delete_sale_line(uuid)',
    'confirm_sale(uuid)',
    'set_sale_paid_flag(uuid, boolean)',
    'record_posting_failure(text, text, uuid, uuid, text)',
    'get_company_settings()',
    'verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric)',
    'get_inventory_movement_history_by_ingredient(uuid)',
    'get_reporting_workspace()',
    'get_sales_by_product(timestamp with time zone, timestamp with time zone)'
  ];
  v_owner_partner text[] := ARRAY[
    'verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric)',
    'get_inventory_movement_history_by_ingredient(uuid)',
    'get_reporting_workspace()',
    'get_sales_by_product(timestamp with time zone, timestamp with time zone)'
  ];
  v_revoked constant text := 'record_posting_failure(text, text, uuid, uuid, text)';
  v_sig text;
  v_oid oid;
  v_calls text[] := '{}';
  v_call text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_batch uuid;
  v_result jsonb;
  v_sale uuid;
  v_line1 uuid;
  v_line2 uuid;
  v_quick uuid;
  v_owner_sale uuid;
  v_ok boolean;
  v_failure uuid;
  v_count bigint;
  v_status text;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun145_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  FOREACH v_sig IN ARRAY v_targets
  LOOP
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % not found', v_sig;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid)
       OR (SELECT count(*) FROM pg_proc p,
             regexp_matches(p.prosrc,
               CASE WHEN v_sig = ANY (v_owner_partner)
                 THEN 'PERFORM require_role\(''owner'', ''partner''\);  -- sql/156'
                 ELSE 'PERFORM require_role\(''owner'', ''partner'', ''seller''\);  -- sql/145'
               END, 'g')
           WHERE p.oid = v_oid) <> 1
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') <> (v_sig <> v_revoked)
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % guard / definer / grants wrong', v_sig;
    END IF;

    SELECT format('SELECT public.%I(%s)', p.proname,
             COALESCE((
               SELECT string_agg('NULL::' || format_type(t.typ, NULL), ', ' ORDER BY t.ord)
               FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS t(typ, ord)
             ), ''))
    INTO v_call
    FROM pg_proc p WHERE p.oid = v_oid;
    v_calls := v_calls || v_call;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Signed-in owner/partner + test data.
  -- ------------------------------------------------------------------
  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_S3_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S3_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  v_batch := public.dryrun145_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_S3_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- ------------------------------------------------------------------
  -- B. No active profile: every one of the 13 refuses.
  -- ------------------------------------------------------------------
  UPDATE profiles SET is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF get_my_role() IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO B SETUP FAIL: role is %', get_my_role();
  END IF;
  FOREACH v_call IN ARRAY v_calls
  LOOP
    PERFORM public.dryrun145_expect('SCENARIO B no profile', '42501',
      CASE WHEN v_call LIKE 'SELECT public.record_posting_failure(%'
        THEN 'permission denied for function%' ELSE 'No active profile%' END,
      v_call);
  END LOOP;
  RESET ROLE;
  UPDATE profiles SET is_active = true WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- C. anon: every one of the 13 refuses.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  FOREACH v_call IN ARRAY v_calls
  LOOP
    PERFORM public.dryrun145_expect('SCENARIO C anon', '42501',
      'permission denied for function%', v_call);
  END LOOP;
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- D. A SELLER does the whole flow.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO D SETUP FAIL: role is %', get_my_role();
  END IF;

  v_result := create_draft_sale(NULL, 'TEST_S3_' || v_tag, NULL, NULL);
  v_sale := (v_result ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_sale, v_dish, 1, 10.00);
  SELECT id INTO v_line1 FROM sale_lines WHERE sale_id = v_sale;
  PERFORM add_sale_line(v_sale, v_dish, 1, 10.00);
  SELECT id INTO v_line2 FROM sale_lines WHERE sale_id = v_sale AND id <> v_line1;
  PERFORM update_sale_line(v_line1, 2);
  PERFORM delete_sale_line(v_line2);
  PERFORM confirm_sale(v_sale);
  PERFORM set_sale_paid_flag(v_sale, true);
  v_result := get_company_settings();
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)
    )
  );
  v_quick := (v_result ->> 'sale_id')::uuid;
  RESET ROLE;

  SELECT s.status INTO v_status FROM sales s WHERE s.id = v_sale;
  IF v_sale IS NULL OR v_line1 IS NULL OR v_line2 IS NULL
     OR v_status IS NULL OR v_status = 'draft'
     OR (SELECT is_paid FROM sales WHERE id = v_sale) IS NOT TRUE
     OR (SELECT count(*) FROM sale_lines WHERE sale_id = v_sale) <> 1
     OR (SELECT quantity FROM sale_lines WHERE id = v_line1) <> 2
     OR v_result IS NULL
     OR v_quick IS NULL
     OR (SELECT status FROM sales WHERE id = v_quick) = 'draft' THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: sale % status % lines % / % quick %',
      v_sale, v_status, v_line1, v_line2, v_quick;
  END IF;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- E. The owner still sells.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)
    )
  );
  v_owner_sale := (v_result ->> 'sale_id')::uuid;
  RESET ROLE;
  IF v_owner_sale IS NULL OR (SELECT status FROM sales WHERE id = v_owner_sale) = 'draft' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: owner sale %', v_result;
  END IF;

  FOR v_seq IN SELECT * FROM dryrun145_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/145 dry-run: scenarios A-E passed.';
END;
$test$;

ROLLBACK;
