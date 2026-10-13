-- sql/147 — audit D2/K3: every confirmed sale gets its journals AUTOMATICALLY,
-- inside the database, whoever sold it (owner, partner or seller).
--
-- Owner's decision (12.10.2026): seller sales must reach the books by
-- themselves, without manual re-posting and without giving sellers any
-- accounting rights.
--
-- How:
--   1. stable_business_event_id(key)  — the exact same id the app computes
--      (src/features/sales/utils/stable-business-event-id.ts: SHA-1 of the
--      namespace string + key, version 5 / variant bits). Old app postings and
--      new database postings share the id, so nothing can be posted twice.
--   2. post_journal_proposals_internal — a copy of post_journal_proposals
--      generated from its CURRENT definition with only the owner/partner role
--      line removed. Not callable by any client. The public function is untouched.
--   3. post_sale_journals(sale_id) — builds the two journals 1:1 like the app
--      (rules sale_completed + cogs_recognized):
--        sale_completed (only if subtotal > 0)
--          Dr accounts_receivable  sales.total
--          Cr revenue              sales.subtotal
--          Cr vat_output           sales.tax_total   (line skipped when 0)
--          memo 'Sale completed: Dr accounts_receivable / Cr revenue / Cr vat_output'
--        cogs_recognized (only if round(total_cogs, 2) > 0)
--          Dr cogs                     total_cogs
--          Cr finished_goods_inventory total_cogs
--          memo 'COGS recognized: Dr cogs / Cr finished_goods_inventory'
--        entry/posting date = UTC calendar date of confirmed_at (as the app);
--        currency = company_settings.currency_code, rate 1; open fiscal period
--        covering that date; account per role from account_role_bindings
--        active on that date. All amounts are read from the database — the
--        caller passes only the sale id. Not callable by any client.
--   4. A DEFERRED constraint trigger on sales: when a sale goes from draft to
--      confirmed/paid, at COMMIT the journals are posted. Any posting error is
--      caught and written to posting_failures (source 'sale_confirm', with the
--      stable business_event_id) — the sale itself is never undone.
--      A sale with nothing to post (0.00) is skipped silently.
--
-- The app may still post the same sale afterwards (until its code stops
-- doing so): post_journal_proposals then answers already_posted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. stable_business_event_id
-- ---------------------------------------------------------------------------
DO $sid147$
DECLARE
  v_ext text;
BEGIN
  SELECT n.nspname INTO v_ext
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_ext IS NULL THEN
    RAISE EXCEPTION 'sql/147: pgcrypto extension is not available';
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION public.stable_business_event_id(p_key text)
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
      FROM (SELECT digest('9a4e1c70-2b58-5f91-8d33-6e0c7a5b4f12' || p_key, 'sha1') AS h) s
    $body$
  $f$, v_ext);
END;
$sid147$;

REVOKE ALL ON FUNCTION public.stable_business_event_id(text) FROM PUBLIC, anon, authenticated;

DO $vec147$
BEGIN
  IF public.stable_business_event_id('sale_completed:00000000-0000-4000-8000-000000000001')
       <> 'c0a54b67-7e60-576f-b0c0-8fd8de2d1f52'::uuid
     OR public.stable_business_event_id('cogs_recognized:00000000-0000-4000-8000-000000000001')
       <> '16fe6b1e-b18b-5410-ac0f-f9debb82d8d0'::uuid THEN
    RAISE EXCEPTION 'sql/147: stable_business_event_id does not match the app''s ids';
  END IF;
END;
$vec147$;

-- ---------------------------------------------------------------------------
-- 2. post_journal_proposals_internal (generated, role line removed)
-- ---------------------------------------------------------------------------
DO $int147$
DECLARE
  v_guard constant text := 'PERFORM require_role(''owner'', ''partner'');';
  v_note constant text := '-- sql/147: role check is done by the caller (internal copy)';
  v_src text;
  v_def text;
  v_new_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc
  WHERE oid = to_regprocedure('public.post_journal_proposals(jsonb, date, timestamp with time zone)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'sql/147: post_journal_proposals not found';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_guard, ''))) / length(v_guard) <> 1 THEN
    RAISE EXCEPTION 'sql/147: post_journal_proposals must contain the role line exactly once';
  END IF;

  v_def := pg_get_functiondef(
    to_regprocedure('public.post_journal_proposals(jsonb, date, timestamp with time zone)'));
  v_def := replace(v_def,
    'CREATE OR REPLACE FUNCTION public.post_journal_proposals(',
    'CREATE OR REPLACE FUNCTION public.post_journal_proposals_internal(');
  v_def := replace(v_def, v_guard, v_note);
  EXECUTE v_def;

  SELECT prosrc INTO v_new_src FROM pg_proc
  WHERE oid = to_regprocedure('public.post_journal_proposals_internal(jsonb, date, timestamp with time zone)');
  IF v_new_src IS DISTINCT FROM replace(v_src, v_guard, v_note)
     OR NOT (SELECT prosecdef FROM pg_proc
             WHERE oid = to_regprocedure('public.post_journal_proposals_internal(jsonb, date, timestamp with time zone)')) THEN
    RAISE EXCEPTION 'sql/147: internal copy differs from post_journal_proposals by more than the role line';
  END IF;
END;
$int147$;

REVOKE ALL ON FUNCTION public.post_journal_proposals_internal(jsonb, date, timestamp with time zone)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. post_sale_journals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_posting_account(p_role text, p_date date)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid;
BEGIN
  SELECT b.account_id INTO v_account
  FROM account_role_bindings b
  WHERE b.role = p_role
    AND b.is_active = true
    AND b.effective_from <= p_date
    AND (b.effective_to IS NULL OR b.effective_to >= p_date)
  ORDER BY b.effective_from DESC
  LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No active account binding for role % on %.', p_role, p_date;
  END IF;

  RETURN v_account;
END;
$function$;

REVOKE ALL ON FUNCTION public.sale_posting_account(text, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_sale_journals(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale sales%ROWTYPE;
  v_date date;
  v_now timestamptz := now();
  v_currency text;
  v_period uuid;
  v_cogs numeric;
  v_proposals jsonb := '[]'::jsonb;
  v_entry_id uuid;
  v_lines jsonb;
  v_ledger jsonb;
  v_line_no integer;
  v_line_id uuid;
  v_spec record;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale % was not found.', p_sale_id;
  END IF;
  IF v_sale.status NOT IN ('confirmed', 'paid') OR v_sale.confirmed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'sale is not confirmed');
  END IF;

  -- Same date the app uses: the UTC calendar day of confirmed_at.
  v_date := (v_sale.confirmed_at AT TIME ZONE 'UTC')::date;

  SELECT currency_code INTO v_currency FROM company_settings LIMIT 1;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Company currency is not set.';
  END IF;

  SELECT id INTO v_period
  FROM fiscal_periods
  WHERE status = 'open' AND v_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'No open fiscal period covers %.', v_date;
  END IF;

  v_cogs := round(COALESCE(compute_sale_total_cogs(p_sale_id), 0), 2);

  -- sale_completed
  IF COALESCE(v_sale.subtotal, 0) > 0 THEN
    v_entry_id := gen_random_uuid();
    v_lines := '[]'::jsonb;
    v_ledger := '[]'::jsonb;
    v_line_no := 0;
    FOR v_spec IN
      SELECT * FROM (VALUES
        (1, 'accounts_receivable', 'debit',  round(COALESCE(v_sale.total, 0), 2),     'Accounts Receivable'),
        (2, 'revenue',             'credit', round(COALESCE(v_sale.subtotal, 0), 2),  'Sales Revenue'),
        (3, 'vat_output',          'credit', round(COALESCE(v_sale.tax_total, 0), 2), 'VAT Output')
      ) AS t(ord, role, side, amount, description)
      WHERE amount <> 0
      ORDER BY ord
    LOOP
      v_line_no := v_line_no + 1;
      v_line_id := gen_random_uuid();
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'id', v_line_id, 'journal_entry_id', v_entry_id, 'line_no', v_line_no,
        'account_id', sale_posting_account(v_spec.role, v_date),
        'description', v_spec.description,
        'debit_transaction',  CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_transaction', CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'debit_base',         CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_base',        CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'tax_code', NULL));
      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'journal_entry_id', v_entry_id, 'journal_line_id', v_line_id,
        'fiscal_period_id', v_period,
        'account_id', sale_posting_account(v_spec.role, v_date),
        'entry_date', v_date,
        'debit_base',         CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_base',        CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'debit_transaction',  CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_transaction', CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'transaction_currency', v_currency, 'base_currency', v_currency));
    END LOOP;

    v_proposals := v_proposals || jsonb_build_array(jsonb_build_object(
      'journal_entry', jsonb_build_object(
        'id', v_entry_id,
        'business_event_id', stable_business_event_id('sale_completed:' || p_sale_id),
        'transaction_id', NULL,
        'fiscal_period_id', v_period,
        'entry_date', v_date,
        'memo', 'Sale completed: Dr accounts_receivable / Cr revenue / Cr vat_output',
        'status', 'posted',
        'posting_number', NULL,
        'transaction_currency', v_currency,
        'base_currency', v_currency,
        'exchange_rate', 1,
        'reversal_of_journal_entry_id', NULL,
        'posted_at', v_now,
        'created_at', v_now),
      'journal_lines', v_lines,
      'ledger_entries', v_ledger));
  END IF;

  -- cogs_recognized
  IF v_cogs > 0 THEN
    v_entry_id := gen_random_uuid();
    v_lines := '[]'::jsonb;
    v_ledger := '[]'::jsonb;
    v_line_no := 0;
    FOR v_spec IN
      SELECT * FROM (VALUES
        (1, 'cogs',                     'debit',  v_cogs, 'Cost of Goods Sold'),
        (2, 'finished_goods_inventory', 'credit', v_cogs, 'Finished Goods Inventory')
      ) AS t(ord, role, side, amount, description)
      ORDER BY ord
    LOOP
      v_line_no := v_line_no + 1;
      v_line_id := gen_random_uuid();
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'id', v_line_id, 'journal_entry_id', v_entry_id, 'line_no', v_line_no,
        'account_id', sale_posting_account(v_spec.role, v_date),
        'description', v_spec.description,
        'debit_transaction',  CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_transaction', CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'debit_base',         CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_base',        CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'tax_code', NULL));
      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'journal_entry_id', v_entry_id, 'journal_line_id', v_line_id,
        'fiscal_period_id', v_period,
        'account_id', sale_posting_account(v_spec.role, v_date),
        'entry_date', v_date,
        'debit_base',         CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_base',        CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'debit_transaction',  CASE WHEN v_spec.side = 'debit'  THEN v_spec.amount ELSE 0 END,
        'credit_transaction', CASE WHEN v_spec.side = 'credit' THEN v_spec.amount ELSE 0 END,
        'transaction_currency', v_currency, 'base_currency', v_currency));
    END LOOP;

    v_proposals := v_proposals || jsonb_build_array(jsonb_build_object(
      'journal_entry', jsonb_build_object(
        'id', v_entry_id,
        'business_event_id', stable_business_event_id('cogs_recognized:' || p_sale_id),
        'transaction_id', NULL,
        'fiscal_period_id', v_period,
        'entry_date', v_date,
        'memo', 'COGS recognized: Dr cogs / Cr finished_goods_inventory',
        'status', 'posted',
        'posting_number', NULL,
        'transaction_currency', v_currency,
        'base_currency', v_currency,
        'exchange_rate', 1,
        'reversal_of_journal_entry_id', NULL,
        'posted_at', v_now,
        'created_at', v_now),
      'journal_lines', v_lines,
      'ledger_entries', v_ledger));
  END IF;

  IF jsonb_array_length(v_proposals) = 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post');
  END IF;

  RETURN jsonb_build_object(
    'status', 'done',
    'results', post_journal_proposals_internal(v_proposals, v_date, v_now));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_sale_journals(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deferred trigger: post at commit, never undo the sale
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_auto_post_journals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM post_sale_journals(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO posting_failures (
        source_flow, entity_type, entity_id, business_event_id, error_message
      )
      VALUES (
        'sale_confirm', 'sale', NEW.id,
        stable_business_event_id('sale_completed:' || NEW.id),
        'Automatic posting failed: ' || SQLERRM
      );
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_auto_post_journals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sales_auto_post_journals ON public.sales;
CREATE CONSTRAINT TRIGGER sales_auto_post_journals
  AFTER UPDATE OF status ON public.sales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status IN ('confirmed', 'paid'))
  EXECUTE FUNCTION public.sales_auto_post_journals();
