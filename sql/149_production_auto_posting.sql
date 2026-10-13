-- sql/149 — audit D2/K3, step 3: production journals are posted by the
-- DATABASE at COMMIT, like sales (sql/147) and write-offs (sql/148).
--
-- Why: today the browser posts the production journal after
-- complete_production_session returns. A closed tablet or a lost connection
-- leaves a completed production without a journal.
--
-- Journal (one per completed production session):
--   key     'production_completed:' || production_sessions.id
--           with the app's PRODUCTION namespace 7c2f0b9e-… — the same
--           business_event_id the app uses, so the app's status badge keeps
--           working and an old app-posted journal is never doubled
--   amount  F = Σ round(produced_quantity × unit_cost, 2) over the session's
--           production_batches (exactly what the app posts today = the value
--           of the new finished-goods layers)
--   lines   Dr finished_goods_inventory (1110) F  'Finished Goods Inventory'
--           Cr inventory_asset (1100)          F − C  'Raw Material Inventory'
--           Cr finished_goods_inventory (1110) C  'Finished Goods Inventory (components used)'
--           C = value of component batches consumed by this session
--           (finished_goods_batch_consumptions, reason recipe_consumption),
--           rounded to cents and capped at F (rounding).
--           CHANGE vs the app: the app credited everything to 1100, so
--           components were taken out of raw materials although they sit in
--           finished goods. Without components the journal is identical to
--           the app's (two lines, same memo).
--   memo    'Production completed: Dr finished_goods_inventory / Cr inventory_asset'
--           (+ ' + finished_goods_inventory (components)' when C > 0)
--   date    UTC calendar day of production_sessions.completed_at (as the app)
--   link    journal_entries.transaction_id = the session's 'production'
--           transaction (the app left it empty)
--   F = 0.00 → nothing posted, no failure.
--   failure → posting_failures (source 'production_complete', entity
--             'production_session', stable business_event_id); the
--             production stays completed.
--
-- Pieces:
--   1. stable_business_event_id(namespace uuid, key text) — same algorithm as
--      the one-argument version (sql/147), any namespace.
--   2. post_journal_by_roles_for_event(event_id, transaction_id, date, memo,
--      lines) — the sql/148 poster with an explicit event id and transaction.
--      post_journal_by_roles(key, …) becomes a thin wrapper around it (same
--      behaviour for write-offs; checked before replacing).
--   3. post_production_journals(session_id).
--   4. DEFERRED constraint trigger AFTER UPDATE OF status ON
--      production_sessions when the status becomes 'completed' → at COMMIT.
--
-- No backfill: sessions completed earlier keep whatever the app posted.
-- Deploy order: dev → app PR (stop browser posting) → merge → Vercel Ready →
-- prod. With the old app still running, its own post would come back
-- "already posted" and log a false failure row.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $pre149$
DECLARE
  v_src text;
BEGIN
  SELECT replace(prosrc, chr(13), '') INTO v_src
  FROM pg_proc
  WHERE oid = to_regprocedure('public.post_journal_by_roles(text, date, text, jsonb)');
  IF to_regprocedure('public.stable_business_event_id(text)') IS NULL
     OR to_regprocedure('public.post_journal_proposals_internal(jsonb, date, timestamp with time zone)') IS NULL
     OR to_regprocedure('public.sale_posting_account(text, date)') IS NULL THEN
    RAISE EXCEPTION 'sql/149: sql/147 is not applied';
  END IF;
  -- Line endings are ignored (the SQL editor may store CRLF).
  IF md5(v_src) IS DISTINCT FROM '42393cf480eda615bd08e9ddcb246e7c' THEN
    RAISE EXCEPTION 'sql/149: post_journal_by_roles is missing or differs from sql/148 (md5 %)', md5(v_src);
  END IF;
  IF to_regprocedure('public.post_production_journals(uuid)') IS NOT NULL
     OR to_regprocedure('public.stable_business_event_id(uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sql/149: already applied';
  END IF;
END;
$pre149$;

-- ---------------------------------------------------------------------------
-- 1. stable_business_event_id(namespace, key)
-- ---------------------------------------------------------------------------
DO $sid149$
DECLARE
  v_ext text;
BEGIN
  SELECT n.nspname INTO v_ext
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_ext IS NULL THEN
    RAISE EXCEPTION 'sql/149: pgcrypto extension is not available';
  END IF;

  EXECUTE format($f$
    CREATE FUNCTION public.stable_business_event_id(p_namespace uuid, p_key text)
    RETURNS uuid
    LANGUAGE sql
    IMMUTABLE
    SET search_path TO public, %I
    AS $body$
      SELECT encode(
        set_byte(
          set_byte(
            substring(h FROM 1 FOR 16),
            6, (get_byte(h, 6) & 15) | 80),
          8, (get_byte(h, 8) & 63) | 128),
        'hex')::uuid
      FROM (SELECT digest(p_namespace::text || p_key, 'sha1') AS h) s
    $body$
  $f$, v_ext);
END;
$sid149$;

REVOKE ALL ON FUNCTION public.stable_business_event_id(uuid, text) FROM PUBLIC, anon, authenticated;

DO $vec149$
BEGIN
  IF public.stable_business_event_id('7c2f0b9e-4a61-5d83-9e10-2b8c4f6a1d35'::uuid,
       'production_completed:00000000-0000-4000-8000-000000000001')
       <> '00804158-d7b6-554b-8cc3-1c7e5d386f1e'::uuid
     OR public.stable_business_event_id('7c2f0b9e-4a61-5d83-9e10-2b8c4f6a1d35'::uuid,
       'production_completed:00000000-0000-4000-8000-000000000002')
       <> '9cc3e665-f3aa-50b7-8b15-d38bbc3b0c64'::uuid
     OR public.stable_business_event_id('9a4e1c70-2b58-5f91-8d33-6e0c7a5b4f12'::uuid,
       'sale_completed:00000000-0000-4000-8000-000000000001')
       <> public.stable_business_event_id('sale_completed:00000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'sql/149: stable_business_event_id(namespace, key) does not match the app''s ids';
  END IF;
END;
$vec149$;

-- ---------------------------------------------------------------------------
-- 2. post_journal_by_roles_for_event + post_journal_by_roles wrapper
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.post_journal_by_roles_for_event(
  p_business_event_id uuid,
  p_transaction_id uuid,
  p_date date,
  p_memo text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_currency text;
  v_period uuid;
  v_entry_id uuid := gen_random_uuid();
  v_lines jsonb := '[]'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_line jsonb;
  v_line_no integer := 0;
  v_line_id uuid;
  v_account uuid;
  v_amount numeric;
  v_debit numeric;
  v_credit numeric;
BEGIN
  IF p_business_event_id IS NULL OR p_date IS NULL OR p_lines IS NULL THEN
    RAISE EXCEPTION 'post_journal_by_roles: key, date and lines are required.';
  END IF;

  SELECT currency_code INTO v_currency FROM company_settings LIMIT 1;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Company currency is not set.';
  END IF;

  SELECT id INTO v_period
  FROM fiscal_periods
  WHERE status = 'open' AND p_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'No open fiscal period covers %.', p_date;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_amount := round(COALESCE((v_line ->> 'amount')::numeric, 0), 2);
    CONTINUE WHEN v_amount = 0;
    IF v_amount < 0 THEN
      RAISE EXCEPTION 'post_journal_by_roles: negative amount for role %.', v_line ->> 'role';
    END IF;

    v_account := sale_posting_account(v_line ->> 'role', p_date);
    v_debit := CASE WHEN v_line ->> 'side' = 'debit' THEN v_amount ELSE 0 END;
    v_credit := CASE WHEN v_line ->> 'side' = 'credit' THEN v_amount ELSE 0 END;
    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'post_journal_by_roles: side must be debit or credit.';
    END IF;

    v_line_no := v_line_no + 1;
    v_line_id := gen_random_uuid();
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', v_line_id, 'journal_entry_id', v_entry_id, 'line_no', v_line_no,
      'account_id', v_account, 'description', v_line ->> 'description',
      'debit_transaction', v_debit, 'credit_transaction', v_credit,
      'debit_base', v_debit, 'credit_base', v_credit, 'tax_code', NULL));
    v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'journal_entry_id', v_entry_id, 'journal_line_id', v_line_id,
      'fiscal_period_id', v_period, 'account_id', v_account, 'entry_date', p_date,
      'debit_base', v_debit, 'credit_base', v_credit,
      'debit_transaction', v_debit, 'credit_transaction', v_credit,
      'transaction_currency', v_currency, 'base_currency', v_currency));
  END LOOP;

  IF v_line_no = 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post');
  END IF;

  RETURN jsonb_build_object(
    'status', 'done',
    'results', post_journal_proposals_internal(
      jsonb_build_array(jsonb_build_object(
        'journal_entry', jsonb_build_object(
          'id', v_entry_id,
          'business_event_id', p_business_event_id,
          'transaction_id', p_transaction_id,
          'fiscal_period_id', v_period,
          'entry_date', p_date,
          'memo', p_memo,
          'status', 'posted',
          'posting_number', NULL,
          'transaction_currency', v_currency,
          'base_currency', v_currency,
          'exchange_rate', 1,
          'reversal_of_journal_entry_id', NULL,
          'posted_at', v_now,
          'created_at', v_now),
        'journal_lines', v_lines,
        'ledger_entries', v_ledger)),
      p_date, v_now));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_journal_by_roles_for_event(uuid, uuid, date, text, jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_journal_by_roles(
  p_key text,
  p_date date,
  p_memo text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_key IS NULL OR p_date IS NULL OR p_lines IS NULL THEN
    RAISE EXCEPTION 'post_journal_by_roles: key, date and lines are required.';
  END IF;
  RETURN post_journal_by_roles_for_event(
    stable_business_event_id(p_key), NULL, p_date, p_memo, p_lines);
END;
$function$;

REVOKE ALL ON FUNCTION public.post_journal_by_roles(text, date, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. post_production_journals
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.production_posting_event_id(p_session_id uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT stable_business_event_id(
    '7c2f0b9e-4a61-5d83-9e10-2b8c4f6a1d35'::uuid,
    'production_completed:' || p_session_id);
$function$;

REVOKE ALL ON FUNCTION public.production_posting_event_id(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.post_production_journals(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_total numeric;
  v_components numeric;
  v_transaction_id uuid;
BEGIN
  SELECT * INTO v_session FROM production_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session % was not found.', p_session_id;
  END IF;
  IF v_session.status IS DISTINCT FROM 'completed' OR v_session.completed_at IS NULL THEN
    RAISE EXCEPTION 'Production session % is not completed.', p_session_id;
  END IF;

  -- Value of the new finished-goods layers (what the app posts today).
  SELECT COALESCE(SUM(round(pb.produced_quantity * pb.unit_cost, 2)), 0)
  INTO v_total
  FROM production_batches pb
  WHERE pb.production_session_id = p_session_id;

  IF v_total <= 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post', 'amount', v_total);
  END IF;

  -- Value of component batches this session used up.
  SELECT round(COALESCE(SUM(c.total_cost), 0), 2)
  INTO v_components
  FROM finished_goods_batch_consumptions c
  JOIN production_session_lines l ON l.id = c.source_id
  WHERE l.production_session_id = p_session_id
    AND c.source_type = 'production_session_line'
    AND c.reason = 'recipe_consumption'
    AND c.direction = 'out';
  v_components := LEAST(v_components, v_total);

  SELECT t.id INTO v_transaction_id
  FROM transactions t
  WHERE t.reference_type = 'production_session'
    AND t.reference_id = p_session_id
    AND t.type = 'production'
  ORDER BY t.created_at, t.id
  LIMIT 1;

  RETURN post_journal_by_roles_for_event(
    production_posting_event_id(p_session_id),
    v_transaction_id,
    (v_session.completed_at AT TIME ZONE 'UTC')::date,
    'Production completed: Dr finished_goods_inventory / Cr inventory_asset'
      || CASE WHEN v_components > 0
              THEN ' + finished_goods_inventory (components)' ELSE '' END,
    jsonb_build_array(
      jsonb_build_object('role', 'finished_goods_inventory', 'side', 'debit',
                         'amount', v_total, 'description', 'Finished Goods Inventory'),
      jsonb_build_object('role', 'inventory_asset', 'side', 'credit',
                         'amount', v_total - v_components, 'description', 'Raw Material Inventory'),
      jsonb_build_object('role', 'finished_goods_inventory', 'side', 'credit',
                         'amount', v_components,
                         'description', 'Finished Goods Inventory (components used)')));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_production_journals(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deferred trigger: post at commit, never undo the production
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.production_sessions_auto_post_journals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM post_production_journals(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO posting_failures (
        source_flow, entity_type, entity_id, business_event_id, error_message
      )
      VALUES (
        'production_complete', 'production_session', NEW.id,
        production_posting_event_id(NEW.id),
        'Automatic posting failed: ' || SQLERRM
      );
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.production_sessions_auto_post_journals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS production_sessions_auto_post_journals ON public.production_sessions;
CREATE CONSTRAINT TRIGGER production_sessions_auto_post_journals
  AFTER UPDATE OF status ON public.production_sessions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'completed' AND NEW.status = 'completed')
  EXECUTE FUNCTION public.production_sessions_auto_post_journals();
