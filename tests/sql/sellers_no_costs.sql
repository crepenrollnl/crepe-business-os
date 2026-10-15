-- SQL test: sql/156 — the database stops giving sellers costs
-- (audit S4/U5 phase 2b + the rest of S2).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/sellers_no_costs.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-F passed".
--
-- Scenarios:
--   A — catalog: the 4 report RPCs carry the sql/156 owner/partner guard
--       (and no sql/145 line); close_shift, confirm_sale and
--       create_and_confirm_sale carry exactly one /* sql/156 */ expression;
--       the 8 cost tables have exactly one read policy, owner/partner;
--       record_posting_failure is executable by nobody in the app;
--       global_search reads the sql/155 views, not the cost reports.
--   B — OWNER: sees every row of the 8 tables; gets total_cogs from
--       create_and_confirm_sale (also on a replay) and confirm_sale, and
--       profit_summary from close_shift; may call the 4 report RPCs.
--   C — SELLER: sees 0 rows in each of the 8 tables (all have rows);
--       still sees the same quantities through the sql/155 views and the
--       same global_search rows as the owner; the 4 report RPCs and
--       record_posting_failure are refused; sells (quick sale, replay,
--       draft + confirm) and closes the shift normally, but total_cogs and
--       profit_summary come back null while the costs are still booked.
--   D — PARTNER: same reads as the owner.
--   E — no active profile: the 4 report RPCs refuse, the tables read empty.
--   F — anon: no EXECUTE on the 4 report RPCs and record_posting_failure.
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun156_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_156_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_156_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_156_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun156_expect(
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

-- Row counts of the 8 cost tables as the CURRENT user (RLS applies).
CREATE OR REPLACE FUNCTION public.dryrun156_counts()
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_t text;
  v_n bigint;
  v_out jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['ingredients', 'production_batches',
    'finished_goods_batch_consumptions', 'stock_movements', 'write_offs',
    'inventory_adjustments', 'shift_daily_profit_summaries', 'transactions']
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_t) INTO v_n;
    v_out := v_out || jsonb_build_object(v_t, v_n);
  END LOOP;
  RETURN v_out;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun156_expect(text, text, text, text),
                          public.dryrun156_counts()
  TO authenticated, anon;

CREATE TEMP TABLE dryrun156_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;
CREATE TEMP TABLE dryrun156_gs_owner ON COMMIT DROP AS
  SELECT * FROM public.global_search WHERE false;
GRANT ALL ON dryrun156_gs_owner TO authenticated;
-- The CI replay creates suppliers and purchases without the table grants
-- live Supabase gives them (RLS decides who sees rows there).
-- global_search reads both, so grant them here (rolled back) to model the
-- live database.
GRANT SELECT ON public.suppliers, public.purchases TO authenticated;

DO $test$
DECLARE
  v_report_rpcs text[] := ARRAY[
    'get_reporting_workspace()',
    'get_sales_by_product(timestamp with time zone, timestamp with time zone)',
    'verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric)',
    'get_inventory_movement_history_by_ingredient(uuid)'
  ];
  v_masked text[] := ARRAY[
    'close_shift(uuid, text)',
    'confirm_sale(uuid)',
    'create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)'
  ];
  v_tables text[] := ARRAY['ingredients', 'production_batches',
    'finished_goods_batch_consumptions', 'stock_movements', 'write_offs',
    'inventory_adjustments', 'shift_daily_profit_summaries', 'transactions'];
  v_rpf constant text := 'record_posting_failure(text, text, uuid, uuid, text)';
  v_report_calls text[];
  v_sig text;
  v_oid oid;
  v_t text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_batch uuid;
  v_req1 uuid := gen_random_uuid();
  v_req2 uuid := gen_random_uuid();
  v_result jsonb;
  v_sale uuid;
  v_sale2 uuid;
  v_draft uuid;
  v_shift uuid;
  v_all jsonb;
  v_counts jsonb;
  v_n bigint;
  v_qty numeric;
  v_stock_pg numeric;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun156_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  FOREACH v_sig IN ARRAY v_report_rpcs
  LOOP
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
       OR (SELECT count(*) FROM pg_proc p,
             regexp_matches(p.prosrc, 'PERFORM require_role\(''owner'', ''partner''\);  -- sql/156', 'g')
           WHERE p.oid = v_oid) <> 1
       OR (SELECT prosrc FROM pg_proc WHERE oid = v_oid) LIKE '%sql/145%'
       OR (SELECT prosrc FROM pg_proc WHERE oid = v_oid) LIKE '%''seller''%'
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % guard / definer / grants wrong', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_masked
  LOOP
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
       OR (SELECT count(*) FROM pg_proc p, regexp_matches(p.prosrc, '/\* sql/156 \*/', 'g')
           WHERE p.oid = v_oid) <> 1
       OR (SELECT count(*) FROM pg_proc p,
             regexp_matches(p.prosrc,
               'CASE WHEN public\.get_my_role\(\) IN \(''owner'', ''partner''\) THEN', 'g')
           WHERE p.oid = v_oid) <> 1 THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % cost masking wrong', v_sig;
    END IF;
  END LOOP;

  FOREACH v_t IN ARRAY v_tables
  LOOP
    IF (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = v_t AND cmd IN ('SELECT', 'ALL')) <> 1
       OR NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = v_t
           AND policyname = v_t || '_owner_partner_select'
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
           AND roles = ARRAY['authenticated']::name[]
           AND qual = '(get_my_role() = ANY (ARRAY[''owner''::text, ''partner''::text]))')
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_t)::regclass) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % read policy wrong', v_t;
    END IF;
  END LOOP;

  v_oid := to_regprocedure('public.' || v_rpf);
  IF v_oid IS NULL
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: record_posting_failure still executable from the app';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.global_search'::regclass
                 AND reloptions @> ARRAY['security_invoker=true'])
     OR (SELECT array_agg(DISTINCT s.relname::text ORDER BY s.relname::text)
         FROM pg_rewrite r
         JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
         JOIN pg_class s ON s.oid = d.refobjid
         WHERE r.ev_class = 'public.global_search'::regclass AND s.oid <> r.ev_class)
        IS DISTINCT FROM ARRAY['customers', 'finished_goods_stock_summary',
          'ingredient_stock_levels', 'recipes', 'report_purchase_summary',
          'report_sales_summary', 'suppliers'] THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: global_search sources/options wrong';
  END IF;

  SELECT array_agg(format('SELECT public.%I(%s)', p.proname,
           COALESCE((SELECT string_agg('NULL::' || format_type(t.typ, NULL), ', ' ORDER BY t.ord)
                     FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS t(typ, ord)), '')))
  INTO v_report_calls
  FROM unnest(v_report_rpcs) s JOIN pg_proc p ON p.oid = to_regprocedure('public.' || s);

  -- ------------------------------------------------------------------
  -- Signed-in owner + test data (one row in each of the 8 tables).
  -- ------------------------------------------------------------------
  UPDATE shifts SET status = 'closed', closed_at = now() WHERE status = 'open';

  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_actor;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_156_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_156_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  v_batch := public.dryrun156_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_156_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  INSERT INTO transactions (type, status, reference_type, amount, description)
  VALUES ('expense', 'posted', 'manual', 1.00, 'TEST_156_' || v_tag);

  -- ------------------------------------------------------------------
  -- B. OWNER.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  v_shift := (open_shift('TEST_156_' || v_tag) ->> 'id')::uuid;

  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_client_request_id => v_req1);
  v_sale := (v_result ->> 'sale_id')::uuid;
  IF jsonb_typeof(v_result -> 'total_cogs') IS DISTINCT FROM 'number'
     OR (v_result ->> 'total_cogs')::numeric <= 0 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner quick sale result %', v_result;
  END IF;
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_client_request_id => v_req1);
  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_sale
     OR jsonb_typeof(v_result -> 'total_cogs') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner replay result %', v_result;
  END IF;

  v_draft := (create_draft_sale(NULL, 'TEST_156_' || v_tag, NULL, NULL) ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_draft, v_dish, 1, 10.00);
  v_result := confirm_sale(v_draft);
  IF jsonb_typeof(v_result -> 'total_cogs') IS DISTINCT FROM 'number'
     OR (v_result ->> 'total_cogs')::numeric <= 0 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner confirm_sale result %', v_result;
  END IF;

  PERFORM record_write_off('ingredient', v_ing, NULL, 1, 'spoilage', 'TEST_156_' || v_tag);
  PERFORM record_inventory_adjustment(v_ing, 'increase', 1, 'physical_count', 'TEST_156_' || v_tag);

  v_result := close_shift(v_shift, NULL);
  IF jsonb_typeof(v_result -> 'profit_summary') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result -> 'sales_summary') IS DISTINCT FROM 'object'
     OR (v_result -> 'profit_summary' ->> 'total_cogs')::numeric <= 0 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner close_shift result %', v_result;
  END IF;

  PERFORM get_reporting_workspace();
  PERFORM get_sales_by_product(now() - interval '1 day', now() + interval '1 day');
  PERFORM verify_sale_cost_and_profit(v_sale, 0, 0, 0, 0);
  PERFORM get_inventory_movement_history_by_ingredient(v_ing);

  v_counts := public.dryrun156_counts();
  INSERT INTO dryrun156_gs_owner SELECT * FROM public.global_search WHERE search_text LIKE '%' || v_tag || '%';
  RESET ROLE;

  SELECT current_stock INTO v_stock_pg FROM ingredients WHERE id = v_ing;
  v_all := public.dryrun156_counts();
  FOREACH v_t IN ARRAY v_tables
  LOOP
    IF (v_all ->> v_t)::bigint < 1 THEN
      RAISE EXCEPTION 'SCENARIO B SETUP FAIL: no rows in %', v_t;
    END IF;
  END LOOP;
  IF v_counts IS DISTINCT FROM v_all THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner sees % of %', v_counts, v_all;
  END IF;
  IF (SELECT count(*) FROM dryrun156_gs_owner WHERE entity_type IN ('ingredient', 'finished_good')) <> 2
     OR NOT EXISTS (SELECT 1 FROM dryrun156_gs_owner
                    WHERE entity_type = 'ingredient' AND entity_id = v_ing AND status = 'ok')
     OR NOT EXISTS (SELECT 1 FROM dryrun156_gs_owner
                    WHERE entity_type = 'finished_good' AND entity_id = v_comp AND status = 'available') THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner global_search rows wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- C. SELLER.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO C SETUP FAIL: role is %', get_my_role();
  END IF;

  v_counts := public.dryrun156_counts();
  FOREACH v_t IN ARRAY v_tables
  LOOP
    IF (v_counts ->> v_t)::bigint <> 0 THEN
      RAISE EXCEPTION 'SCENARIO C FAIL: seller sees % row(s) of %', v_counts ->> v_t, v_t;
    END IF;
  END LOOP;

  SELECT current_stock INTO v_qty FROM ingredient_stock_levels WHERE id = v_ing;
  IF v_qty IS DISTINCT FROM v_stock_pg THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller ingredient_stock_levels % (expected %)', v_qty, v_stock_pg;
  END IF;
  SELECT available_quantity INTO v_qty FROM finished_goods_stock_summary WHERE product_id = v_comp;
  IF v_qty IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller finished goods stock % (expected 8)', v_qty;
  END IF;

  IF EXISTS (SELECT * FROM global_search WHERE search_text LIKE '%' || v_tag || '%'
             EXCEPT ALL SELECT * FROM dryrun156_gs_owner)
     OR EXISTS (SELECT * FROM dryrun156_gs_owner
                EXCEPT ALL SELECT * FROM global_search WHERE search_text LIKE '%' || v_tag || '%') THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller global_search differs from the owner''s';
  END IF;

  FOREACH v_sig IN ARRAY v_report_calls
  LOOP
    PERFORM public.dryrun156_expect('SCENARIO C seller report', '42501',
      'Insufficient permissions%', v_sig);
  END LOOP;
  PERFORM public.dryrun156_expect('SCENARIO C seller report (real args)', '42501',
    'Insufficient permissions%',
    format('SELECT public.get_inventory_movement_history_by_ingredient(%L::uuid)', v_ing));
  PERFORM public.dryrun156_expect('SCENARIO C seller record_posting_failure', '42501',
    'permission denied for function%',
    format('SELECT public.record_posting_failure(%L, %L, %L::uuid, NULL, %L)',
           'sale_confirm', 'sale', v_sale, 'TEST_156'));

  -- Sales: quick sale (auto-opens a shift), its replay, the owner's replay,
  -- and a draft confirmed — all succeed, none returns a cost.
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_client_request_id => v_req2);
  v_sale2 := (v_result ->> 'sale_id')::uuid;
  IF v_sale2 IS NULL OR (v_result -> 'total_cogs') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller quick sale result %', v_result;
  END IF;
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_client_request_id => v_req2);
  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_sale2
     OR (v_result -> 'total_cogs') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller replay result %', v_result;
  END IF;
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 10.00)),
    p_client_request_id => v_req1);
  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_sale
     OR (v_result -> 'total_cogs') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller replay of the owner''s sale %', v_result;
  END IF;
  v_draft := (create_draft_sale(NULL, 'TEST_156_s_' || v_tag, NULL, NULL) ->> 'sale_id')::uuid;
  PERFORM add_sale_line(v_draft, v_dish, 1, 10.00);
  v_result := confirm_sale(v_draft);
  IF (v_result ->> 'sale_id')::uuid IS DISTINCT FROM v_draft
     OR (v_result -> 'total_cogs') IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller confirm_sale result %', v_result;
  END IF;

  SELECT id INTO v_shift FROM shifts WHERE status = 'open';
  v_result := close_shift(v_shift, NULL);
  IF (v_result -> 'profit_summary') IS DISTINCT FROM 'null'::jsonb
     OR jsonb_typeof(v_result -> 'sales_summary') IS DISTINCT FROM 'object'
     OR (v_result -> 'shift' ->> 'status') IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller close_shift result %', v_result;
  END IF;
  RESET ROLE;

  -- The costs are still booked and the summary still stored.
  IF (SELECT status FROM sales WHERE id = v_sale2) NOT IN ('confirmed', 'paid')
     OR (SELECT status FROM sales WHERE id = v_draft) NOT IN ('confirmed', 'paid')
     OR COALESCE(compute_sale_total_cogs(v_sale2), 0) <= 0
     OR COALESCE(compute_sale_total_cogs(v_draft), 0) <= 0
     OR NOT EXISTS (SELECT 1 FROM shift_daily_profit_summaries
                    WHERE shift_id = v_shift AND total_cogs > 0) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller sales/summary not booked';
  END IF;
  SELECT current_stock INTO v_qty FROM ingredients WHERE id = v_ing;
  IF v_qty IS DISTINCT FROM (100 - 0.2 * 4 - 1 + 1) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: ingredient stock % (expected 99.2)', v_qty;
  END IF;

  -- ------------------------------------------------------------------
  -- D. PARTNER reads like the owner.
  -- ------------------------------------------------------------------
  v_all := public.dryrun156_counts();
  UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  v_counts := public.dryrun156_counts();
  PERFORM get_reporting_workspace();
  PERFORM get_inventory_movement_history_by_ingredient(v_ing);
  RESET ROLE;
  IF v_counts IS DISTINCT FROM v_all THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: partner sees % of %', v_counts, v_all;
  END IF;

  -- ------------------------------------------------------------------
  -- E. No active profile.
  -- ------------------------------------------------------------------
  UPDATE profiles SET is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  FOREACH v_sig IN ARRAY v_report_calls
  LOOP
    PERFORM public.dryrun156_expect('SCENARIO E no profile', '42501',
      'No active profile%', v_sig);
  END LOOP;
  v_counts := public.dryrun156_counts();
  RESET ROLE;
  FOREACH v_t IN ARRAY v_tables
  LOOP
    IF (v_counts ->> v_t)::bigint <> 0 THEN
      RAISE EXCEPTION 'SCENARIO E FAIL: no-profile user sees rows of %', v_t;
    END IF;
  END LOOP;
  UPDATE profiles SET is_active = true, role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- F. anon.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  FOREACH v_sig IN ARRAY v_report_calls || ARRAY['SELECT public.record_posting_failure(NULL::text, NULL::text, NULL::uuid, NULL::uuid, NULL::text)']
  LOOP
    PERFORM public.dryrun156_expect('SCENARIO F anon', '42501',
      'permission denied for function%', v_sig);
  END LOOP;
  RESET ROLE;

  FOR v_seq IN SELECT * FROM dryrun156_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/156 test: scenarios A-F passed.';
END;
$test$;

ROLLBACK;
