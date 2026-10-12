-- SQL test: sql/138 — direct client writes closed on 17 tables (audit S1, step 1).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/rls_close_direct_writes_step1.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-G passed".
--
-- Scenarios:
--   A — catalog: 15 tables have exactly one SELECT policy, authenticated has
--       SELECT only, anon nothing; production_orders/items have no policy and
--       no privileges
--   B — as a signed-in owner, direct INSERT/UPDATE/DELETE/TRUNCATE on all 17
--       tables is refused (42501 permission denied)
--   C — SELECT still returns every row (15 tables); legacy tables unreadable
--   D — owner record_write_off still writes write_offs + stock_movements
--   E — a SELLER still sells: create_and_confirm_sale writes sales, sale_lines,
--       FIFO consumptions and the ingredient sale_out movement
--   F — a seller cannot write customers / sale_lines directly, and since
--       sql/144 cannot call create_customer either
--   G — anon can neither read nor write
-- Sequence counters (sale / batch / customer numbers) are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun138_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_S1_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_S1_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_S1_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun138_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun138_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun138_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_read_tables text[] := ARRAY[
    'currencies', 'currency_rates',
    'tax_categories', 'tax_definitions', 'tax_jurisdictions',
    'tax_rates', 'tax_rules', 'tax_types',
    'transactions', 'stock_movements', 'production_batches',
    'finished_goods_batch_consumptions', 'write_offs',
    'sale_lines', 'customers'
  ];
  v_legacy_tables text[] := ARRAY['production_orders', 'production_items'];
  v_table text;
  v_col text;
  v_seq record;
  v_count integer;
  v_count_owner bigint;
  v_count_auth bigint;
  v_counts jsonb := '{}'::jsonb;
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_result jsonb;
  v_sale uuid;
  v_status text;
BEGIN
  -- Sequence snapshot (restored at the end).
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun138_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog: policies and privileges are exactly as intended.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_read_tables
  LOOP
    SELECT count(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_table;
    IF v_count <> 1 OR NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
        AND policyname = v_table || '_authenticated_select'
        AND cmd = 'SELECT' AND roles = ARRAY['authenticated']::name[] AND qual = 'true'
    ) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % policies wrong (% policies)', v_table, v_count;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || v_table)::regclass) THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: RLS off on %', v_table;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
       OR has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: privileges wrong on %', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_legacy_tables
  LOOP
    SELECT count(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_table;
    IF v_count <> 0
       OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: legacy table % not fully closed', v_table;
    END IF;
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
  VALUES ('TEST_S1_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun138_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_S1_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  -- Row counts as the table owner (after the test data exists), for scenario C.
  FOREACH v_table IN ARRAY v_read_tables
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count_owner;
    v_counts := v_counts || jsonb_build_object(v_table, v_count_owner);
  END LOOP;

  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- B. Direct INSERT / UPDATE / DELETE / TRUNCATE are refused on all 17
  --    tables, even for owner/partner.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_read_tables || v_legacy_tables
  LOOP
    SELECT a.attname INTO v_col
    FROM pg_attribute a
    WHERE a.attrelid = ('public.' || v_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum LIMIT 1;

    PERFORM public.dryrun138_expect('SCENARIO B insert ' || v_table, '42501', 'permission denied%',
      format('INSERT INTO public.%I DEFAULT VALUES', v_table));
    PERFORM public.dryrun138_expect('SCENARIO B update ' || v_table, '42501', 'permission denied%',
      format('UPDATE public.%I SET %I = %I WHERE false', v_table, v_col, v_col));
    PERFORM public.dryrun138_expect('SCENARIO B delete ' || v_table, '42501', 'permission denied%',
      format('DELETE FROM public.%I WHERE false', v_table));
    PERFORM public.dryrun138_expect('SCENARIO B truncate ' || v_table, '42501', 'permission denied%',
      format('TRUNCATE public.%I', v_table));
  END LOOP;

  -- ------------------------------------------------------------------
  -- C. Reading still works and sees every row (15 tables); the 2 legacy
  --    tables are not readable.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_read_tables
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count_auth;
    IF v_count_auth IS DISTINCT FROM (v_counts ->> v_table)::bigint THEN
      RAISE EXCEPTION 'SCENARIO C FAIL: % — authenticated sees % rows, owner %',
        v_table, v_count_auth, v_counts ->> v_table;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY v_legacy_tables
  LOOP
    PERFORM public.dryrun138_expect('SCENARIO C legacy ' || v_table, '42501', 'permission denied%',
      format('SELECT count(*) FROM public.%I', v_table));
  END LOOP;

  -- ------------------------------------------------------------------
  -- D. Owner write-off through the RPC still writes write_offs +
  --    stock_movements.
  -- ------------------------------------------------------------------
  v_result := record_write_off('ingredient', v_ing, NULL, 1, 'spoilage', 'TEST_S1');
  RESET ROLE;
  SELECT count(*) INTO v_count FROM write_offs WHERE id = (v_result ->> 'id')::uuid;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM stock_movements
    WHERE ingredient_id = v_ing AND movement_type = 'waste_out'
  ) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: write-off rows % / result %', v_count, v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- E. A SELLER still sells: create_and_confirm_sale writes sales,
  --    sale_lines, FIFO consumptions and the ingredient stock movement.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO E SETUP FAIL: role is %', get_my_role();
  END IF;

  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 2, 'unit_price', 10.00)
    )
  );
  v_sale := (v_result ->> 'sale_id')::uuid;

  RESET ROLE;
  SELECT status INTO v_status FROM sales WHERE id = v_sale;
  IF v_status IS NULL OR v_status = 'draft'
     OR (SELECT count(*) FROM sale_lines WHERE sale_id = v_sale) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM finished_goods_batch_consumptions c
       WHERE c.source_id = v_sale
          OR c.source_id IN (SELECT l.id FROM sale_lines l WHERE l.sale_id = v_sale)
     )
     OR NOT EXISTS (
       SELECT 1 FROM stock_movements
       WHERE ingredient_id = v_ing AND movement_type = 'sale_out'
     ) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: sale % status % result %', v_sale, v_status, v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- F. A seller cannot write customers or sale_lines directly. Since
  --    sql/144 the create_customer RPC is closed to signed-in users too.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun138_expect('SCENARIO F seller create_customer', '42501',
    'permission denied for function%',
    format('SELECT public.create_customer(%L, NULL, NULL, NULL, NULL)', 'TEST_S1_customer_' || v_tag));
  PERFORM public.dryrun138_expect('SCENARIO F seller customers', '42501', 'permission denied%',
    format('UPDATE public.customers SET name = name WHERE name = %L', 'TEST_S1_customer_' || v_tag));
  PERFORM public.dryrun138_expect('SCENARIO F seller sale_lines', '42501', 'permission denied%',
    format('DELETE FROM public.sale_lines WHERE sale_id = %L', v_sale));
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM customers WHERE name = 'TEST_S1_customer_' || v_tag) THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: a customer row was written';
  END IF;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- G. anon cannot read or write.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM public.dryrun138_expect('SCENARIO G anon select', '42501', 'permission denied%',
    'SELECT count(*) FROM public.stock_movements');
  PERFORM public.dryrun138_expect('SCENARIO G anon insert', '42501', 'permission denied%',
    'INSERT INTO public.tax_rates DEFAULT VALUES');
  RESET ROLE;

  -- Put sequence counters back.
  FOR v_seq IN SELECT * FROM dryrun138_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/138 dry-run: scenarios A-G passed.';
END;
$test$;

ROLLBACK;
