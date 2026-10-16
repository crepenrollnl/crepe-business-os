-- SQL test: sql/157 — write-off requests (seller asks, owner/partner approves).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/write_off_requests.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-G passed".
--
-- Scenarios:
--   A — catalog: table RLS on, authenticated may only SELECT, anon nothing;
--       the list view runs as the caller and has no cost column; the 3 RPCs
--       are SECURITY DEFINER, authenticated may call them, anon may not.
--   B — a SELLER requests an ingredient, a finished good and a dish:
--       3 pending rows, no stock / write-off / batch change; a retry with the
--       same client_request_id returns the same request; the seller cannot
--       write the table directly and cannot approve or reject.
--   C — a SECOND seller sees none of the first seller's requests.
--   D — bad requests are refused (type, item, quantity, reason, note,
--       a dish asked as finished good and the other way round).
--   E — the OWNER sees all, approves the ingredient with a corrected
--       quantity (stock and write_offs follow the corrected quantity),
--       approves the finished good and the dish as asked (FIFO batch use,
--       one dish_write_off_id), rejects the 4th with a note (no stock change).
--       Deciding twice is refused.
--   F — a write-off that cannot be booked (ingredient without cost) makes
--       the approval fail and leaves the request pending, stock untouched.
--   G — no active profile / anon are refused; the seller sees the decisions
--       in the list view.
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun157_batch(
  p_recipe_id uuid, p_qty numeric, p_unit_cost numeric, p_tag text
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_plan uuid; v_plan_product uuid; v_session uuid; v_line uuid; v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_157_plan_' || p_tag, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (v_plan, p_recipe_id, 'TEST_157_comp_' || p_tag, p_qty, 1, 'pcs', 1)
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (v_session, v_plan_product, p_recipe_id, 'TEST_157_comp_' || p_tag,
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

CREATE OR REPLACE FUNCTION public.dryrun157_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun157_expect(text, text, text, text) TO authenticated, anon;

CREATE TEMP TABLE dryrun157_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_rpcs text[] := ARRAY[
    'request_write_off(text, uuid, numeric, text, text, uuid)',
    'approve_write_off_request(uuid, numeric)',
    'reject_write_off_request(uuid, text)'
  ];
  v_sig text;
  v_oid oid;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_seller2 uuid;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_ing uuid;
  v_ing_nocost uuid;
  v_comp uuid;
  v_dish uuid;
  v_batch uuid;
  v_token uuid := gen_random_uuid();
  v_r_ing uuid;
  v_r_fg uuid;
  v_r_dish uuid;
  v_r_rej uuid;
  v_r_nocost uuid;
  v_result jsonb;
  v_n bigint;
  v_wo_before bigint;
  v_cons_before bigint;
  v_stock numeric;
  v_row record;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun157_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.write_off_requests'::regclass)
     OR (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.write_off_requests'::regclass)
     OR NOT has_table_privilege('authenticated', 'public.write_off_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.write_off_requests', 'INSERT')
     OR has_table_privilege('authenticated', 'public.write_off_requests', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.write_off_requests', 'DELETE')
     OR has_table_privilege('authenticated', 'public.write_off_requests', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.write_off_requests', 'SELECT')
     OR (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'write_off_requests') <> 1 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: write_off_requests RLS / privileges / policies wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.write_off_request_list'::regclass
                 AND reloptions @> ARRAY['security_invoker=true'])
     OR NOT has_table_privilege('authenticated', 'public.write_off_request_list', 'SELECT')
     OR has_table_privilege('anon', 'public.write_off_request_list', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public.write_off_request_list'::regclass AND attnum > 0
                  AND attname ~ '(cost|value|price|total)')
     OR EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public.write_off_requests'::regclass AND attnum > 0
                  AND attname ~ '(cost|value|price|total)') THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: list view options / privileges / columns wrong';
  END IF;
  FOREACH v_sig IN ARRAY v_rpcs
  LOOP
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
       -- the first statement is the role guard: sellers only for request_write_off
       OR (SELECT count(*) FROM pg_proc p, regexp_matches(p.prosrc, 'require_role\(', 'g')
           WHERE p.oid = v_oid) <> 1
       OR position(CASE WHEN v_sig LIKE 'request_write_off(%'
                     THEN 'PERFORM require_role(''owner'', ''partner'', ''seller'');'
                     ELSE 'PERFORM require_role(''owner'', ''partner'');' END
                   IN (SELECT prosrc FROM pg_proc WHERE oid = v_oid)) = 0
       OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % definer / grants wrong', v_sig;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- Fixtures (as the owner) + a second seller.
  -- ------------------------------------------------------------------
  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_actor;

  -- Second seller: another existing profile turned into a seller inside
  -- this transaction, or (CI replay, one profile only) a stub user.
  SELECT p.auth_user_id INTO v_seller2 FROM profiles p
  WHERE p.auth_user_id <> v_actor ORDER BY p.auth_user_id LIMIT 1;
  IF v_seller2 IS NULL THEN
    v_seller2 := gen_random_uuid();
    INSERT INTO auth.users (id) VALUES (v_seller2);
    INSERT INTO profiles (auth_user_id, role, is_active) VALUES (v_seller2, 'seller', true);
  ELSE
    UPDATE profiles SET role = 'seller', is_active = true WHERE auth_user_id = v_seller2;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_157_ing_' || v_tag, 'kg', 100, 0, 1.50, true)
  RETURNING id INTO v_ing;
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_157_nocost_' || v_tag, 'kg', 50, 0, 0, true)
  RETURNING id INTO v_ing_nocost;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_157_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  v_batch := public.dryrun157_batch(v_comp, 10, 2.00, v_tag);

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role, selling_price)
  VALUES ('TEST_157_dish_' || v_tag, 1, 'pcs', true, 'assembly', 10.00)
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs');
  INSERT INTO recipe_components (assembly_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_dish, v_ing, 0.2, 'kg');

  SELECT count(*) INTO v_wo_before FROM write_offs;
  SELECT count(*) INTO v_cons_before FROM finished_goods_batch_consumptions;

  -- ------------------------------------------------------------------
  -- B. SELLER requests.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO B SETUP FAIL: role is %', get_my_role();
  END IF;

  v_result := request_write_off('ingredient', v_ing, 3, 'spoilage', '  sour milk  ', v_token);
  v_r_ing := (v_result ->> 'id')::uuid;
  IF v_result ->> 'status' IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: %', v_result;
  END IF;
  v_result := request_write_off('ingredient', v_ing, 99, 'theft', NULL, v_token);
  IF (v_result ->> 'id')::uuid IS DISTINCT FROM v_r_ing THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: retry with the same token made a new request %', v_result;
  END IF;
  v_r_fg := (request_write_off('finished_good', v_comp, 2, 'damaged') ->> 'id')::uuid;
  v_r_dish := (request_write_off('dish', v_dish, 1, 'quality_reject', 'dropped') ->> 'id')::uuid;
  v_r_rej := (request_write_off('ingredient', v_ing, 5, 'other', 'not sure') ->> 'id')::uuid;
  v_r_nocost := (request_write_off('ingredient', v_ing_nocost, 1, 'spoilage') ->> 'id')::uuid;

  SELECT count(*) INTO v_n FROM write_off_request_list
  WHERE id IN (v_r_ing, v_r_fg, v_r_dish, v_r_rej, v_r_nocost)
    AND status = 'pending' AND is_mine AND item_name LIKE 'TEST_157_%';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: seller sees % of 5 own pending requests in the list', v_n;
  END IF;
  SELECT * INTO v_row FROM write_off_request_list WHERE id = v_r_ing;
  IF v_row.item_name IS DISTINCT FROM 'TEST_157_ing_' || v_tag OR v_row.unit IS DISTINCT FROM 'kg'
     OR v_row.quantity IS DISTINCT FROM 3.000 OR v_row.note IS DISTINCT FROM 'sour milk' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: list row %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM write_off_request_list WHERE id = v_r_dish;
  IF v_row.item_name IS DISTINCT FROM 'TEST_157_dish_' || v_tag OR v_row.unit IS DISTINCT FROM 'pcs' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: dish list row %', row_to_json(v_row);
  END IF;

  PERFORM public.dryrun157_expect('SCENARIO B seller insert', '42501', 'permission denied%',
    format('INSERT INTO public.write_off_requests (item_type, ingredient_id, quantity, reason, requested_by) VALUES (%L, %L::uuid, 1, %L, %L::uuid)',
           'ingredient', v_ing, 'other', v_actor));
  PERFORM public.dryrun157_expect('SCENARIO B seller update', '42501', 'permission denied%',
    format('UPDATE public.write_off_requests SET status = %L WHERE id = %L::uuid', 'approved', v_r_ing));
  PERFORM public.dryrun157_expect('SCENARIO B seller approve', '42501', 'Insufficient permissions%',
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_ing));
  PERFORM public.dryrun157_expect('SCENARIO B seller reject', '42501', 'Insufficient permissions%',
    format('SELECT public.reject_write_off_request(%L::uuid)', v_r_ing));
  RESET ROLE;

  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  IF v_stock IS DISTINCT FROM 100.000
     OR (SELECT count(*) FROM write_offs) <> v_wo_before
     OR (SELECT count(*) FROM finished_goods_batch_consumptions) <> v_cons_before THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: a request changed stock or write-offs';
  END IF;

  -- ------------------------------------------------------------------
  -- C. A second seller sees none of them; the token is not theirs.
  -- ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_seller2::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_seller2::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM write_off_request_list
  WHERE id IN (v_r_ing, v_r_fg, v_r_dish, v_r_rej, v_r_nocost);
  IF v_n <> 0 OR (SELECT count(*) FROM write_off_requests
                  WHERE id IN (v_r_ing, v_r_fg, v_r_dish, v_r_rej, v_r_nocost)) <> 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: second seller sees % request(s)', v_n;
  END IF;
  PERFORM public.dryrun157_expect('SCENARIO C foreign token', 'P0001', 'This request token belongs to another user.',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L, NULL, %L::uuid)',
           'ingredient', v_ing, 'other', v_token));
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  -- ------------------------------------------------------------------
  -- D. Bad requests (still the first seller).
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun157_expect('SCENARIO D1 type', 'P0001', 'Choose what to write off%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'batch', v_ing, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D2 no item', 'P0001', 'Choose the item%',
    format('SELECT public.request_write_off(%L, NULL, 1, %L)', 'ingredient', 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D3 zero', 'P0001', '%greater than zero%',
    format('SELECT public.request_write_off(%L, %L::uuid, 0, %L)', 'ingredient', v_ing, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D4 too big', 'P0001', 'Quantity must be between%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1001, %L)', 'ingredient', v_ing, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D5 rounds to zero', 'P0001', 'Quantity must be between%',
    format('SELECT public.request_write_off(%L, %L::uuid, 0.0001, %L)', 'ingredient', v_ing, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D6 reason', 'P0001', 'Write-off reason is invalid.',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'ingredient', v_ing, 'lost'));
  PERFORM public.dryrun157_expect('SCENARIO D7 unknown ingredient', 'P0001', 'Ingredient was not found.',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'ingredient', gen_random_uuid(), 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D8 component as dish', 'P0001', 'This is not a dish%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'dish', v_comp, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D9 dish as finished good', 'P0001', 'This is a dish%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'finished_good', v_dish, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D10 unknown product', 'P0001', 'Product was not found.',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'dish', gen_random_uuid(), 'other'));
  PERFORM public.dryrun157_expect('SCENARIO D11 long note', 'P0001', 'Note is too long%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L, %L)', 'ingredient', v_ing, 'other', repeat('x', 501)));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- E. OWNER decides.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM write_off_request_list
  WHERE id IN (v_r_ing, v_r_fg, v_r_dish, v_r_rej, v_r_nocost);
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: owner sees % of 5', v_n;
  END IF;

  PERFORM public.dryrun157_expect('SCENARIO E zero quantity', 'P0001', '%greater than zero%',
    format('SELECT public.approve_write_off_request(%L::uuid, 0)', v_r_ing));
  v_result := approve_write_off_request(v_r_ing, 2);
  IF v_result ->> 'status' IS DISTINCT FROM 'approved'
     OR (v_result ->> 'approved_quantity')::numeric IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: approve ingredient %', v_result;
  END IF;
  PERFORM approve_write_off_request(v_r_fg);
  PERFORM approve_write_off_request(v_r_dish);
  v_result := reject_write_off_request(v_r_rej, '  counted wrong  ');
  IF v_result ->> 'status' IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: reject %', v_result;
  END IF;

  PERFORM public.dryrun157_expect('SCENARIO E approve twice', 'P0001', 'This request is already approved.',
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_ing));
  PERFORM public.dryrun157_expect('SCENARIO E reject approved', 'P0001', 'This request is already approved.',
    format('SELECT public.reject_write_off_request(%L::uuid)', v_r_fg));
  PERFORM public.dryrun157_expect('SCENARIO E approve rejected', 'P0001', 'This request is already rejected.',
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_rej));
  PERFORM public.dryrun157_expect('SCENARIO E unknown request', 'P0001', 'Write-off request was not found.',
    format('SELECT public.approve_write_off_request(%L::uuid)', gen_random_uuid()));
  RESET ROLE;

  -- Ingredient: 100 - 2 (corrected) - 0.2 (dish part) = 97.8; nothing for the rejected 5.
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  IF v_stock IS DISTINCT FROM 97.800 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: ingredient stock % (expected 97.8)', v_stock;
  END IF;
  SELECT * INTO v_row FROM write_off_requests WHERE id = v_r_ing;
  IF v_row.status <> 'approved' OR v_row.approved_quantity <> 2 OR v_row.quantity <> 3
     OR v_row.decided_by IS DISTINCT FROM v_actor OR v_row.decided_at IS NULL
     OR cardinality(v_row.write_off_ids) <> 1
     OR NOT EXISTS (SELECT 1 FROM write_offs w
                    WHERE w.id = v_row.write_off_ids[1] AND w.item_type = 'ingredient'
                      AND w.ingredient_id = v_ing AND w.quantity = 2 AND w.reason = 'spoilage'
                      AND w.note = 'Seller request — sour milk' AND w.total_value = 3.00) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: approved ingredient request %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM write_off_requests WHERE id = v_r_fg;
  IF v_row.approved_quantity <> 2 OR cardinality(v_row.write_off_ids) <> 1
     OR NOT EXISTS (SELECT 1 FROM write_offs w
                    WHERE w.id = v_row.write_off_ids[1] AND w.item_type = 'finished_good'
                      AND w.product_id = v_comp AND w.quantity = 2 AND w.reason = 'damaged') THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: approved finished-good request %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM write_off_requests WHERE id = v_r_dish;
  IF v_row.approved_quantity <> 1 OR cardinality(v_row.write_off_ids) <> 2
     OR (SELECT count(DISTINCT w.dish_write_off_id) FROM write_offs w
         WHERE w.id = ANY (v_row.write_off_ids) AND w.dish_write_off_id IS NOT NULL) <> 1
     OR (SELECT count(*) FROM write_offs w WHERE w.id = ANY (v_row.write_off_ids)
           AND w.reason = 'quality_reject' AND w.note LIKE 'Dish: %Seller request — dropped') <> 2 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: approved dish request %', row_to_json(v_row);
  END IF;
  -- Batch: 10 - 2 (finished good) - 1 (dish part) = 3 left, via 2 consumptions.
  IF (SELECT count(*) FROM finished_goods_batch_consumptions
      WHERE production_batch_id = v_batch AND direction = 'out') <> 2
     OR (SELECT sum(quantity) FROM finished_goods_batch_consumptions
         WHERE production_batch_id = v_batch AND direction = 'out') <> 3 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: batch consumption wrong';
  END IF;
  SELECT * INTO v_row FROM write_off_requests WHERE id = v_r_rej;
  IF v_row.status <> 'rejected' OR v_row.decision_note IS DISTINCT FROM 'counted wrong'
     OR v_row.approved_quantity IS NOT NULL OR v_row.write_off_ids IS NOT NULL
     OR v_row.decided_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: rejected request %', row_to_json(v_row);
  END IF;
  IF (SELECT count(*) FROM write_offs) <> v_wo_before + 4 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: % write-off rows (expected %)',
      (SELECT count(*) FROM write_offs), v_wo_before + 4;
  END IF;

  -- ------------------------------------------------------------------
  -- F. Approval that cannot be booked stays pending.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun157_expect('SCENARIO F no cost', 'P0001', 'Cannot record write-off.%no unit cost%',
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_nocost));
  RESET ROLE;
  IF (SELECT status FROM write_off_requests WHERE id = v_r_nocost) <> 'pending'
     OR (SELECT current_stock FROM ingredients WHERE id = v_ing_nocost) <> 50
     OR (SELECT count(*) FROM write_offs) <> v_wo_before + 4 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: failed approval left changes behind';
  END IF;

  -- ------------------------------------------------------------------
  -- G. The seller sees the decisions; no profile / anon are refused.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  IF (SELECT status FROM write_off_request_list WHERE id = v_r_ing) <> 'approved'
     OR (SELECT approved_quantity FROM write_off_request_list WHERE id = v_r_ing) <> 2
     OR (SELECT status FROM write_off_request_list WHERE id = v_r_rej) <> 'rejected'
     OR (SELECT decision_note FROM write_off_request_list WHERE id = v_r_rej) <> 'counted wrong' THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: seller does not see the decisions';
  END IF;
  RESET ROLE;

  UPDATE profiles SET is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun157_expect('SCENARIO G no profile request', '42501', 'No active profile%',
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'ingredient', v_ing, 'other'));
  PERFORM public.dryrun157_expect('SCENARIO G no profile approve', '42501', 'No active profile%',
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_nocost));
  IF (SELECT count(*) FROM write_off_request_list) <> 0 THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: a user without profile sees requests';
  END IF;
  RESET ROLE;
  UPDATE profiles SET is_active = true, role = v_original_role WHERE auth_user_id = v_actor;

  SET LOCAL ROLE anon;
  FOREACH v_sig IN ARRAY ARRAY[
    format('SELECT public.request_write_off(%L, %L::uuid, 1, %L)', 'ingredient', v_ing, 'other'),
    format('SELECT public.approve_write_off_request(%L::uuid)', v_r_nocost),
    format('SELECT public.reject_write_off_request(%L::uuid)', v_r_nocost)]
  LOOP
    PERFORM public.dryrun157_expect('SCENARIO G anon', '42501', 'permission denied for function%', v_sig);
  END LOOP;
  PERFORM public.dryrun157_expect('SCENARIO G anon list', '42501', 'permission denied%',
    'SELECT count(*) FROM public.write_off_request_list');
  RESET ROLE;

  FOR v_seq IN SELECT * FROM dryrun157_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/157 test: scenarios A-G passed.';
END;
$test$;

ROLLBACK;
