-- SQL test: sql/147 — confirmed sales get their journals automatically
-- inside the database (audit D2/K3).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/sale_auto_posting.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-F passed".
--
-- The trigger is DEFERRED (fires at commit). The test makes the pending
-- events fire with SET CONSTRAINTS … IMMEDIATE, then defers again.
--
-- Scenarios:
--   A — catalog: the 5 new functions exist, are not callable by clients;
--       public post_journal_proposals keeps its owner/partner check; the
--       trigger is deferred; stable ids equal the app's ids
--   B — a SELLER sells 2 × 10.00: nothing posted before commit; at commit the
--       revenue journal (1010 Dr total / 4000 Cr subtotal / 2100 Cr VAT) and
--       the COGS journal (5000 / 1110, 4.60) are posted with the UTC date of
--       confirmed_at; 5 ledger rows; no failure logged; the seller cannot call
--       any internal function nor post_journal_proposals
--   C — posting again (database or app) answers already_posted, nothing doubles
--   D — 100% discount: no revenue journal, COGS still posted, no failure
--   E — no revenue account → sale stays confirmed, nothing posted, failure
--       logged with the stable business_event_id
--   F — a draft sale is skipped
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun147_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_K3_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_K3_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_K3_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun147_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun147_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun147_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_internal text[] := ARRAY[
    'stable_business_event_id(text)',
    'post_journal_proposals_internal(jsonb, date, timestamp with time zone)',
    'sale_posting_account(text, date)',
    'post_sale_journals(uuid)',
    'sales_auto_post_journals()'
  ];
  v_sig text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_sale uuid;
  v_sale2 uuid;
  v_sale3 uuid;
  v_s sales%ROWTYPE;
  v_rev_id uuid;
  v_cogs_id uuid;
  v_rev journal_entries%ROWTYPE;
  v_cogs journal_entries%ROWTYPE;
  v_date date;
  v_count bigint;
  v_result jsonb;
  v_lines jsonb;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun147_seq SELECT %L::regclass, last_value, is_called FROM %s',
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
       OR NOT (SELECT prosecdef OR proname = 'stable_business_event_id' FROM pg_proc
               WHERE oid = to_regprocedure('public.' || v_sig)) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % missing, not definer, or callable by clients', v_sig;
    END IF;
  END LOOP;
  IF position('PERFORM require_role(''owner'', ''partner'');' IN
       (SELECT prosrc FROM pg_proc
        WHERE oid = to_regprocedure('public.post_journal_proposals(jsonb, date, timestamp with time zone)'))) = 0 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: public post_journal_proposals lost its role check';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.sales'::regclass AND t.tgname = 'sales_auto_post_journals'
      AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred
  ) THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: deferred trigger sales_auto_post_journals missing';
  END IF;
  -- Same ids as src/features/sales/utils/stable-business-event-id.ts.
  IF stable_business_event_id('sale_completed:00000000-0000-4000-8000-000000000001')
       <> 'c0a54b67-7e60-576f-b0c0-8fd8de2d1f52'::uuid
     OR stable_business_event_id('cogs_recognized:00000000-0000-4000-8000-000000000001')
       <> '16fe6b1e-b18b-5410-ac0f-f9debb82d8d0'::uuid THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: stable_business_event_id differs from the app';
  END IF;

  -- ------------------------------------------------------------------
  -- Signed-in owner/partner + test data.
  -- Dish = 1 component (FIFO batch @ 2.00) + 0.2 kg @ 1.50 → COGS 2.30.
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
  VALUES ('TEST_K3_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_K3_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun147_batch(v_comp, 20, 2.00, v_tag);
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_K3_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- ------------------------------------------------------------------
  -- B. A SELLER sells 2 dishes; at commit the journals appear by themselves.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  v_sale := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 2, 'unit_price', 10.00)))
    ->> 'sale_id')::uuid;
  -- A seller cannot reach any of the internal pieces, nor post a journal himself.
  FOREACH v_sig IN ARRAY ARRAY[
    format('SELECT public.post_sale_journals(%L::uuid)', v_sale),
    'SELECT public.stable_business_event_id(''x'')',
    'SELECT public.sale_posting_account(''revenue'', CURRENT_DATE)',
    'SELECT public.post_journal_proposals_internal(''[]''::jsonb, CURRENT_DATE, now())'
  ]
  LOOP
    PERFORM public.dryrun147_expect('SCENARIO B seller direct call', '42501',
      'permission denied for function%', v_sig);
  END LOOP;
  PERFORM public.dryrun147_expect('SCENARIO B seller post_journal_proposals', '42501',
    'Insufficient permissions%',
    'SELECT public.post_journal_proposals(''[]''::jsonb, CURRENT_DATE, now())');
  RESET ROLE;

  -- Nothing is posted before commit (deferred trigger)…
  v_rev_id := stable_business_event_id('sale_completed:' || v_sale);
  v_cogs_id := stable_business_event_id('cogs_recognized:' || v_sale);
  IF EXISTS (SELECT 1 FROM journal_entries WHERE business_event_id IN (v_rev_id, v_cogs_id)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: journals were posted before commit';
  END IF;
  -- …and fire exactly as at commit.
  SET CONSTRAINTS sales_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS sales_auto_post_journals DEFERRED;

  SELECT * INTO v_s FROM sales WHERE id = v_sale;
  v_date := (v_s.confirmed_at AT TIME ZONE 'UTC')::date;
  SELECT * INTO v_rev FROM journal_entries WHERE business_event_id = v_rev_id;
  SELECT * INTO v_cogs FROM journal_entries WHERE business_event_id = v_cogs_id;

  IF v_rev.id IS NULL OR v_rev.status <> 'posted' OR v_rev.posting_number IS NULL
     OR v_rev.entry_date <> v_date
     OR v_rev.memo <> 'Sale completed: Dr accounts_receivable / Cr revenue / Cr vat_output' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: revenue journal %', to_jsonb(v_rev);
  END IF;
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base)
                   ORDER BY l.line_no)
  INTO v_lines
  FROM journal_lines l JOIN accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_rev.id;
  IF v_lines IS DISTINCT FROM jsonb_build_array(
       jsonb_build_array(1, '1010', 'Accounts Receivable', v_s.total, 0),
       jsonb_build_array(2, '4000', 'Sales Revenue', 0, v_s.subtotal),
       jsonb_build_array(3, '2100', 'VAT Output', 0, v_s.tax_total))
     OR v_s.total <> 20.00 OR v_s.subtotal + v_s.tax_total <> v_s.total THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: revenue lines % for sale %', v_lines, to_jsonb(v_s);
  END IF;

  IF v_cogs.id IS NULL OR v_cogs.entry_date <> v_date
     OR v_cogs.memo <> 'COGS recognized: Dr cogs / Cr finished_goods_inventory' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: cogs journal %', to_jsonb(v_cogs);
  END IF;
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base)
                   ORDER BY l.line_no)
  INTO v_lines
  FROM journal_lines l JOIN accounts a ON a.id = l.account_id
  WHERE l.journal_entry_id = v_cogs.id;
  IF v_lines IS DISTINCT FROM jsonb_build_array(
       jsonb_build_array(1, '5000', 'Cost of Goods Sold', 4.60, 0),
       jsonb_build_array(2, '1110', 'Finished Goods Inventory', 0, 4.60)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: cogs lines %', v_lines;
  END IF;

  SELECT count(*) INTO v_count FROM ledger_entries
  WHERE journal_entry_id IN (v_rev.id, v_cogs.id) AND entry_date = v_date;
  IF v_count <> 5 OR EXISTS (SELECT 1 FROM posting_failures WHERE entity_id = v_sale) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: % ledger rows, or a posting failure was logged', v_count;
  END IF;

  -- ------------------------------------------------------------------
  -- C. Posting twice is impossible: the database and the app share the id.
  -- ------------------------------------------------------------------
  v_result := post_sale_journals(v_sale);
  IF (SELECT count(*) FROM jsonb_array_elements(v_result -> 'results') r
      WHERE r ->> 'status' = 'already_posted') <> 2
     OR (SELECT count(*) FROM journal_entries WHERE business_event_id IN (v_rev_id, v_cogs_id)) <> 2 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: %', v_result;
  END IF;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  -- The app (owner) posting the same sale afterwards gets already_posted.
  v_result := post_journal_proposals(
    jsonb_build_array(jsonb_build_object(
      'journal_entry', jsonb_build_object(
        'id', gen_random_uuid(), 'business_event_id', v_rev_id,
        'fiscal_period_id', v_rev.fiscal_period_id, 'memo', 'app retry',
        'transaction_currency', v_rev.transaction_currency,
        'base_currency', v_rev.base_currency, 'exchange_rate', 1),
      'journal_lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid())))),
    v_date, now());
  RESET ROLE;
  IF v_result -> 0 ->> 'status' IS DISTINCT FROM 'already_posted' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: app re-post returned %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- D. 100% discount: no revenue journal, COGS still recognised.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  v_sale2 := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_discount_type => 'percent',
    p_discount_value => 100)
    ->> 'sale_id')::uuid;
  RESET ROLE;
  SET CONSTRAINTS sales_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS sales_auto_post_journals DEFERRED;
  IF EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = stable_business_event_id('sale_completed:' || v_sale2))
     OR NOT EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = stable_business_event_id('cogs_recognized:' || v_sale2))
     OR EXISTS (SELECT 1 FROM posting_failures WHERE entity_id = v_sale2) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: free sale journals wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- E. Posting fails (no revenue account) → sale stays confirmed, nothing
  --    half-posted, the failure is logged with the stable id.
  -- ------------------------------------------------------------------
  UPDATE account_role_bindings SET is_active = false WHERE role = 'revenue';
  SET LOCAL ROLE authenticated;
  v_sale3 := (create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)))
    ->> 'sale_id')::uuid;
  RESET ROLE;
  SET CONSTRAINTS sales_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS sales_auto_post_journals DEFERRED;
  UPDATE account_role_bindings SET is_active = true WHERE role = 'revenue';
  IF (SELECT status FROM sales WHERE id = v_sale3) NOT IN ('confirmed', 'paid')
     OR EXISTS (SELECT 1 FROM journal_entries WHERE business_event_id IN (
          stable_business_event_id('sale_completed:' || v_sale3),
          stable_business_event_id('cogs_recognized:' || v_sale3)))
     OR NOT EXISTS (
          SELECT 1 FROM posting_failures
          WHERE entity_id = v_sale3 AND entity_type = 'sale' AND source_flow = 'sale_confirm'
            AND business_event_id = stable_business_event_id('sale_completed:' || v_sale3)
            AND error_message LIKE 'Automatic posting failed: No active account binding for role revenue%') THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: failure path wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- F. A draft is skipped.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  v_sale := (create_draft_sale(NULL, 'TEST_K3_' || v_tag, NULL, NULL) ->> 'sale_id')::uuid;
  RESET ROLE;
  IF post_sale_journals(v_sale) ->> 'status' IS DISTINCT FROM 'skipped' THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: draft was not skipped';
  END IF;

  FOR v_seq IN SELECT * FROM dryrun147_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/147 dry-run: scenarios A-F passed.';
END;
$test$;

ROLLBACK;
