-- SQL test: sql/144 — client EXECUTE closed on 56 internal / unused
-- SECURITY DEFINER functions (audit S2 + S3, step 1).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1 outside the reviewed dry-run file.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/revoke_internal_and_unused_rpcs.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-F passed".
--
-- Scenarios:
--   A — catalog: all 56 functions exist; no overload is executable by anon
--       or authenticated
--   B — catalog: the RPCs the app does call are still executable by
--       authenticated (guards against revoking too much)
--   C — a SELLER still sells with a header discount: create_and_confirm_sale
--       runs create_draft_sale, add_sale_line, recalculate_sale_commercial_totals,
--       apply_sale_header_discount, confirm_sale, allocate_finished_goods_fifo
--       and compute_sale_total_cogs internally
--   D — a seller calling any of the 56 directly gets 42501 (includes the S3
--       hole: allocate_finished_goods_fifo with reason 'sale')
--   E — an OWNER calling any of the 56 directly gets 42501, while owner flows
--       that use them internally still work: post_journal_proposals
--       (verify_journal_posting_amounts + allocate_posting_number) and
--       get_recipe_cost_detail (explode_component_recipe_leaves)
--   F — anon calling any of the 56 gets 42501
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun144_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S2_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S2_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S2_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun144_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun144_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun144_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_names text[] := ARRAY[
    -- internal helpers
    'allocate_finished_goods_fifo', 'apply_sale_header_discount',
    'recalculate_sale_commercial_totals', 'compute_sale_total_cogs',
    'allocate_posting_number', 'explode_component_recipe_leaves',
    'is_nested_component_recipe', 'verify_journal_posting_amounts',
    -- old admin RPCs
    'create_user', 'update_user', 'deactivate_user', 'create_role', 'assign_role',
    'create_backup_record', 'complete_backup_record', 'list_backups',
    'create_import_job', 'update_import_job_progress', 'complete_import_job',
    'list_import_jobs', 'create_export_job', 'update_export_job_progress',
    'complete_export_job', 'list_export_jobs',
    -- customers
    'create_customer', 'update_customer', 'deactivate_customer',
    -- unused dashboards / reports
    'get_alerts_dashboard', 'get_audit_dashboard', 'get_company_dashboard',
    'get_dashboard_navigation', 'get_executive_dashboard', 'get_inventory_dashboard',
    'get_kpi_dashboard', 'get_production_dashboard', 'get_reporting_home',
    'get_reporting_overview', 'get_reporting_section', 'get_user_activity_dashboard',
    'get_application_info', 'get_system_health', 'get_customer_sales_analytics',
    'get_customer_sales_analytics_by_customer', 'get_inventory_valuation',
    'get_inventory_item_value', 'get_inventory_movement_history',
    'get_purchase_price_history', 'get_purchase_price_history_by_ingredient',
    'get_recipe_cost', 'get_recipe_cost_analysis', 'get_sales_trends',
    'get_sales_trend_summary', 'get_supplier_performance',
    'get_supplier_performance_by_supplier', 'verify_daily_sales_summary',
    'verify_daily_profit_summary'
  ];
  v_keep text[] := ARRAY[
    'create_and_confirm_sale', 'create_draft_sale', 'add_sale_line',
    'update_sale_line', 'delete_sale_line', 'confirm_sale', 'set_sale_paid_flag',
    'mark_sale_queued', 'mark_sale_fulfilled', 'record_posting_failure',
    'resolve_posting_failure', 'get_company_settings', 'verify_sale_cost_and_profit',
    'get_inventory_movement_history_by_ingredient', 'get_reporting_workspace',
    'get_sales_by_product', 'get_my_role', 'require_role', 'open_shift',
    'close_shift', 'reconcile_shift_cash', 'record_write_off',
    'record_dish_write_off', 'post_journal_proposals', 'record_expense',
    'complete_production_session', 'confirm_production_plan',
    'get_recipe_cost_report', 'get_recipe_cost_detail', 'create_supplier',
    'get_profit_and_loss', 'get_btw_report'
  ];
  v_calls text[];
  v_call text;
  v_name text;
  v_count integer;
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
  v_row record;
  v_period uuid;
  v_acc1 uuid;
  v_acc2 uuid;
  v_je uuid := gen_random_uuid();
  v_l1 uuid := gen_random_uuid();
  v_l2 uuid := gen_random_uuid();
  v_posted jsonb;
BEGIN
  -- Sequence snapshot (restored at the end).
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun144_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. All 56 exist; no overload executable by anon / authenticated.
  -- ------------------------------------------------------------------
  IF cardinality(v_names) <> 56 THEN
    RAISE EXCEPTION 'SCENARIO A SETUP FAIL: % names in the list', cardinality(v_names);
  END IF;
  FOREACH v_name IN ARRAY v_names
  LOOP
    SELECT count(*) INTO v_count FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = v_name;
    IF v_count = 0 THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: function % not found', v_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name
        AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR has_function_privilege('anon', p.oid, 'EXECUTE'))
    ) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % still executable by anon/authenticated', v_name;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- B. RPCs the app calls stay executable by authenticated.
  -- ------------------------------------------------------------------
  FOREACH v_name IN ARRAY v_keep
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name
    ) OR EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'SCENARIO B FAIL: % missing or not executable by authenticated', v_name;
    END IF;
  END LOOP;

  -- One call per overload of the 56, all arguments NULL (the privilege check
  -- runs before the body, so NULLs never reach it).
  SELECT array_agg(
    format('SELECT public.%I(%s)', p.proname,
      COALESCE((
        SELECT string_agg('NULL::' || format_type(t.typ, NULL), ', ' ORDER BY t.ord)
        FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS t(typ, ord)
      ), ''))
    ORDER BY p.proname)
  INTO v_calls
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_names);

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
  VALUES ('TEST_S2_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S2_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  v_batch := public.dryrun144_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S2_dish_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  SELECT id INTO v_period FROM fiscal_periods
  WHERE status = 'open' AND CURRENT_DATE BETWEEN start_date AND end_date
  ORDER BY start_date LIMIT 1;
  SELECT id INTO v_acc1 FROM accounts
  WHERE is_active AND is_postable ORDER BY code LIMIT 1;
  SELECT id INTO v_acc2 FROM accounts
  WHERE is_active AND is_postable AND id <> v_acc1 ORDER BY code LIMIT 1;
  IF v_period IS NULL OR v_acc1 IS NULL OR v_acc2 IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: open fiscal period % / accounts % %', v_period, v_acc1, v_acc2;
  END IF;

  -- ------------------------------------------------------------------
  -- C. A SELLER sells with a 10% header discount.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO C SETUP FAIL: role is %', get_my_role();
  END IF;

  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 2, 'unit_price', 10.00)
    ),
    p_discount_type => 'percent',
    p_discount_value => 10
  );
  v_sale := (v_result ->> 'sale_id')::uuid;

  -- ------------------------------------------------------------------
  -- D. The seller cannot call any of the 56 directly.
  -- ------------------------------------------------------------------
  FOREACH v_call IN ARRAY v_calls
  LOOP
    PERFORM public.dryrun144_expect('SCENARIO D seller', '42501',
      'permission denied for function%', v_call);
  END LOOP;
  -- The S3 hole, with real arguments: reason 'sale' skips the role check
  -- inside the function, so only the revoke stops this.
  PERFORM public.dryrun144_expect('SCENARIO D seller fifo sale', '42501',
    'permission denied for function%',
    format('SELECT public.allocate_finished_goods_fifo(%L::uuid, 1, %L, %L, %L::uuid, NULL, NULL)',
           v_comp, 'sale', 'sale', gen_random_uuid()));
  RESET ROLE;

  SELECT s.status, s.discount_amount, s.total INTO v_row FROM sales s WHERE s.id = v_sale;
  IF v_row.status IS NULL OR v_row.status = 'draft'
     OR v_row.discount_amount IS DISTINCT FROM 2.00
     OR v_row.total IS DISTINCT FROM 18.00
     OR (SELECT count(*) FROM sale_lines WHERE sale_id = v_sale) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM finished_goods_batch_consumptions c
       WHERE c.production_batch_id = v_batch
     )
     OR NOT EXISTS (
       SELECT 1 FROM stock_movements
       WHERE ingredient_id = v_ing AND movement_type = 'sale_out'
     )
     OR COALESCE((v_result ->> 'total_cogs')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: sale % row % result %', v_sale, to_jsonb(v_row), v_result;
  END IF;
  IF (SELECT count(*) FROM finished_goods_batch_consumptions c WHERE c.production_batch_id = v_batch) <> 1 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: the fixture batch was consumed outside the sale';
  END IF;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- E. The owner cannot call any of the 56 directly, but owner flows that
  --    use them internally still work.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  IF get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION 'SCENARIO E SETUP FAIL: role is %', get_my_role();
  END IF;

  FOREACH v_call IN ARRAY v_calls
  LOOP
    PERFORM public.dryrun144_expect('SCENARIO E owner', '42501',
      'permission denied for function%', v_call);
  END LOOP;

  v_posted := post_journal_proposals(
    jsonb_build_array(jsonb_build_object(
      'journal_entry', jsonb_build_object(
        'id', v_je, 'business_event_id', gen_random_uuid(),
        'fiscal_period_id', v_period, 'memo', 'TEST_S2_144_' || v_tag,
        'transaction_currency', 'EUR', 'base_currency', 'EUR', 'exchange_rate', 1),
      'journal_lines', jsonb_build_array(
        jsonb_build_object('id', v_l1, 'line_no', 1, 'account_id', v_acc1,
          'description', 'TEST_S2', 'debit_transaction', 1.00, 'credit_transaction', 0,
          'debit_base', 1.00, 'credit_base', 0),
        jsonb_build_object('id', v_l2, 'line_no', 2, 'account_id', v_acc2,
          'description', 'TEST_S2', 'debit_transaction', 0, 'credit_transaction', 1.00,
          'debit_base', 0, 'credit_base', 1.00)),
      'ledger_entries', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'journal_line_id', v_l1,
          'account_id', v_acc1, 'debit_base', 1.00, 'credit_base', 0,
          'debit_transaction', 1.00, 'credit_transaction', 0),
        jsonb_build_object('id', gen_random_uuid(), 'journal_line_id', v_l2,
          'account_id', v_acc2, 'debit_base', 0, 'credit_base', 1.00,
          'debit_transaction', 0, 'credit_transaction', 1.00))
    )),
    CURRENT_DATE,
    now()
  );
  IF v_posted -> 0 ->> 'status' IS DISTINCT FROM 'posted_now'
     OR v_posted -> 0 ->> 'posting_number' IS NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: post_journal_proposals returned %', v_posted;
  END IF;

  v_result := get_recipe_cost_detail(v_dish);
  RESET ROLE;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: get_recipe_cost_detail returned NULL';
  END IF;
  IF (SELECT status FROM journal_entries WHERE id = v_je) IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: test journal % not posted', v_je;
  END IF;

  -- ------------------------------------------------------------------
  -- F. anon cannot call any of the 56.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  FOREACH v_call IN ARRAY v_calls
  LOOP
    PERFORM public.dryrun144_expect('SCENARIO F anon', '42501',
      'permission denied for function%', v_call);
  END LOOP;
  RESET ROLE;

  -- Put sequence counters back.
  FOR v_seq IN SELECT * FROM dryrun144_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/144 dry-run: scenarios A-F passed (% direct calls checked per role).',
    cardinality(v_calls);
END;
$test$;

ROLLBACK;
