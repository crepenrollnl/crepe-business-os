-- Atomic multi-proposal journal posting (V1 plan item 8).
-- Run in Supabase SQL editor after sql/090_verify_sale_cost_direct_ingredients.sql.
--
-- Problem (found 12.08.2026, confirmed live on dev — sale S-000016): Sales posts
-- Revenue and COGS as two independent, sequential calls to
-- postJournalProposal (posting-service.ts) — no shared transaction between
-- them. postJournalProposal itself is also 4 independent inserts with no
-- BEGIN. When Revenue succeeds and COGS then fails (e.g. NO_POSTING_LINES
-- from a sub-cent amount rounding to zero in the Posting Pipeline), Revenue
-- is left committed with no paired COGS and no way to reverse it
-- (reversal_of_journal_entry_id is reserved in the schema but nothing ever
-- populates it).
--
-- Decision (investigated and designed over two prior sessions, this
-- migration implements the agreed design — see V1 plan item 8): do NOT move
-- Posting Rules or account-role resolution into SQL (that stays exactly as
-- it is in src/features/accounting/rules/*.ts and posting-pipeline.ts — a
-- deliberately separate, larger project, same reasoning as sql/076). Instead,
-- a narrow RPC that accepts an array of already-fully-built Journal
-- Proposals (the exact shape Posting Engine already produces in TS) and
-- persists all of them in one transaction — all proposals land, or none do.
-- Sales calls it once with [revenue, cogs] instead of two separate
-- postJournalProposal calls; Production keeps calling it with a single-
-- element array, wrapped transparently.
--
-- Additive only:
--   function: post_journal_proposals(p_proposals jsonb, p_posting_date date, p_now timestamptz) -> jsonb
--
-- Reuses (does not duplicate) two existing RPCs from inside the loop, same
-- pattern confirm_sale already uses for allocate_finished_goods_fifo:
--   - verify_journal_posting_amounts (sql/076) — independent debit/credit +
--     currency-conversion re-check, unchanged.
--   - allocate_posting_number (sql/064) — unchanged sequence allocation.
--
-- Every DB-reading validation that today runs as separate pre-persist
-- queries in posting-service.ts (ALREADY_POSTED, fiscal period, accounts,
-- currencies, exchange rate) is ported here so it runs inside the same
-- transaction as the inserts — the whole reason for this migration is
-- closing the gap between "checked" and "written" that the old
-- request-per-check TS code left open between Revenue and COGS.
--
-- ALREADY_POSTED is NOT treated as a hard failure for the whole batch: a
-- proposal whose business_event_id (or, if absent, journal entry id) is
-- already posted is marked 'already_posted' in the result and skipped, the
-- loop continues to the next proposal. This matters for exactly the
-- S-000016 shape (Revenue already posted from the old code, COGS never
-- was) — without this, retrying through the new atomic path would
-- permanently abort on Revenue's ALREADY_POSTED and COGS could never be
-- posted. A genuine validation failure (period closed, bad account,
-- unbalanced amounts) on any not-yet-posted proposal still aborts the
-- whole function via RAISE EXCEPTION — Postgres rolls back everything
-- inserted so far in this call, including any 'posted_now' proposals
-- earlier in the same array.
--
-- Does NOT:
--   - change Posting Rules / account-role resolution (stays in TS)
--   - change journal_entries / journal_lines / ledger_entries schema
--   - create a reversal mechanism (reversal_of_journal_entry_id remains
--     unpopulated — out of scope, same as before this migration)
--   - expose UI / hooks / pages

CREATE OR REPLACE FUNCTION post_journal_proposals(
  p_proposals jsonb,
  p_posting_date date,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_proposal jsonb;
  v_journal_entry jsonb;
  v_line jsonb;

  v_journal_entry_id uuid;
  v_business_event_id uuid;
  v_transaction_id uuid;
  v_fiscal_period_id uuid;
  v_memo text;
  v_transaction_currency text;
  v_base_currency text;
  v_exchange_rate numeric;
  v_reversal_of_journal_entry_id uuid;
  v_created_at timestamptz;

  v_existing_id uuid;
  v_existing_posting_number text;
  v_existing_status text;

  v_period fiscal_periods%ROWTYPE;

  v_account_id uuid;
  v_account_is_active boolean;
  v_account_is_postable boolean;

  v_amounts_ok boolean;
  v_posting_number text;

  v_posted_entry jsonb;
  v_posted_lines jsonb;
  v_posted_ledger jsonb;

  v_result_item jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_posting_date IS NULL THEN
    RAISE EXCEPTION 'Posting date is required.';
  END IF;

  IF p_proposals IS NULL
     OR jsonb_typeof(p_proposals) <> 'array'
     OR jsonb_array_length(p_proposals) = 0 THEN
    RAISE EXCEPTION 'At least one journal proposal is required.';
  END IF;

  FOR v_proposal IN SELECT * FROM jsonb_array_elements(p_proposals)
  LOOP
    v_journal_entry := v_proposal -> 'journal_entry';

    -- Structural shape guard (mirrors validateJournalProposalShape).
    IF v_journal_entry IS NULL
       OR NOT (v_proposal ? 'journal_lines')
       OR jsonb_typeof(v_proposal -> 'journal_lines') <> 'array'
       OR jsonb_array_length(v_proposal -> 'journal_lines') = 0 THEN
      RAISE EXCEPTION 'Journal proposal is missing journal entry or lines.';
    END IF;

    v_journal_entry_id := NULLIF(v_journal_entry ->> 'id', '')::uuid;
    v_business_event_id := NULLIF(v_journal_entry ->> 'business_event_id', '')::uuid;
    v_transaction_id := NULLIF(v_journal_entry ->> 'transaction_id', '')::uuid;
    v_fiscal_period_id := NULLIF(v_journal_entry ->> 'fiscal_period_id', '')::uuid;
    v_memo := v_journal_entry ->> 'memo';
    v_transaction_currency := v_journal_entry ->> 'transaction_currency';
    v_base_currency := v_journal_entry ->> 'base_currency';
    v_exchange_rate := NULLIF(v_journal_entry ->> 'exchange_rate', '')::numeric;
    v_reversal_of_journal_entry_id :=
      NULLIF(v_journal_entry ->> 'reversal_of_journal_entry_id', '')::uuid;
    v_created_at :=
      COALESCE(NULLIF(v_journal_entry ->> 'created_at', '')::timestamptz, p_now);

    IF v_journal_entry_id IS NULL THEN
      RAISE EXCEPTION 'Journal proposal entry id is required.';
    END IF;

    IF v_fiscal_period_id IS NULL THEN
      RAISE EXCEPTION 'Journal proposal is missing fiscal_period_id.';
    END IF;

    IF v_transaction_currency IS NULL OR v_base_currency IS NULL THEN
      RAISE EXCEPTION 'Journal proposal currencies are required.';
    END IF;

    IF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
      RAISE EXCEPTION
        'Journal proposal exchange_rate must be greater than zero.';
    END IF;

    -- ALREADY_POSTED check (mirrors findExistingPostedJournal: prefer
    -- business_event_id, fall back to the journal entry id). Locked
    -- FOR UPDATE so a concurrent call for the same proposal can't race
    -- past this check before either has inserted.
    v_existing_id := NULL;
    v_existing_posting_number := NULL;
    v_existing_status := NULL;

    IF v_business_event_id IS NOT NULL THEN
      SELECT id, posting_number, status
      INTO v_existing_id, v_existing_posting_number, v_existing_status
      FROM journal_entries
      WHERE business_event_id = v_business_event_id
      FOR UPDATE;
    END IF;

    IF v_existing_id IS NULL THEN
      SELECT id, posting_number, status
      INTO v_existing_id, v_existing_posting_number, v_existing_status
      FROM journal_entries
      WHERE id = v_journal_entry_id
      FOR UPDATE;
    END IF;

    IF v_existing_id IS NOT NULL AND v_existing_status = 'posted' THEN
      v_result_item := jsonb_build_object(
        'status', 'already_posted',
        'business_event_id', v_business_event_id,
        'journal_entry_id', v_existing_id,
        'posting_number', v_existing_posting_number
      );
      v_results := v_results || jsonb_build_array(v_result_item);
      CONTINUE;
    END IF;

    IF v_existing_id IS NOT NULL AND v_existing_status <> 'posted' THEN
      -- A row already exists for this proposal but was never posted (draft
      -- left over from an aborted call — should not happen since draft
      -- insert and posted update always happen together inside this same
      -- transaction). Fail loudly rather than silently re-inserting into
      -- a row that already exists.
      RAISE EXCEPTION
        'A non-posted journal entry already exists for this proposal (id %). Refusing to overwrite.',
        v_existing_id;
    END IF;

    -- Fiscal period check (mirrors validateFiscalPeriodForPosting).
    SELECT * INTO v_period FROM fiscal_periods WHERE id = v_fiscal_period_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fiscal period was not found for posting.';
    END IF;
    IF v_period.status <> 'open' THEN
      RAISE EXCEPTION 'Fiscal period is not open for posting.';
    END IF;
    IF p_posting_date < v_period.start_date OR p_posting_date > v_period.end_date THEN
      RAISE EXCEPTION 'Posting date is outside the fiscal period range.';
    END IF;

    -- Accounts check (mirrors validateAccountsForPosting) — every line's account.
    FOR v_line IN SELECT * FROM jsonb_array_elements(v_proposal -> 'journal_lines')
    LOOP
      v_account_id := NULLIF(v_line ->> 'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'Journal line is missing an account id.';
      END IF;

      SELECT is_active, is_postable
      INTO v_account_is_active, v_account_is_postable
      FROM accounts
      WHERE id = v_account_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Journal line references an unknown account: %', v_account_id;
      END IF;
      IF NOT v_account_is_active THEN
        RAISE EXCEPTION
          'Journal line references an inactive account: %', v_account_id;
      END IF;
      IF NOT v_account_is_postable THEN
        RAISE EXCEPTION
          'Journal line references a non-postable account: %', v_account_id;
      END IF;
    END LOOP;

    -- Currency check (mirrors validateCurrencies).
    PERFORM 1 FROM currencies WHERE code = v_transaction_currency AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Currency % is missing or inactive.', v_transaction_currency;
    END IF;

    IF v_base_currency <> v_transaction_currency THEN
      PERFORM 1 FROM currencies WHERE code = v_base_currency AND is_active = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Currency % is missing or inactive.', v_base_currency;
      END IF;
    END IF;

    -- Exchange rate check (mirrors validateExchangeRateAvailable).
    IF v_transaction_currency = v_base_currency THEN
      IF v_exchange_rate <> 1 THEN
        RAISE EXCEPTION
          'Same-currency journals must use exchange_rate = 1 when no FX conversion applies.';
      END IF;
    ELSE
      PERFORM 1 FROM currency_rates
      WHERE base_currency = v_base_currency
        AND quote_currency = v_transaction_currency
        AND rate_date = p_posting_date
      LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'No exchange rate is available for the posting date.';
      END IF;
    END IF;

    -- Independent amount re-verification — reused as-is, not duplicated.
    SELECT verify_journal_posting_amounts(
      v_transaction_currency,
      v_base_currency,
      v_exchange_rate,
      v_proposal -> 'journal_lines'
    ) INTO v_amounts_ok;

    IF NOT v_amounts_ok THEN
      RAISE EXCEPTION
        'Journal proposal failed server-side amount verification and was not posted.';
    END IF;

    -- Posting number — reused as-is, not duplicated.
    SELECT allocate_posting_number(p_posting_date) INTO v_posting_number;

    INSERT INTO journal_entries (
      id, business_event_id, transaction_id, fiscal_period_id, entry_date,
      memo, status, posting_number, transaction_currency, base_currency,
      exchange_rate, reversal_of_journal_entry_id, posted_at, created_at
    ) VALUES (
      v_journal_entry_id, v_business_event_id, v_transaction_id, v_fiscal_period_id,
      p_posting_date, v_memo, 'draft', NULL, v_transaction_currency, v_base_currency,
      v_exchange_rate, v_reversal_of_journal_entry_id, NULL, v_created_at
    );

    INSERT INTO journal_lines (
      id, journal_entry_id, line_no, account_id, description,
      debit_transaction, credit_transaction, debit_base, credit_base,
      tax_code, created_at
    )
    SELECT
      (line ->> 'id')::uuid,
      v_journal_entry_id,
      (line ->> 'line_no')::integer,
      (line ->> 'account_id')::uuid,
      line ->> 'description',
      COALESCE((line ->> 'debit_transaction')::numeric, 0),
      COALESCE((line ->> 'credit_transaction')::numeric, 0),
      COALESCE((line ->> 'debit_base')::numeric, 0),
      COALESCE((line ->> 'credit_base')::numeric, 0),
      line ->> 'tax_code',
      p_now
    FROM jsonb_array_elements(v_proposal -> 'journal_lines') AS line;

    INSERT INTO ledger_entries (
      id, journal_entry_id, journal_line_id, fiscal_period_id, account_id,
      entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
      transaction_currency, base_currency, created_at
    )
    SELECT
      (entry ->> 'id')::uuid,
      v_journal_entry_id,
      (entry ->> 'journal_line_id')::uuid,
      v_fiscal_period_id,
      (entry ->> 'account_id')::uuid,
      p_posting_date,
      COALESCE((entry ->> 'debit_base')::numeric, 0),
      COALESCE((entry ->> 'credit_base')::numeric, 0),
      COALESCE((entry ->> 'debit_transaction')::numeric, 0),
      COALESCE((entry ->> 'credit_transaction')::numeric, 0),
      COALESCE(entry ->> 'transaction_currency', v_transaction_currency),
      COALESCE(entry ->> 'base_currency', v_base_currency),
      p_now
    FROM jsonb_array_elements(v_proposal -> 'ledger_entries') AS entry;

    UPDATE journal_entries
    SET
      status = 'posted',
      posting_number = v_posting_number,
      posted_at = p_now,
      entry_date = p_posting_date
    WHERE id = v_journal_entry_id;

    SELECT jsonb_build_object(
      'id', id,
      'business_event_id', business_event_id,
      'transaction_id', transaction_id,
      'fiscal_period_id', fiscal_period_id,
      'entry_date', entry_date,
      'memo', memo,
      'status', status,
      'posting_number', posting_number,
      'transaction_currency', transaction_currency,
      'base_currency', base_currency,
      'exchange_rate', exchange_rate,
      'reversal_of_journal_entry_id', reversal_of_journal_entry_id,
      'posted_at', posted_at,
      'created_at', created_at
    )
    INTO v_posted_entry
    FROM journal_entries
    WHERE id = v_journal_entry_id;

    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'journal_entry_id', journal_entry_id,
        'line_no', line_no,
        'account_id', account_id,
        'description', description,
        'debit_transaction', debit_transaction,
        'credit_transaction', credit_transaction,
        'debit_base', debit_base,
        'credit_base', credit_base,
        'tax_code', tax_code
      )
      ORDER BY line_no
    )
    INTO v_posted_lines
    FROM journal_lines
    WHERE journal_entry_id = v_journal_entry_id;

    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'journal_entry_id', journal_entry_id,
        'journal_line_id', journal_line_id,
        'fiscal_period_id', fiscal_period_id,
        'account_id', account_id,
        'entry_date', entry_date,
        'debit_base', debit_base,
        'credit_base', credit_base,
        'debit_transaction', debit_transaction,
        'credit_transaction', credit_transaction,
        'transaction_currency', transaction_currency,
        'base_currency', base_currency,
        'created_at', created_at
      )
    )
    INTO v_posted_ledger
    FROM ledger_entries
    WHERE journal_entry_id = v_journal_entry_id;

    v_result_item := jsonb_build_object(
      'status', 'posted_now',
      'business_event_id', v_business_event_id,
      'journal_entry_id', v_journal_entry_id,
      'posting_number', v_posting_number,
      'posting_date', p_posting_date,
      'fiscal_period_id', v_fiscal_period_id,
      'journal_entry', v_posted_entry,
      'journal_lines', v_posted_lines,
      'ledger_entries', v_posted_ledger
    );

    v_results := v_results || jsonb_build_array(v_result_item);
  END LOOP;

  RETURN v_results;
END;
$$;

COMMENT ON FUNCTION post_journal_proposals(jsonb, date, timestamptz) IS
  'Persist one or more already-built Journal Proposals atomically: all land or none do. Each element is marked posted_now or already_posted in the returned array, same order as input. Posting Rules / account resolution are not part of this function — callers pass fully-resolved proposals built in TS.';

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) — both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION post_journal_proposals(jsonb, date, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION post_journal_proposals(jsonb, date, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION post_journal_proposals(jsonb, date, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- Side fix found during this migration's design (not hypothetical — a real
-- gap): allocate_posting_number (sql/064) never had an explicit REVOKE FROM
-- PUBLIC / FROM anon, unlike every other posting-path function in this
-- project (confirm_sale, verify_journal_posting_amounts). It only had
-- GRANT EXECUTE ... TO authenticated. Same class of lesson as sql/074/076:
-- anon holds its own independent grant on this project, so a GRANT-only
-- function without an explicit REVOKE is reachable by anon unless PUBLIC's
-- default privileges happen to already block it. Closing it here, in the
-- same migration that reuses this function, rather than as a separate
-- unrelated change.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION allocate_posting_number(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION allocate_posting_number(date) FROM anon;
