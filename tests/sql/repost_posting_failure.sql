-- SQL test: sql/154 — "Post again" for posting failures (audit D2 last step).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/repost_posting_failure.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-H passed".
--
-- Scenarios:
--   A — catalog: repost_posting_failure callable by signed-in users (not
--       anon), SECURITY DEFINER; a seller gets 42501 (require_role)
--   B — purchase whose posting failed (no vat_input account): post again while
--       still broken → clear error, row stays open; after the fix → posted,
--       row closed by the signed-in owner with note 'Posted again'; a second
--       press → 'already resolved'
--   C — a duplicate old-app row of the same purchase is closed together (2)
--   D — old-app write-off row (random id) → refused, stays open
--   E — sub-cent write-off row → nothing_to_post, closed with that note
--   F — POS sale whose posting was skipped (business_event_id NULL) → posted
--   G — flow / entity type mismatch (both directions) → refused
--   H — production session → posted
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun154_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun154_expect(text, text, text, text) TO authenticated, anon;

CREATE TEMP TABLE dryrun154_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '12 hours') AT TIME ZONE 'UTC';
  v_ing uuid;
  v_cheap uuid;
  v_comp uuid;
  v_purchase uuid;
  v_f_main uuid;
  v_f_dup uuid;
  v_f_old_wo uuid;
  v_f_cheap uuid;
  v_f_sale uuid;
  v_f_bad uuid;
  v_f_prod uuid;
  v_wo uuid;
  v_wo_cheap uuid;
  v_sale uuid;
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_line uuid;
  v_result jsonb;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun154_seq SELECT %L::regclass, last_value, is_called FROM %s',
                   v_seq.seq, v_seq.seq);
  END LOOP;

  -- ------------------------------------------------------------------
  -- A. Catalog.
  -- ------------------------------------------------------------------
  IF NOT has_function_privilege('authenticated', 'public.repost_posting_failure(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.repost_posting_failure(uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.repost_posting_failure(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: grants wrong';
  END IF;

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

  -- ------------------------------------------------------------------
  -- Test data: a received purchase whose posting failed.
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RP_ing_' || v_tag, 'kg', 10, 0, 2.00, true) RETURNING id INTO v_ing;
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_RP_cheap_' || v_tag, 'g', 100, 0, 0.01, true) RETURNING id INTO v_cheap;
  INSERT INTO purchases (status, notes, subtotal, tax_total, total, purchased_at)
  VALUES ('draft', 'TEST_RP_' || v_tag, 4.00, 0.36, 4.36, v_today) RETURNING id INTO v_purchase;
  INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total)
  VALUES (v_purchase, v_ing, 2, 2.00, 4.00);

  UPDATE account_role_bindings SET is_active = false WHERE role = 'vat_input';
  SET LOCAL ROLE authenticated;
  PERFORM receive_purchase(v_purchase);
  RESET ROLE;
  SET CONSTRAINTS purchases_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS purchases_auto_post_journals DEFERRED;
  SELECT id INTO v_f_main FROM posting_failures
  WHERE entity_id = v_purchase AND source_flow = 'purchase_receive';
  IF v_f_main IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: no failure row for the purchase';
  END IF;
  -- C. an old-app duplicate of the same purchase (no event id)
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('purchase_receive', 'purchase', v_purchase, NULL, 'Accounting posting was skipped.')
  RETURNING id INTO v_f_dup;

  -- A (cont.). A seller is refused by require_role.
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun154_expect('SCENARIO A seller', '42501', 'Insufficient permissions%',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_main));
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- B. Still broken → error, stays open. Fixed → posted and closed.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun154_expect('SCENARIO B still broken', 'P0001',
    'Posting again failed: No active account binding for role vat_input%',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_main));
  RESET ROLE;
  IF (SELECT resolved_at FROM posting_failures WHERE id = v_f_main) IS NOT NULL
     OR EXISTS (SELECT 1 FROM journal_entries
                WHERE business_event_id = public.purchase_posting_event_id(v_purchase)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: failed re-post changed something';
  END IF;

  UPDATE account_role_bindings SET is_active = true WHERE role = 'vat_input';
  SET LOCAL ROLE authenticated;
  v_result := repost_posting_failure(v_f_main);
  RESET ROLE;
  IF v_result ->> 'status' IS DISTINCT FROM 'posted'
     OR (v_result ->> 'resolved')::int <> 2
     OR NOT EXISTS (SELECT 1 FROM journal_entries
                    WHERE business_event_id = public.purchase_posting_event_id(v_purchase)
                      AND status = 'posted')
     OR EXISTS (SELECT 1 FROM posting_failures
                WHERE id IN (v_f_main, v_f_dup)
                  AND (resolved_at IS NULL OR resolved_by IS DISTINCT FROM v_actor
                       OR resolution_note <> 'Posted again')) THEN
    RAISE EXCEPTION 'SCENARIO B/C FAIL: %', v_result;
  END IF;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun154_expect('SCENARIO B second press', 'P0001',
    'This posting failure is already resolved.',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_main));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- D. Old-app write-off row (random id) → refused.
  -- E. Sub-cent write-off (trigger-style row) → nothing to post, closed.
  -- ------------------------------------------------------------------
  INSERT INTO write_offs (item_type, ingredient_id, quantity, unit_cost, total_value, reason)
  VALUES ('ingredient', v_ing, 1, 2.00, 2.00, 'spoilage') RETURNING id INTO v_wo;
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('write_off_record', 'write_off', v_wo, gen_random_uuid(), 'TEST old app row')
  RETURNING id INTO v_f_old_wo;
  INSERT INTO write_offs (item_type, ingredient_id, quantity, unit_cost, total_value, reason)
  VALUES ('ingredient', v_cheap, 0.3, 0.01, 0.003, 'spoilage') RETURNING id INTO v_wo_cheap;
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('write_off_record', 'write_off', v_wo_cheap,
          stable_business_event_id(write_off_posting_key(v_wo_cheap)), 'TEST sub-cent')
  RETURNING id INTO v_f_cheap;

  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun154_expect('SCENARIO D old write-off', 'P0001',
    'This write-off failure was recorded before automatic posting.%',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_old_wo));
  v_result := repost_posting_failure(v_f_cheap);
  RESET ROLE;
  IF (SELECT resolved_at FROM posting_failures WHERE id = v_f_old_wo) IS NOT NULL
     OR v_result ->> 'status' IS DISTINCT FROM 'nothing_to_post'
     OR (SELECT resolution_note FROM posting_failures WHERE id = v_f_cheap)
          IS DISTINCT FROM 'Nothing to post (amount 0.00)' THEN
    RAISE EXCEPTION 'SCENARIO D/E FAIL: %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- F. POS sale whose posting was skipped by the old app.
  -- G. Flow / entity mismatch → refused.
  -- ------------------------------------------------------------------
  INSERT INTO sales (sale_number, status, subtotal, tax_total, total, confirmed_at, sale_date)
  VALUES ('TEST-RP-' || v_tag, 'confirmed', 10.00, 0.90, 10.90, v_today, CURRENT_DATE)
  RETURNING id INTO v_sale;
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('pos_confirm', 'sale', v_sale, NULL, 'Accounting posting was skipped.')
  RETURNING id INTO v_f_sale;
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('purchase_receive', 'sale', v_sale, NULL, 'TEST mismatch')
  RETURNING id INTO v_f_bad;

  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('pos_confirm', 'purchase', v_purchase, NULL, 'TEST mismatch 2')
  RETURNING id INTO v_f_dup;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun154_expect('SCENARIO G mismatch 2', 'P0001',
    'Posting failures of type pos_confirm/purchase cannot be posted again automatically.',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_dup));
  PERFORM public.dryrun154_expect('SCENARIO G mismatch', 'P0001',
    'Posting failures of type purchase_receive/sale cannot be posted again automatically.',
    format('SELECT public.repost_posting_failure(%L::uuid)', v_f_bad));
  v_result := repost_posting_failure(v_f_sale);
  RESET ROLE;
  IF v_result ->> 'status' IS DISTINCT FROM 'posted'
     OR NOT EXISTS (SELECT 1 FROM journal_entries
                    WHERE business_event_id = stable_business_event_id('sale_completed:' || v_sale))
     OR (SELECT resolved_at FROM posting_failures WHERE id = v_f_sale) IS NULL THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: %', v_result;
  END IF;
  -- The refused row points at the same sale: once the sale is posted it is
  -- closed together with it (same entity) instead of being left dangling.
  IF (SELECT resolved_at FROM posting_failures WHERE id = v_f_bad) IS NULL THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: sibling row of the same entity left open';
  END IF;

  -- ------------------------------------------------------------------
  -- H. Production session.
  -- ------------------------------------------------------------------
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_RP_comp_' || v_tag, 1, 'pcs', true, 'component') RETURNING id INTO v_comp;
  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_RP_plan_' || v_tag, CURRENT_DATE, 'completed') RETURNING id INTO v_plan;
  INSERT INTO production_plan_products (production_plan_id, recipe_id, recipe_name, planned_quantity,
                                        yield_quantity, yield_unit, sort_order)
  VALUES (v_plan, v_comp, 'TEST_RP', 5, 1, 'pcs', 1) RETURNING id INTO v_plan_product;
  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now()) RETURNING id INTO v_session;
  INSERT INTO production_session_lines (production_session_id, production_plan_product_id, recipe_id,
                                        product_name, planned_quantity, actual_produced_quantity,
                                        yield_unit, sort_order)
  VALUES (v_session, v_plan_product, v_comp, 'TEST_RP', 5, 5, 'pcs', 1) RETURNING id INTO v_line;
  UPDATE production_sessions SET status = 'completed', completed_at = now() WHERE id = v_session;
  INSERT INTO production_batches (production_session_id, production_session_line_id, finished_good_id,
                                  recipe_id, produced_quantity, unit_cost, produced_at)
  VALUES (v_session, v_line, v_comp, v_comp, 5, 0.40, now());
  INSERT INTO posting_failures (source_flow, entity_type, entity_id, business_event_id, error_message)
  VALUES ('production_complete', 'production_session', v_session,
          production_posting_event_id(v_session), 'TEST production')
  RETURNING id INTO v_f_prod;

  SET LOCAL ROLE authenticated;
  v_result := repost_posting_failure(v_f_prod);
  RESET ROLE;
  IF v_result ->> 'status' IS DISTINCT FROM 'posted'
     OR NOT EXISTS (SELECT 1 FROM journal_entries
                    WHERE business_event_id = production_posting_event_id(v_session)) THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: %', v_result;
  END IF;

  FOR v_seq IN SELECT * FROM dryrun154_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/154 dry-run: scenarios A-H passed.';
END;
$test$;

ROLLBACK;
