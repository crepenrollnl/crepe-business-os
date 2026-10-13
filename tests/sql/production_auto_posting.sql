-- SQL test: sql/149 — production journals are posted by the database at
-- commit (audit D2/K3 step 3).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/production_auto_posting.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-H passed".
-- The trigger is DEFERRED; the test fires it with SET CONSTRAINTS … IMMEDIATE.
--
-- Scenarios:
--   A — catalog: 6 new/changed functions not callable by clients (a seller
--       gets 42501), deferred trigger, fixed id vectors (same as the app)
--   B — component made from raw materials (10 × 0.30): nothing before commit;
--       Dr 1110 3.00 / Cr 1100 3.00, app memo, UTC date of completed_at,
--       linked to the session's own 'production' transaction (an older
--       decoy transaction of another session is ignored), app's event id
--   C — dish = 1 component (0.30) + 0.1 kg raw (0.15), × 4 = 1.80:
--       Dr 1110 1.80 / Cr 1100 0.60 / Cr 1110 1.20
--   D — rounding: dish of components only whose layers are worth 2.70 but
--       consumed 2.7053 → component credit capped at 2.70, no 1100 line
--   E — cancelled session, and a session where nothing was produced:
--       nothing posted, no failure
--   F — posting again: already_posted, nothing doubles
--   G — no finished-goods account: production stays completed, nothing
--       posted, failure logged with the stable business_event_id
--   H — post_journal_by_roles (write-offs) still uses the one-argument id and
--       leaves transaction_id empty
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun149_session(p_recipe_id uuid, p_qty numeric, p_tag text)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_PR_plan_' || p_tag, CURRENT_DATE, 'ready_to_produce')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_PR_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_PR_' || p_tag, p_qty, 'pcs', 1);

  RETURN v_session;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun149_lines_arg(p_session uuid, p_qty numeric)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_agg(jsonb_build_object('line_id', l.id, 'actual_produced_quantity', p_qty))
  FROM production_session_lines l WHERE l.production_session_id = p_session;
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun149_lines(p_session uuid)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base,
                                     l.debit_transaction, l.credit_transaction) ORDER BY l.line_no)
  FROM journal_entries e
  JOIN journal_lines l ON l.journal_entry_id = e.id
  JOIN accounts a ON a.id = l.account_id
  WHERE e.business_event_id = public.production_posting_event_id(p_session);
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun149_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun149_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun149_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_internal text[] := ARRAY[
    'stable_business_event_id(uuid, text)',
    'post_journal_by_roles_for_event(uuid, uuid, date, text, jsonb)',
    'post_journal_by_roles(text, date, text, jsonb)',
    'production_posting_event_id(uuid)',
    'post_production_journals(uuid)',
    'production_sessions_auto_post_journals()'
  ];
  v_sig text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_comp2 uuid;
  v_dish uuid;
  v_dish2 uuid;
  v_s_comp uuid;
  v_s_dish uuid;
  v_s_dish2 uuid;
  v_s_cancel uuid;
  v_s_zero uuid;
  v_s_fail uuid;
  v_s_layer uuid;
  v_line uuid;
  v_txn uuid;
  v_je journal_entries%ROWTYPE;
  v_result jsonb;
  v_arg jsonb;
  v_count bigint;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun149_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog + vectors.
  -- ------------------------------------------------------------------
  FOREACH v_sig IN ARRAY v_internal
  LOOP
    IF to_regprocedure('public.' || v_sig) IS NULL
       OR has_function_privilege('authenticated', to_regprocedure('public.' || v_sig), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure('public.' || v_sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % missing or callable by clients', v_sig;
    END IF;
  END LOOP;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.production_sessions'::regclass
         AND t.tgname = 'production_sessions_auto_post_journals'
         AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred)
     OR public.production_posting_event_id('00000000-0000-4000-8000-000000000001')
          <> '00804158-d7b6-554b-8cc3-1c7e5d386f1e'::uuid
     OR public.production_posting_event_id('00000000-0000-4000-8000-000000000002')
          <> '9cc3e665-f3aa-50b7-8b15-d38bbc3b0c64'::uuid
     OR public.stable_business_event_id('cogs_recognized:00000000-0000-4000-8000-000000000001')
          <> '16fe6b1e-b18b-5410-ac0f-f9debb82d8d0'::uuid THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: trigger or id vectors wrong';
  END IF;

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
  VALUES ('TEST_PR_ing_' || v_tag, 'kg', 100, 0, 1.50, true) RETURNING id INTO v_ing;
  -- comp: 0.2 kg raw per piece (0.30)
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_PR_comp_' || v_tag, 1, 'pcs', true, 'component') RETURNING id INTO v_comp;
  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_comp, v_ing, 0.2, 'kg');
  -- dish: 1 comp + 0.1 kg raw
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_PR_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00) RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.1, 'kg');
  -- comp2: only a ready layer of 10 × 0.8454 (inserted directly)
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_PR_comp2_' || v_tag, 1, 'pcs', true, 'component') RETURNING id INTO v_comp2;
  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_comp2, v_ing, 0.5, 'kg');
  -- dish2: 0.1 comp2 per piece, nothing else
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_PR_dish2_' || v_tag, 1, 'pcs', true, 'assembly', 10.00) RETURNING id INTO v_dish2;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish2, v_comp2, 0.1, 'pcs');

  v_s_layer := public.dryrun149_session(v_comp2, 10, v_tag || '_layer');
  SELECT id INTO v_line FROM production_session_lines WHERE production_session_id = v_s_layer;
  UPDATE production_session_lines SET actual_produced_quantity = 10 WHERE id = v_line;
  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id,
    recipe_id, produced_quantity, unit_cost, produced_at
  )
  VALUES (v_s_layer, v_line, v_comp2, v_comp2, 10, 0.8454, now() - interval '1 hour');
  UPDATE production_sessions SET status = 'completed', completed_at = now() WHERE id = v_s_layer;

  -- Decoy: an older 'production' transaction of another session.
  INSERT INTO transactions (type, status, reference_type, reference_id, amount, currency,
                            description, occurred_at, posted_at, created_at, updated_at)
  VALUES ('production', 'posted', 'production_session', v_s_layer, 8.45, 'EUR', 'TEST_PR decoy',
          now() - interval '1 day', now() - interval '1 day', now() - interval '1 day',
          now() - interval '1 day');

  v_s_comp := public.dryrun149_session(v_comp, 10, v_tag || '_comp');
  v_s_cancel := public.dryrun149_session(v_comp, 5, v_tag || '_cancel');

  -- ------------------------------------------------------------------
  -- B. Owner completes the component session. Nothing before commit.
  -- ------------------------------------------------------------------
  v_arg := public.dryrun149_lines_arg(v_s_comp, 10);
  SET LOCAL ROLE authenticated;
  PERFORM complete_production_session(v_s_comp, NULL, v_arg, NULL);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = public.production_posting_event_id(v_s_comp)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: posted before commit';
  END IF;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;

  SELECT * INTO v_je FROM journal_entries
  WHERE business_event_id = public.production_posting_event_id(v_s_comp);
  SELECT id INTO v_txn FROM transactions
  WHERE reference_type = 'production_session' AND reference_id = v_s_comp AND type = 'production';
  IF v_je.id IS NULL OR v_je.status <> 'posted' OR v_txn IS NULL
     OR v_je.transaction_id IS DISTINCT FROM v_txn
     OR v_je.entry_date <> ((SELECT completed_at FROM production_sessions WHERE id = v_s_comp)
                            AT TIME ZONE 'UTC')::date
     OR v_je.memo <> 'Production completed: Dr finished_goods_inventory / Cr inventory_asset'
     OR v_je.business_event_id <> public.stable_business_event_id(
          '7c2f0b9e-4a61-5d83-9e10-2b8c4f6a1d35'::uuid, 'production_completed:' || v_s_comp)
     OR public.dryrun149_lines(v_s_comp) IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '1110', 'Finished Goods Inventory', 3.00, 0, 3.00, 0),
          jsonb_build_array(2, '1100', 'Raw Material Inventory', 0, 3.00, 0, 3.00)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: % / %', to_jsonb(v_je), public.dryrun149_lines(v_s_comp);
  END IF;

  -- ------------------------------------------------------------------
  -- C. Dish × 4: components 4 × 0.30 = 1.20, raw 0.4 kg × 1.50 = 0.60.
  -- ------------------------------------------------------------------
  v_s_dish := public.dryrun149_session(v_dish, 4, v_tag || '_dish');
  v_arg := public.dryrun149_lines_arg(v_s_dish, 4);
  SET LOCAL ROLE authenticated;
  PERFORM complete_production_session(v_s_dish, NULL, v_arg, NULL);
  RESET ROLE;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;
  IF (SELECT memo FROM journal_entries
      WHERE business_event_id = public.production_posting_event_id(v_s_dish))
       IS DISTINCT FROM 'Production completed: Dr finished_goods_inventory / Cr inventory_asset + finished_goods_inventory (components)'
     OR public.dryrun149_lines(v_s_dish) IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '1110', 'Finished Goods Inventory', 1.80, 0, 1.80, 0),
          jsonb_build_array(2, '1100', 'Raw Material Inventory', 0, 0.60, 0, 0.60),
          jsonb_build_array(3, '1110', 'Finished Goods Inventory (components used)', 0, 1.20, 0, 1.20)) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: %', public.dryrun149_lines(v_s_dish);
  END IF;

  -- ------------------------------------------------------------------
  -- D. Dish2 × 32: uses 3.2 × 0.8454 = 2.7053 of components, but the new
  --    layer is 32 × 0.0845 = 2.70 → credit capped at 2.70, no 1100 line.
  -- ------------------------------------------------------------------
  v_s_dish2 := public.dryrun149_session(v_dish2, 32, v_tag || '_dish2');
  v_arg := public.dryrun149_lines_arg(v_s_dish2, 32);
  SET LOCAL ROLE authenticated;
  PERFORM complete_production_session(v_s_dish2, NULL, v_arg, NULL);
  RESET ROLE;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;
  IF (SELECT round(SUM(c.total_cost), 4) FROM finished_goods_batch_consumptions c
      JOIN production_session_lines l ON l.id = c.source_id
      WHERE l.production_session_id = v_s_dish2) IS DISTINCT FROM 2.7053
     OR public.dryrun149_lines(v_s_dish2) IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '1110', 'Finished Goods Inventory', 2.70, 0, 2.70, 0),
          jsonb_build_array(2, '1110', 'Finished Goods Inventory (components used)', 0, 2.70, 0, 2.70)) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: %', public.dryrun149_lines(v_s_dish2);
  END IF;

  -- ------------------------------------------------------------------
  -- E. Cancelled session: nothing.
  -- ------------------------------------------------------------------
  UPDATE production_sessions SET status = 'cancelled' WHERE id = v_s_cancel;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;
  IF EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = public.production_posting_event_id(v_s_cancel))
     OR EXISTS (SELECT 1 FROM posting_failures
                WHERE entity_id IN (v_s_cancel, v_s_comp, v_s_dish, v_s_dish2, v_s_layer)) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: cancelled session posted or a failure logged';
  END IF;

  -- ------------------------------------------------------------------
  -- E2. Session where nothing was produced (all quantities 0): no journal,
  --     no failure.
  -- ------------------------------------------------------------------
  v_s_zero := public.dryrun149_session(v_comp, 3, v_tag || '_zero');
  v_arg := public.dryrun149_lines_arg(v_s_zero, 0);
  SET LOCAL ROLE authenticated;
  PERFORM complete_production_session(v_s_zero, NULL, v_arg, NULL);
  RESET ROLE;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;
  IF (SELECT status FROM production_sessions WHERE id = v_s_zero) <> 'completed'
     OR EXISTS (SELECT 1 FROM journal_entries
                WHERE business_event_id = public.production_posting_event_id(v_s_zero))
     OR EXISTS (SELECT 1 FROM posting_failures WHERE entity_id = v_s_zero)
     OR post_production_journals(v_s_zero) ->> 'status' IS DISTINCT FROM 'nothing_to_post' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: zero-quantity session posted or a failure logged';
  END IF;

  -- ------------------------------------------------------------------
  -- F. Posting again changes nothing.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM journal_entries;
  v_result := post_production_journals(v_s_dish);
  IF v_result -> 'results' -> 0 ->> 'status' IS DISTINCT FROM 'already_posted'
     OR (SELECT count(*) FROM journal_entries) <> v_count
     OR (SELECT count(*) FROM journal_entries
         WHERE business_event_id = public.production_posting_event_id(v_s_dish)) <> 1 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- G. No finished-goods account → production stays, failure logged.
  -- ------------------------------------------------------------------
  v_s_fail := public.dryrun149_session(v_comp, 1, v_tag || '_fail');
  UPDATE account_role_bindings SET is_active = false WHERE role = 'finished_goods_inventory';
  v_arg := public.dryrun149_lines_arg(v_s_fail, 1);
  SET LOCAL ROLE authenticated;
  PERFORM complete_production_session(v_s_fail, NULL, v_arg, NULL);
  RESET ROLE;
  SET CONSTRAINTS production_sessions_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS production_sessions_auto_post_journals DEFERRED;
  UPDATE account_role_bindings SET is_active = true WHERE role = 'finished_goods_inventory';
  IF (SELECT status FROM production_sessions WHERE id = v_s_fail) <> 'completed'
     OR NOT EXISTS (SELECT 1 FROM production_batches WHERE production_session_id = v_s_fail)
     OR EXISTS (SELECT 1 FROM journal_entries
                WHERE business_event_id = public.production_posting_event_id(v_s_fail))
     OR NOT EXISTS (
          SELECT 1 FROM posting_failures
          WHERE entity_id = v_s_fail AND entity_type = 'production_session'
            AND source_flow = 'production_complete'
            AND business_event_id = public.production_posting_event_id(v_s_fail)
            AND error_message LIKE 'Automatic posting failed: No active account binding for role finished_goods_inventory%') THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: failure path wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- H. The write-off poster (wrapper) behaves as in sql/148.
  -- ------------------------------------------------------------------
  v_result := post_journal_by_roles('TEST_PR_wrapper:' || v_tag, CURRENT_DATE, 'TEST_PR wrapper',
    jsonb_build_array(
      jsonb_build_object('role', 'waste_expense', 'side', 'debit', 'amount', 0.01, 'description', 'x'),
      jsonb_build_object('role', 'inventory_asset', 'side', 'credit', 'amount', 0.01, 'description', 'y')));
  SELECT * INTO v_je FROM journal_entries
  WHERE business_event_id = stable_business_event_id('TEST_PR_wrapper:' || v_tag);
  IF v_result ->> 'status' IS DISTINCT FROM 'done' OR v_je.id IS NULL
     OR v_je.transaction_id IS NOT NULL OR v_je.memo <> 'TEST_PR wrapper'
     OR post_journal_by_roles('k', CURRENT_DATE, 'm', '[]'::jsonb) ->> 'status'
          IS DISTINCT FROM 'nothing_to_post' THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: % / %', v_result, to_jsonb(v_je);
  END IF;
  PERFORM public.dryrun149_expect('SCENARIO H null key', 'P0001', 'post_journal_by_roles: key, date and lines are required.',
    'SELECT public.post_journal_by_roles(NULL, CURRENT_DATE, ''m'', ''[]''::jsonb)');

  -- A (cont.). A seller cannot reach the new internal functions.
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  FOREACH v_sig IN ARRAY ARRAY[
    format('SELECT public.post_production_journals(%L::uuid)', v_s_comp),
    format('SELECT public.production_posting_event_id(%L::uuid)', v_s_comp),
    'SELECT public.stable_business_event_id(gen_random_uuid(), ''x'')',
    'SELECT public.post_journal_by_roles_for_event(gen_random_uuid(), NULL, CURRENT_DATE, ''m'', ''[]''::jsonb)'
  ]
  LOOP
    PERFORM public.dryrun149_expect('SCENARIO A seller direct call', '42501',
      'permission denied for function%', v_sig);
  END LOOP;
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  FOR v_seq IN SELECT * FROM dryrun149_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/149 dry-run: scenarios A-H passed.';
END;
$test$;

ROLLBACK;
