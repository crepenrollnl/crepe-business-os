-- SQL test: sql/148 — write-off journals are posted by the database at
-- commit (audit D2/K3 step 2).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/write_off_auto_posting.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-G passed".
-- The trigger is DEFERRED; the test fires it with SET CONSTRAINTS … IMMEDIATE.
--
-- Scenarios:
--   A — catalog: 4 new functions not callable by clients (a seller gets 42501),
--       deferred trigger, write_offs.dish_write_off_id, record_dish_write_off
--       still owner/partner-only and callable by authenticated
--   B — ingredient write-off 1.50: Dr 6150 / Cr 1100, same amount on
--       transaction and base side, UTC date of created_at, memo
--   C — finished-good write-off 2.00: Dr 6150 / Cr 1110
--   D — dish × 2: both rows share one dish_write_off_id; one journal per item
--       type (finished goods 4.00, ingredients 0.60)
--   E — sub-cent write-off (0.3 g × 0.01 = 0.003): no journal, no failure
--   F — posting again: already_posted, nothing doubles
--   G — no waste account: write-off stays, nothing posted, failure logged
--       with the stable business_event_id
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun148_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_WO_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_WO_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_WO_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun148_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun148_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun148_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_internal text[] := ARRAY[
    'post_journal_by_roles(text, date, text, jsonb)',
    'write_off_posting_key(uuid)',
    'post_write_off_journals(uuid)',
    'write_offs_auto_post_journals()'
  ];
  v_sig text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_cheap uuid;
  v_comp uuid;
  v_dish uuid;
  v_wo_ing uuid;
  v_wo_fg uuid;
  v_wo_cheap uuid;
  v_wo_fail uuid;
  v_dish_result jsonb;
  v_group uuid;
  v_date date;
  v_je journal_entries%ROWTYPE;
  v_lines jsonb;
  v_result jsonb;
  v_count bigint;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun148_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  FOREACH v_sig IN ARRAY v_internal
  LOOP
    IF to_regprocedure('public.' || v_sig) IS NULL
       OR has_function_privilege('authenticated', to_regprocedure('public.' || v_sig), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure('public.' || v_sig), 'EXECUTE')
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.' || v_sig)) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % missing, not definer, or callable by clients', v_sig;
    END IF;
  END LOOP;
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid = 'public.write_offs'::regclass AND t.tgname = 'write_offs_auto_post_journals'
         AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred)
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'write_offs' AND column_name = 'dish_write_off_id')
     OR (SELECT position('PERFORM require_role(''owner'', ''partner'');' IN prosrc) FROM pg_proc
         WHERE oid = to_regprocedure('public.record_dish_write_off(uuid, numeric, text, text)')) = 0
     OR NOT has_function_privilege('authenticated',
         to_regprocedure('public.record_dish_write_off(uuid, numeric, text, text)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: trigger / column / record_dish_write_off guard or grant wrong';
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
  VALUES ('TEST_WO_ing_' || v_tag, 'kg', 100, 0, 1.50, true) RETURNING id INTO v_ing;
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_WO_cheap_' || v_tag, 'g', 100, 0, 0.01, true) RETURNING id INTO v_cheap;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_WO_comp_' || v_tag, 1, 'pcs', true, 'component') RETURNING id INTO v_comp;
  PERFORM public.dryrun148_batch(v_comp, 10, 2.00, v_tag);
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_WO_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00) RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- ------------------------------------------------------------------
  -- B–E. Owner writes off: an ingredient, a finished good, a dish ×2,
  --      and a sub-cent ingredient. Nothing is posted before commit.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  v_wo_ing := (record_write_off('ingredient', v_ing, NULL, 1, 'spoilage', 'TEST_WO') ->> 'id')::uuid;
  v_wo_fg := (record_write_off('finished_good', NULL, v_comp, 1, 'spoilage', 'TEST_WO') ->> 'id')::uuid;
  v_dish_result := record_dish_write_off(v_dish, 2, 'staff_use', 'TEST_WO');
  v_wo_cheap := (record_write_off('ingredient', v_cheap, NULL, 0.3, 'spoilage', 'TEST_WO') ->> 'id')::uuid;
  -- A seller cannot reach the new internal functions.
  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  FOREACH v_sig IN ARRAY ARRAY[
    format('SELECT public.post_write_off_journals(%L::uuid)', v_wo_ing),
    format('SELECT public.write_off_posting_key(%L::uuid)', v_wo_ing),
    'SELECT public.post_journal_by_roles(''x'', CURRENT_DATE, ''m'', ''[]''::jsonb)'
  ]
  LOOP
    PERFORM public.dryrun148_expect('SCENARIO A seller direct call', '42501',
      'permission denied for function%', v_sig);
  END LOOP;
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  IF EXISTS (SELECT 1 FROM journal_entries WHERE memo LIKE 'Write-off:%'
             AND business_event_id IN (
               stable_business_event_id('waste_recognized:' || v_wo_ing),
               stable_business_event_id('waste_recognized:' || v_wo_fg))) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: posted before commit';
  END IF;
  SET CONSTRAINTS write_offs_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS write_offs_auto_post_journals DEFERRED;

  -- B. Single ingredient write-off: 1 kg × 1.50.
  v_date := ((SELECT created_at FROM write_offs WHERE id = v_wo_ing) AT TIME ZONE 'UTC')::date;
  SELECT * INTO v_je FROM journal_entries
  WHERE business_event_id = stable_business_event_id('waste_recognized:' || v_wo_ing);
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base,
                                     l.debit_transaction, l.credit_transaction) ORDER BY l.line_no)
  INTO v_lines
  FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = v_je.id;
  IF v_je.id IS NULL OR v_je.status <> 'posted' OR v_je.entry_date <> v_date
     OR v_je.memo <> 'Write-off: Dr waste_expense / Cr inventory_asset'
     OR v_lines IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '6150', 'Waste & Spoilage', 1.50, 0, 1.50, 0),
          jsonb_build_array(2, '1100', 'Raw Material Inventory', 0, 1.50, 0, 1.50)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: % / %', to_jsonb(v_je), v_lines;
  END IF;

  -- C. Finished good: 1 × 2.00 → 1110.
  SELECT * INTO v_je FROM journal_entries
  WHERE business_event_id = stable_business_event_id('waste_recognized:' || v_wo_fg);
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base)
                   ORDER BY l.line_no)
  INTO v_lines
  FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.journal_entry_id = v_je.id;
  IF v_je.id IS NULL
     OR v_je.memo <> 'Write-off: Dr waste_expense / Cr finished_goods_inventory'
     OR v_lines IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '6150', 'Waste & Spoilage', 2.00, 0),
          jsonb_build_array(2, '1110', 'Finished Goods Inventory', 0, 2.00)) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: % / %', to_jsonb(v_je), v_lines;
  END IF;

  -- D. Dish × 2: one id on both rows, one journal per item type
  --    (finished goods 2 × 2.00 = 4.00; ingredient 0.4 kg × 1.50 = 0.60).
  SELECT min(w.dish_write_off_id::text)::uuid, count(DISTINCT w.dish_write_off_id), count(*)
  INTO v_group, v_count, v_count
  FROM write_offs w
  WHERE w.id IN (SELECT (r ->> 'id')::uuid FROM jsonb_array_elements(v_dish_result -> 'write_offs') r);
  IF v_group IS NULL
     OR (SELECT count(DISTINCT w.dish_write_off_id) FROM write_offs w
         WHERE w.id IN (SELECT (r ->> 'id')::uuid FROM jsonb_array_elements(v_dish_result -> 'write_offs') r)) <> 1
     OR (SELECT count(*) FROM write_offs WHERE dish_write_off_id = v_group) <> 2
     OR (SELECT dish_write_off_id FROM write_offs WHERE id = v_wo_ing) IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: dish_write_off_id not set as one group';
  END IF;
  IF (SELECT l.debit_base FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
      WHERE e.business_event_id = stable_business_event_id('waste_recognized:dish:finished_good:' || v_group)
        AND l.line_no = 1) IS DISTINCT FROM 4.00
     OR (SELECT l.debit_base FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
      WHERE e.business_event_id = stable_business_event_id('waste_recognized:dish:ingredient:' || v_group)
        AND l.line_no = 1) IS DISTINCT FROM 0.60
     OR (SELECT count(*) FROM journal_entries WHERE business_event_id IN (
          stable_business_event_id('waste_recognized:dish:finished_good:' || v_group),
          stable_business_event_id('waste_recognized:dish:ingredient:' || v_group))) <> 2 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: dish journals wrong';
  END IF;

  -- E. Sub-cent write-off (0.3 × 0.01 = 0.003): no journal, no failure.
  IF EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = stable_business_event_id('waste_recognized:' || v_wo_cheap))
     OR EXISTS (SELECT 1 FROM posting_failures
                WHERE entity_id IN (v_wo_ing, v_wo_fg, v_wo_cheap)
                   OR entity_id IN (SELECT id FROM write_offs WHERE dish_write_off_id = v_group)) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: sub-cent posted or a failure logged';
  END IF;

  -- ------------------------------------------------------------------
  -- F. Posting again changes nothing.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM journal_entries;
  v_result := post_write_off_journals(v_wo_ing);
  IF v_result -> 'results' -> 0 ->> 'status' IS DISTINCT FROM 'already_posted'
     OR (SELECT count(*) FROM journal_entries) <> v_count
     OR post_write_off_journals(v_wo_cheap) ->> 'status' IS DISTINCT FROM 'nothing_to_post' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- G. No waste account → write-off stays, nothing posted, failure logged.
  -- ------------------------------------------------------------------
  UPDATE account_role_bindings SET is_active = false WHERE role = 'waste_expense';
  SET LOCAL ROLE authenticated;
  v_wo_fail := (record_write_off('ingredient', v_ing, NULL, 2, 'spoilage', 'TEST_WO') ->> 'id')::uuid;
  RESET ROLE;
  SET CONSTRAINTS write_offs_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS write_offs_auto_post_journals DEFERRED;
  UPDATE account_role_bindings SET is_active = true WHERE role = 'waste_expense';
  IF NOT EXISTS (SELECT 1 FROM write_offs WHERE id = v_wo_fail)
     OR EXISTS (SELECT 1 FROM journal_entries
                WHERE business_event_id = stable_business_event_id('waste_recognized:' || v_wo_fail))
     OR NOT EXISTS (
          SELECT 1 FROM posting_failures
          WHERE entity_id = v_wo_fail AND entity_type = 'write_off' AND source_flow = 'write_off_record'
            AND business_event_id = stable_business_event_id('waste_recognized:' || v_wo_fail)
            AND error_message LIKE 'Automatic posting failed: No active account binding for role waste_expense%') THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: failure path wrong';
  END IF;

  FOR v_seq IN SELECT * FROM dryrun148_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/148 dry-run: scenarios A-G passed.';
END;
$test$;

ROLLBACK;
