-- SQL test: sql/150 — purchase journals are posted by the database at commit
-- (audit D2/K3 step 4) + direct client writes to purchases are guarded.
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/purchase_auto_posting.sql
-- (exit 0) after a full replay of sql/*.sql. Prints NOTICE "scenarios A-I passed".
-- The trigger is DEFERRED; the test fires it with SET CONSTRAINTS … IMMEDIATE.
--
-- Scenarios:
--   A — catalog: 4 new functions not callable by clients (a seller gets
--       42501), deferred trigger + guard triggers, id vectors = the app's
--   B — owner receives a purchase (net 12.40, VAT 1.12): nothing before
--       commit; Dr 1100 12.40 / Dr 1200 1.12 / Cr 1000 13.52, app memo and
--       descriptions, tax_code null, UTC day of purchased_at, app's event id;
--       stock really received
--   C — 0% VAT: no 1200 line
--   D — header total off by a cent: credit = net + VAT (balanced)
--   E — client guards (as authenticated owner): status cannot be set or
--       changed directly, a new purchase must be draft, a received purchase
--       cannot change money/date or be deleted, its lines are frozen; notes of
--       a received purchase and everything of a draft stay editable;
--       a server-side draft → cancelled does not post
--   F — posting again: already_posted, nothing doubles
--   G — no vat_input account: purchase stays received (stock in), nothing
--       posted, failure logged with the stable business_event_id
--   H — purchase dated in a year without an open period: failure logged
--   I — received purchase with 0.00 totals: nothing_to_post
-- Sequence counters are restored at the end.

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun150_purchase(
  p_tag text, p_ing uuid, p_lines jsonb, p_net numeric, p_tax numeric, p_total numeric,
  p_purchased_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_id uuid;
  v_line jsonb;
BEGIN
  INSERT INTO purchases (status, notes, subtotal, tax_total, total, purchased_at)
  VALUES ('draft', 'TEST_PU_' || p_tag, p_net, p_tax, p_total, p_purchased_at)
  RETURNING id INTO v_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total)
    VALUES (v_id, p_ing, (v_line ->> 0)::numeric, (v_line ->> 1)::numeric,
            round((v_line ->> 0)::numeric * (v_line ->> 1)::numeric, 2));
  END LOOP;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun150_lines(p_purchase uuid)
RETURNS jsonb
LANGUAGE sql
AS $fn$
  SELECT jsonb_agg(jsonb_build_array(l.line_no, a.code, l.description, l.debit_base, l.credit_base,
                                     l.debit_transaction, l.credit_transaction, l.tax_code)
                   ORDER BY l.line_no)
  FROM journal_entries e
  JOIN journal_lines l ON l.journal_entry_id = e.id
  JOIN accounts a ON a.id = l.account_id
  WHERE e.business_event_id = public.purchase_posting_event_id(p_purchase);
$fn$;

CREATE OR REPLACE FUNCTION public.dryrun150_expect(
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

GRANT EXECUTE ON FUNCTION public.dryrun150_expect(text, text, text, text) TO authenticated, anon;
-- Supabase grants these already; a bare replay may not. Rolled back at the end.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchases, public.purchase_items TO authenticated;

CREATE TEMP TABLE dryrun150_seq (seq regclass, last_value bigint, is_called boolean)
  ON COMMIT DROP;

DO $test$
DECLARE
  v_internal text[] := ARRAY[
    'purchase_posting_event_id(uuid)',
    'post_purchase_journals(uuid)',
    'purchases_auto_post_journals()',
    'purchases_guard_client_writes()',
    'purchase_items_guard_client_writes()'
  ];
  v_sig text;
  v_seq record;
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_today timestamptz := (date_trunc('day', now() AT TIME ZONE 'UTC') + interval '12 hours') AT TIME ZONE 'UTC';
  v_ing uuid;
  v_p_b uuid;
  v_p_c uuid;
  v_p_d uuid;
  v_p_e uuid;
  v_p_g uuid;
  v_p_h uuid;
  v_p_i uuid;
  v_item uuid;
  v_stock numeric;
  v_je journal_entries%ROWTYPE;
  v_result jsonb;
  v_count bigint;
BEGIN
  FOR v_seq IN
    SELECT format('%I.%I', schemaname, sequencename)::regclass AS seq
    FROM pg_sequences WHERE schemaname = 'public'
  LOOP
    EXECUTE format('INSERT INTO dryrun150_seq SELECT %L::regclass, last_value, is_called FROM %s',
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
       WHERE t.tgrelid = 'public.purchases'::regclass AND t.tgname = 'purchases_auto_post_journals'
         AND t.tgconstraint <> 0 AND t.tgdeferrable AND t.tginitdeferred)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.purchases'::regclass
                    AND tgname = 'purchases_guard_client_writes')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.purchase_items'::regclass
                    AND tgname = 'purchase_items_guard_client_writes')
     OR public.purchase_posting_event_id('00000000-0000-4000-8000-000000000001')
          <> '9c483a98-95eb-5198-906f-c92fc7da8ede'::uuid
     OR public.purchase_posting_event_id('00000000-0000-4000-8000-000000000002')
          <> 'fa1f59d4-2589-57e8-92ed-27ce40438bd1'::uuid THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: triggers or id vectors wrong';
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
  VALUES ('TEST_PU_ing_' || v_tag, 'kg', 10, 0, 2.00, true) RETURNING id INTO v_ing;

  v_p_b := public.dryrun150_purchase(v_tag || '_b', v_ing, '[[4, 2.50], [2, 1.20]]', 12.40, 1.12, 13.52, v_today);
  v_p_c := public.dryrun150_purchase(v_tag || '_c', v_ing, '[[2, 2.50]]', 5.00, 0, 5.00, v_today);
  v_p_d := public.dryrun150_purchase(v_tag || '_d', v_ing, '[[1, 3.33]]', 3.33, 0.70, 4.04, v_today);
  v_p_e := public.dryrun150_purchase(v_tag || '_e', v_ing, '[[1, 2.00]]', 2.00, 0.18, 2.18, v_today);
  v_p_g := public.dryrun150_purchase(v_tag || '_g', v_ing, '[[1, 2.00]]', 2.00, 0.18, 2.18, v_today);
  v_p_h := public.dryrun150_purchase(v_tag || '_h', v_ing, '[[1, 2.00]]', 2.00, 0.18, 2.18,
                                     '2001-03-15 12:00:00+00');

  -- ------------------------------------------------------------------
  -- B–D. Owner receives three purchases. Nothing before commit.
  -- ------------------------------------------------------------------
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  SET LOCAL ROLE authenticated;
  PERFORM receive_purchase(v_p_b);
  PERFORM receive_purchase(v_p_c);
  PERFORM receive_purchase(v_p_d);
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM journal_entries
             WHERE business_event_id = public.purchase_posting_event_id(v_p_b)) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: posted before commit';
  END IF;
  SET CONSTRAINTS purchases_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS purchases_auto_post_journals DEFERRED;

  SELECT * INTO v_je FROM journal_entries
  WHERE business_event_id = public.purchase_posting_event_id(v_p_b);
  IF v_je.id IS NULL OR v_je.status <> 'posted'
     OR v_je.entry_date <> (v_today AT TIME ZONE 'UTC')::date
     OR v_je.memo <> 'Purchase confirmed: Dr Inventory / Dr Recoverable tax / Cr Cash / Bank'
     OR v_je.transaction_id IS NOT NULL
     OR v_je.business_event_id <> public.stable_business_event_id(
          'b6e2f4a8-7c19-5d3e-a082-4f1b9e6c3a57'::uuid, 'purchase_received:' || v_p_b)
     OR public.dryrun150_lines(v_p_b) IS DISTINCT FROM jsonb_build_array(
          jsonb_build_array(1, '1100', 'Inventory', 12.40, 0, 12.40, 0, NULL),
          jsonb_build_array(2, '1200', 'Recoverable tax', 1.12, 0, 1.12, 0, NULL),
          jsonb_build_array(3, '1000', 'Cash / Bank', 0, 13.52, 0, 13.52, NULL))
     OR (SELECT current_stock FROM ingredients WHERE id = v_ing) <> v_stock + 4 + 2 + 2 + 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: % / %', to_jsonb(v_je), public.dryrun150_lines(v_p_b);
  END IF;

  IF public.dryrun150_lines(v_p_c) IS DISTINCT FROM jsonb_build_array(
       jsonb_build_array(1, '1100', 'Inventory', 5.00, 0, 5.00, 0, NULL),
       jsonb_build_array(2, '1000', 'Cash / Bank', 0, 5.00, 0, 5.00, NULL)) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: %', public.dryrun150_lines(v_p_c);
  END IF;

  IF public.dryrun150_lines(v_p_d) IS DISTINCT FROM jsonb_build_array(
       jsonb_build_array(1, '1100', 'Inventory', 3.33, 0, 3.33, 0, NULL),
       jsonb_build_array(2, '1200', 'Recoverable tax', 0.70, 0, 0.70, 0, NULL),
       jsonb_build_array(3, '1000', 'Cash / Bank', 0, 4.03, 0, 4.03, NULL)) THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: %', public.dryrun150_lines(v_p_d);
  END IF;

  -- ------------------------------------------------------------------
  -- E. Client guards (signed-in owner, plain table writes like REST).
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun150_expect('SCENARIO E draft→received', 'P0001',
    'The purchase status can only change by receiving the purchase.',
    format('UPDATE public.purchases SET status = ''received'' WHERE id = %L', v_p_e));
  PERFORM public.dryrun150_expect('SCENARIO E received→draft', 'P0001',
    'The purchase status can only change by receiving the purchase.',
    format('UPDATE public.purchases SET status = ''draft'' WHERE id = %L', v_p_b));
  PERFORM public.dryrun150_expect('SCENARIO E received money', 'P0001',
    'A received purchase cannot be changed.',
    format('UPDATE public.purchases SET subtotal = 1 WHERE id = %L', v_p_b));
  PERFORM public.dryrun150_expect('SCENARIO E received date', 'P0001',
    'A received purchase cannot be changed.',
    format('UPDATE public.purchases SET purchased_at = now() - interval ''3 days'' WHERE id = %L', v_p_b));
  PERFORM public.dryrun150_expect('SCENARIO E delete received', 'P0001',
    'A received purchase cannot be deleted.',
    format('DELETE FROM public.purchases WHERE id = %L', v_p_b));
  PERFORM public.dryrun150_expect('SCENARIO E insert received', 'P0001',
    'A new purchase must be a draft.%',
    'INSERT INTO public.purchases (status, notes) VALUES (''received'', ''TEST_PU_x'')');
  PERFORM public.dryrun150_expect('SCENARIO E add line to received', 'P0001',
    'Lines of a received purchase cannot be changed.',
    format('INSERT INTO public.purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total) VALUES (%L, %L, 1, 1, 1)',
           v_p_b, v_ing));
  PERFORM public.dryrun150_expect('SCENARIO E delete line of received', 'P0001',
    'Lines of a received purchase cannot be changed.',
    format('DELETE FROM public.purchase_items WHERE purchase_id = %L', v_p_b));
  PERFORM public.dryrun150_expect('SCENARIO E change line of received', 'P0001',
    'Lines of a received purchase cannot be changed.',
    format('UPDATE public.purchase_items SET quantity = 99 WHERE purchase_id = %L', v_p_b));
  -- Allowed: notes of a received purchase; anything on a draft.
  UPDATE public.purchases SET notes = 'TEST_PU_note' WHERE id = v_p_b;
  UPDATE public.purchases SET subtotal = 2.50, tax_total = 0.23, total = 2.73 WHERE id = v_p_e;
  INSERT INTO public.purchase_items (purchase_id, ingredient_id, quantity, unit_cost, line_total)
  VALUES (v_p_e, v_ing, 1, 0.50, 0.50) RETURNING id INTO v_item;
  DELETE FROM public.purchase_items WHERE id = v_item;
  INSERT INTO public.purchases (status, notes) VALUES ('draft', 'TEST_PU_new') RETURNING id INTO v_p_i;
  DELETE FROM public.purchases WHERE id = v_p_i;
  RESET ROLE;
  IF (SELECT status FROM purchases WHERE id = v_p_e) <> 'draft'
     OR (SELECT status FROM purchases WHERE id = v_p_b) <> 'received'
     OR (SELECT notes FROM purchases WHERE id = v_p_b) <> 'TEST_PU_note'
     OR (SELECT subtotal FROM purchases WHERE id = v_p_b) <> 12.40
     OR (SELECT count(*) FROM purchase_items WHERE purchase_id = v_p_b) <> 2 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: guarded rows changed or allowed edits lost';
  END IF;
  -- A server-side status change that is not a receive (draft → cancelled)
  -- must not post or log anything (checked under G/H).
  UPDATE purchases SET status = 'cancelled' WHERE id = v_p_e;

  -- A (cont.). A seller cannot reach the new internal functions.
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  FOREACH v_sig IN ARRAY ARRAY[
    format('SELECT public.post_purchase_journals(%L::uuid)', v_p_b),
    format('SELECT public.purchase_posting_event_id(%L::uuid)', v_p_b)
  ]
  LOOP
    PERFORM public.dryrun150_expect('SCENARIO A seller direct call', '42501',
      'permission denied for function%', v_sig);
  END LOOP;
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------
  -- F. Posting again changes nothing.
  -- ------------------------------------------------------------------
  SELECT count(*) INTO v_count FROM journal_entries;
  v_result := post_purchase_journals(v_p_b);
  IF v_result -> 'results' -> 0 ->> 'status' IS DISTINCT FROM 'already_posted'
     OR (SELECT count(*) FROM journal_entries) <> v_count THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- G. No vat_input account → purchase received, failure logged.
  -- H. Purchase dated 2001 (no open period) → failure logged.
  -- ------------------------------------------------------------------
  UPDATE account_role_bindings SET is_active = false WHERE role = 'vat_input';
  SELECT current_stock INTO v_stock FROM ingredients WHERE id = v_ing;
  SET LOCAL ROLE authenticated;
  PERFORM receive_purchase(v_p_g);
  PERFORM receive_purchase(v_p_h);
  RESET ROLE;
  SET CONSTRAINTS purchases_auto_post_journals IMMEDIATE;
  SET CONSTRAINTS purchases_auto_post_journals DEFERRED;
  UPDATE account_role_bindings SET is_active = true WHERE role = 'vat_input';
  IF (SELECT status FROM purchases WHERE id = v_p_g) <> 'received'
     OR (SELECT current_stock FROM ingredients WHERE id = v_ing) <> v_stock + 2
     OR EXISTS (SELECT 1 FROM journal_entries WHERE business_event_id IN (
          public.purchase_posting_event_id(v_p_g), public.purchase_posting_event_id(v_p_h)))
     OR NOT EXISTS (
          SELECT 1 FROM posting_failures
          WHERE entity_id = v_p_g AND entity_type = 'purchase' AND source_flow = 'purchase_receive'
            AND business_event_id = public.purchase_posting_event_id(v_p_g)
            AND error_message LIKE 'Automatic posting failed: No active account binding for role vat_input%')
     OR NOT EXISTS (
          SELECT 1 FROM posting_failures
          WHERE entity_id = v_p_h AND source_flow = 'purchase_receive'
            AND error_message LIKE 'Automatic posting failed: No open fiscal period covers 2001-03-15%')
     OR EXISTS (SELECT 1 FROM posting_failures WHERE entity_id IN (v_p_b, v_p_c, v_p_d, v_p_e)) THEN
    RAISE EXCEPTION 'SCENARIO G/H FAIL: failure path wrong';
  END IF;

  -- ------------------------------------------------------------------
  -- I. Received purchase with 0.00 totals → nothing to post.
  -- ------------------------------------------------------------------
  INSERT INTO purchases (status, notes, subtotal, tax_total, total, purchased_at)
  VALUES ('received', 'TEST_PU_zero', 0, 0, 0, v_today) RETURNING id INTO v_p_i;
  IF post_purchase_journals(v_p_i) ->> 'status' IS DISTINCT FROM 'nothing_to_post'
     OR EXISTS (SELECT 1 FROM journal_entries
                WHERE business_event_id = public.purchase_posting_event_id(v_p_i)) THEN
    RAISE EXCEPTION 'SCENARIO I FAIL';
  END IF;

  FOR v_seq IN SELECT * FROM dryrun150_seq
  LOOP
    IF v_seq.last_value IS NOT NULL THEN
      PERFORM setval(v_seq.seq, v_seq.last_value, v_seq.is_called);
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/150 dry-run: scenarios A-I passed.';
END;
$test$;

ROLLBACK;
