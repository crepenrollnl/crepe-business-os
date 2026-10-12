-- SQL test: sql/146 — the sale line price always comes from
-- recipes.selling_price (audit D4).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/sale_price_from_recipe.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-G passed".
--
-- Scenarios (all as a signed-in SELLER unless noted):
--   A — catalog: add_sale_line is SECURITY DEFINER, keeps the sql/145 role
--       line exactly once, carries the sql/146 marker; authenticated may
--       EXECUTE, anon may not
--   B — POS / Quick Sale path: create_and_confirm_sale with the right price
--       stores selling_price; with a 10% header discount unit_price stays the
--       catalog price and only the totals drop
--   C — a different price is refused, both through add_sale_line and through
--       create_and_confirm_sale (0.00, 0.01 and 99.00); the failed quick sale
--       leaves no sale behind
--   D — p_unit_price NULL → the catalog price is used
--   E — a dish without selling_price and a component (no price) are refused
--   F — the owner is held to the same rule (no manual price for anyone)
--   G — a signed-in user without an active profile still gets 42501 first
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun146_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_D4_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_D4_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_D4_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun146_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun146_expect(text, text, text, text)
  TO authenticated, anon;

CREATE TEMP TABLE dryrun146_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_oid oid := to_regprocedure('public.add_sale_line(uuid, uuid, numeric, numeric)');
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_noprice uuid;
  v_result jsonb;
  v_sale uuid;
  v_draft uuid;
  v_sales_before bigint;
  v_row record;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun146_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  IF v_oid IS NULL
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
     OR (SELECT count(*) FROM pg_proc p,
           regexp_matches(p.prosrc,
             'PERFORM require_role\(''owner'', ''partner'', ''seller''\);  -- sql/145', 'g')
         WHERE p.oid = v_oid) <> 1
     OR (SELECT position('-- sql/146' IN prosrc) FROM pg_proc WHERE oid = v_oid) = 0
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: add_sale_line definition / guard / grants wrong';
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
  VALUES ('TEST_D4_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_D4_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  PERFORM public.dryrun146_batch(v_comp, 20, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_D4_dish_' || v_tag, 1, 'pcs', true, 'assembly', 8.50)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_D4_noprice_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_noprice;
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_noprice, v_ing, 0.2, 'kg');

  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SETUP FAIL: role is %', get_my_role();
  END IF;

  -- ------------------------------------------------------------------
  -- B. Right price → stored; 10% header discount keeps unit_price.
  -- ------------------------------------------------------------------
  v_result := create_and_confirm_sale(
    p_customer_id => NULL,
    p_lines => jsonb_build_array(
      jsonb_build_object('product_id', v_dish, 'quantity', 2, 'unit_price', 8.50)),
    p_discount_type => 'percent',
    p_discount_value => 10
  );
  v_sale := (v_result ->> 'sale_id')::uuid;
  SELECT s.status, s.total, s.discount_amount, l.unit_price, l.line_total
  INTO v_row
  FROM sales s JOIN sale_lines l ON l.sale_id = s.id
  WHERE s.id = v_sale;
  IF v_row.status = 'draft' OR v_row.unit_price IS DISTINCT FROM 8.50
     OR v_row.total IS DISTINCT FROM 15.30 OR v_row.discount_amount IS DISTINCT FROM 1.70
     OR v_row.line_total IS DISTINCT FROM 15.30 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: %', to_jsonb(v_row);
  END IF;

  -- ------------------------------------------------------------------
  -- C. Any other price is refused.
  -- ------------------------------------------------------------------
  v_draft := (create_draft_sale(NULL, 'TEST_D4_' || v_tag, NULL, NULL) ->> 'sale_id')::uuid;
  PERFORM public.dryrun146_expect('SCENARIO C add 0.00', 'P0001',
    'The price of "TEST_D4_dish_%" is now €8.50. Refresh the screen and try again.',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 0.00)', v_draft, v_dish));
  PERFORM public.dryrun146_expect('SCENARIO C add 0.01', 'P0001', 'The price of %',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 0.01)', v_draft, v_dish));
  PERFORM public.dryrun146_expect('SCENARIO C add 8.00 (old price)', 'P0001', 'The price of %',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 8.00)', v_draft, v_dish));
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM sale_lines WHERE sale_id = v_draft) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: a refused line was written';
  END IF;
  SELECT count(*) INTO v_sales_before FROM sales;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun146_expect('SCENARIO C quick 99.00', 'P0001', 'The price of %',
    format('SELECT create_and_confirm_sale(NULL, %L::jsonb)',
      jsonb_build_array(jsonb_build_object('product_id', v_dish, 'quantity', 1, 'unit_price', 99.00))));
  RESET ROLE;
  IF (SELECT count(*) FROM sales) <> v_sales_before THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: the refused quick sale left a sale behind';
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- D. No client price → catalog price.
  -- ------------------------------------------------------------------
  PERFORM add_sale_line(v_draft, v_dish, 3, NULL);
  RESET ROLE;
  SELECT unit_price, line_total INTO v_row FROM sale_lines WHERE sale_id = v_draft;
  IF v_row.unit_price IS DISTINCT FROM 8.50 OR v_row.line_total IS DISTINCT FROM 25.50 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: %', to_jsonb(v_row);
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- E. No selling price → refused (dish without price, component).
  -- ------------------------------------------------------------------
  PERFORM public.dryrun146_expect('SCENARIO E dish without price', 'P0001',
    '"TEST_D4_noprice_%" has no selling price. Set it in Recipes.',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, NULL)', v_draft, v_noprice));
  PERFORM public.dryrun146_expect('SCENARIO E component', 'P0001', '% has no selling price.%',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 2.00)', v_draft, v_comp));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- F. The owner is held to the same rule.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun146_expect('SCENARIO F owner other price', 'P0001', 'The price of %',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 5.00)', v_draft, v_dish));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- G. No active profile → 42501 before anything else.
  -- ------------------------------------------------------------------
  UPDATE profiles SET is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun146_expect('SCENARIO G no profile', '42501', 'No active profile%',
    format('SELECT add_sale_line(%L::uuid, %L::uuid, 1, 8.50)', v_draft, v_dish));
  RESET ROLE;
  UPDATE profiles SET is_active = true WHERE auth_user_id = v_actor;

  FOR v_seq IN SELECT * FROM dryrun146_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/146 dry-run: scenarios A-G passed.';
END;
$test$;

ROLLBACK;
