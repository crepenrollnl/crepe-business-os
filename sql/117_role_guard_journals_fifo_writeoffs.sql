-- Role Guard — Journal posting, non-sale FIFO allocation, write-offs.
--
-- Run in Supabase SQL editor after sql/116_receive_purchase_atomic.sql.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Fixes 2026-09-08 system audit findings #5 and #6 (High, Security):
--
--   #5. post_journal_proposals (sql/091) is SECURITY DEFINER, GRANTed to
--       authenticated, and had no require_role call anywhere in its body.
--       Traced every caller in this session's investigation: the only path
--       to it is posting-service.ts -> operationalAccountingIntegrationService
--       -> {production-accounting-service.ts, sale-accounting-service.ts,
--       write-off-accounting-service.ts}. Purchases only ever proposes,
--       never posts. Today only owner/partner accounts exist, so nothing
--       changes in practice — but sql/099's own header comment already
--       named Sales specifically as the path that must be revisited before
--       a Seller account is created, since confirm_sale has no role gate
--       anywhere and posts through this exact function. This migration
--       gates the function; Sales' own RBAC tranche is still a separate,
--       already-documented, not-yet-started piece of work.
--
--   #6. allocate_finished_goods_fifo (sql/087, live) and record_write_off
--       (sql/115) are both SECURITY DEFINER, GRANTed to authenticated, with
--       no require_role call. Every real call site was traced and its
--       exact (reason, source_type) pair confirmed against the DB-enforced
--       CHECK constraint on finished_goods_batch_consumptions (sql/010):
--         - Sales (confirm_sale, sql/089 live):            'sale' / 'sale_line'
--         - Production (complete_production_session,
--           sql/106 live, nested-BOM allocation):           'recipe_consumption' / 'production_session_line'
--         - Write-offs (record_write_off, sql/115):          'waste' / 'waste_ticket'
--       Decision (discussed and confirmed): gate every reason except
--       'sale' — Option A. This also re-gates the recipe_consumption path
--       even though complete_production_session already checks role one
--       layer up (sql/098); doing so here too closes the same
--       direct-RPC-bypass risk for Production (calling
--       allocate_finished_goods_fifo straight over PostgREST, skipping
--       complete_production_session entirely) at zero behavioral cost,
--       since Production is owner/partner-only regardless today. 'sale'
--       stays ungated on purpose, deliberately deferred to the same
--       Sales-focused tranche as #5.
--
--   record_write_off has exactly one caller in the whole codebase
--   (write-off-service.ts) — confirmed by grep, no branching needed, gated
--   unconditionally.
--
-- RLS: journal_entries / journal_lines / ledger_entries currently carry
-- "_authenticated_all" policies (sql/056, sql/057) that are
-- FOR ALL ... USING (true) WITH CHECK (true) — fully open to any
-- authenticated user for INSERT/UPDATE/DELETE, not just SELECT. This is a
-- second, independent gap from #5: because post_journal_proposals is
-- SECURITY DEFINER, it runs with its owner's privileges (BYPASSRLS in
-- Supabase) regardless of who calls it — tightening RLS does NOT change
-- what that RPC itself can do, and adding require_role to the RPC does NOT
-- stop a direct REST call to the table that skips the RPC entirely. Both
-- fixes are required together, matching the exact two-layer pattern already
-- documented and applied to accounts/fiscal_periods/expense_entries/etc. in
-- sql/098 and sql/099.
--
-- Three real, read-only SELECT call sites against journal_entries were
-- confirmed to survive this tightening unchanged (all owner/partner-
-- initiated flows, none touch journal_lines/ledger_entries directly):
--   expense-service.ts:142, production-accounting-service.ts:368,
--   sale-accounting-service.ts:464.
--
-- Does NOT:
--   - change any FIFO/cost/consumption logic inside allocate_finished_goods_fifo
--   - change the physical-operation-vs-accounting-posting pattern
--   - add/remove any REVOKE or GRANT — EXECUTE stays granted to authenticated
--     on all three functions; CREATE OR REPLACE FUNCTION does not reset an
--     existing function's ACL when the signature is unchanged, and all three
--     already carry the correct REVOKE-from-PUBLIC/anon + GRANT-to-authenticated
--     from their original migrations (sql/091, sql/087, sql/115) — confirmed
--     by reading each file's tail before writing this migration
--   - start the Sales-focused RBAC tranche itself (confirm_sale, sale-line
--     mutation RPCs remain ungated, as already documented in sql/099)
--   - create, delete, or modify any real Supabase Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block

-- ============================================================================
-- PART 1 of 3 — DRY RUN (safe to run first; self-contained, self-rolling-back)
-- ----------------------------------------------------------------------------
-- Copy everything between "-- >>> DRY RUN START" and "-- <<< DRY RUN END"
-- into the Supabase SQL Editor and run it FIRST, before Part 2. Like
-- sql/116, this block is fully self-contained: it creates all three
-- functions and all three RLS policies itself, then exercises them,
-- all inside one BEGIN ... ROLLBACK. Nothing persists at the end.
--
-- What this dry run DOES prove, empirically, in this session:
--   - The three require_role gates reject a simulated non-owner/partner
--     caller (SQLSTATE 42501 / "Insufficient permissions...") and do NOT
--     reject a real owner/partner caller (each still reaches its own
--     normal validation logic afterward, proven by seeing THAT function's
--     own error message instead of the permission error).
--   - allocate_finished_goods_fifo's carve-out is precise: a simulated
--     non-owner/partner caller passing p_reason = 'sale' is NOT rejected
--     by the gate (this is the one check that actually proves the future
--     Sales/Seller path isn't accidentally broken by this migration).
--   - All three CREATE OR REPLACE FUNCTION bodies and all three CREATE
--     POLICY statements are syntactically valid and apply without error.
--
-- What this dry run does NOT and CANNOT prove (read before assuming RLS is
-- "tested"):
--   - The SQL Editor connects as `postgres`, a superuser with BYPASSRLS.
--     RLS enforcement depends on the actual Postgres execution role of the
--     connection, not on any auth.uid()/JWT claim simulated here — running
--     a query against journal_entries/journal_lines/ledger_entries in this
--     dry run, under any simulated role, proves NOTHING about whether the
--     new RLS policy actually blocks anyone, because postgres bypasses RLS
--     regardless of the policy text. This dry run does not attempt to
--     claim otherwise — it does not even try to query these three tables
--     under a simulated role for that reason.
--   - There is no real Seller (or any non-owner/partner) Supabase Auth user
--     in this project today. The require_role gate tests above emulate a
--     non-owner/partner CALLER by temporarily flipping an existing real
--     owner/partner profile row's `role` column to 'seller' for the
--     duration of one test (restored immediately after, and rolled back
--     regardless) — this is legitimate for require_role() specifically,
--     because that function only reads profiles.role + auth.uid(), nothing
--     RLS-related. It says nothing about RLS.
--   - The genuine RLS negative case — a real, distinct authenticated
--     Postgres session with a non-owner/partner role actually being
--     blocked by the new policy on a direct table request — has NOT been
--     verified and CANNOT be verified until such an account actually
--     exists. This is a deliberate, deferred verification, not an
--     oversight: re-run the check in Part 3, section 3c once a Seller (or
--     any non-owner/partner) account is created.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

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
  PERFORM require_role('owner', 'partner');

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

CREATE OR REPLACE FUNCTION allocate_finished_goods_fifo(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_remaining_to_allocate numeric;
  v_batch record;
  v_out_sum numeric;
  v_in_sum numeric;
  v_batch_remaining numeric;
  v_take numeric;
  v_line_total numeric;
  v_total_cost numeric := 0;
  v_allocated_quantity numeric := 0;
  v_consumption_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_notes text;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Allocation quantity must be greater than zero.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Allocation reason is required.';
  END IF;

  IF p_reason NOT IN (
    'sale',
    'internal_use',
    'waste',
    'spoilage',
    'stock_count',
    'manual_adjustment',
    'recipe_consumption'
  ) THEN
    RAISE EXCEPTION
      'Invalid allocation reason. return_restock is not allowed on FIFO outflow allocation.';
  END IF;

  -- p_reason is guaranteed non-null and one of the 7 values above by this
  -- point, so a plain <> comparison is safe here (no NULL-comparison
  -- pitfall). Only 'sale' (confirm_sale) is exempt, matching the decision:
  -- Sales stays ungated pending its own RBAC tranche (sql/099); every other
  -- reason — including recipe_consumption (Production), which is already
  -- gated one layer up by complete_production_session's own require_role
  -- (sql/098) — now also requires owner/partner here, closing the same
  -- direct-RPC-bypass risk this function's own EXECUTE grant otherwise
  -- leaves open for any authenticated caller.
  IF p_reason <> 'sale' THEN
    PERFORM require_role('owner', 'partner');
  END IF;

  IF p_source_type IS NULL OR btrim(p_source_type) = '' THEN
    RAISE EXCEPTION 'Source type is required.';
  END IF;

  IF p_source_type NOT IN (
    'sale_line',
    'pos_line',
    'order_line',
    'waste_ticket',
    'stock_count_line',
    'adjustment',
    'production_session_line'
  ) THEN
    RAISE EXCEPTION 'Invalid source type.';
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'Source id is required.';
  END IF;

  -- Until Products master exists, finished goods are represented by recipes
  -- (production_batches.finished_good_id = recipe_id).
  IF NOT EXISTS (
    SELECT 1
    FROM recipes
    WHERE id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Product was not found.';
  END IF;

  v_created_by := COALESCE(p_created_by, auth.uid());
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_remaining_to_allocate := p_quantity;

  -- Reject duplicate posting for the same (source document line, product).
  -- Widened from (source_type, source_id) alone -- see sql/085's
  -- file-header comment for why. finished_goods_batch_consumptions has no
  -- product_id column of its own -- the product is derived by joining
  -- through production_batches.finished_good_id, the same way every other
  -- reader of this ledger identifies which product a row belongs to.
  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions c
    JOIN production_batches pb ON pb.id = c.production_batch_id
    WHERE c.source_type = p_source_type
      AND c.source_id = p_source_id
      AND pb.finished_good_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'This source has already been allocated.';
  END IF;

  -- Lock all batches for this finished good (FIFO order) so concurrent
  -- allocations cannot oversell. Remaining is calculated, never stored.
  FOR v_batch IN
    SELECT
      pb.id,
      pb.produced_quantity,
      pb.unit_cost,
      pb.produced_at
    FROM production_batches pb
    WHERE pb.finished_good_id = p_product_id
    ORDER BY pb.produced_at ASC, pb.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;

    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    v_batch_remaining := v_batch.produced_quantity - v_out_sum + v_in_sum;

    -- Invariant: remaining must never be negative before allocation.
    IF v_batch_remaining < 0 THEN
      RAISE EXCEPTION
        'Finished goods ledger integrity error: batch remaining is negative.';
    END IF;

    IF v_batch_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_batch_remaining, v_remaining_to_allocate);
    v_line_total := round(v_take * v_batch.unit_cost, 4);

    INSERT INTO finished_goods_batch_consumptions (
      production_batch_id,
      quantity,
      unit_cost,
      total_cost,
      direction,
      reason,
      source_type,
      source_id,
      allocation_mode,
      notes,
      created_by
    )
    VALUES (
      v_batch.id,
      v_take,
      v_batch.unit_cost,
      v_line_total,
      'out',
      p_reason,
      p_source_type,
      p_source_id,
      'fifo',
      v_notes,
      v_created_by
    )
    RETURNING id INTO v_consumption_id;

    -- Post-insert invariant: Σ(out) − Σ(in) <= produced
    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    IF (v_out_sum - v_in_sum) > v_batch.produced_quantity THEN
      RAISE EXCEPTION
        'Finished goods allocation would make batch remaining negative.';
    END IF;

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'consumption_id', v_consumption_id,
        'production_batch_id', v_batch.id,
        'quantity', v_take,
        'unit_cost', v_batch.unit_cost,
        'total_cost', v_line_total,
        'produced_at', v_batch.produced_at
      )
    );

    v_remaining_to_allocate := v_remaining_to_allocate - v_take;
    v_allocated_quantity := v_allocated_quantity + v_take;
    v_total_cost := v_total_cost + v_line_total;
  END LOOP;

  IF v_remaining_to_allocate > 0 THEN
    RAISE EXCEPTION 'Insufficient finished goods stock for this product.';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'requested_quantity', p_quantity,
    'allocated_quantity', v_allocated_quantity,
    'total_cost', v_total_cost,
    'reason', p_reason,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'allocations', v_allocations
  );
END;
$$;

CREATE OR REPLACE FUNCTION record_write_off(
  p_item_type text,
  p_ingredient_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unit_cost numeric(12, 4) := 0;
  v_total_value numeric(14, 4) := 0;
  v_allocation jsonb;
  v_ingredient_name text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good') THEN
    RAISE EXCEPTION 'Write-off item type must be ingredient or finished_good.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'An ingredient write-off requires ingredient_id and no product_id.';
    END IF;

    SELECT name, COALESCE(cost_per_unit, 0)
    INTO v_ingredient_name, v_unit_cost
    FROM ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
    END IF;

    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);

    v_total_value := round(p_quantity * v_unit_cost, 4);

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      p_ingredient_id,
      NULL,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'ingredient',
      p_ingredient_id,
      NULL,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  ELSE
    IF p_product_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'A finished-good write-off requires product_id and no ingredient_id.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM recipes WHERE id = p_product_id) THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    v_allocation := allocate_finished_goods_fifo(
      p_product_id,
      p_quantity,
      'waste',
      'waste_ticket',
      v_id,
      v_note,
      auth.uid()
    );

    v_total_value := COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    IF p_quantity > 0 THEN
      v_unit_cost := round(v_total_value / p_quantity, 4);
    END IF;

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      NULL,
      p_product_id,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'finished_good',
      NULL,
      p_product_id,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'item_type', p_item_type,
    'total_value', v_total_value
  );
END;
$$;

DROP POLICY IF EXISTS journal_entries_authenticated_all ON journal_entries;
CREATE POLICY journal_entries_owner_partner_all
  ON journal_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS journal_lines_authenticated_all ON journal_lines;
CREATE POLICY journal_lines_owner_partner_all
  ON journal_lines
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS ledger_entries_authenticated_all ON ledger_entries;
CREATE POLICY ledger_entries_owner_partner_all
  ON ledger_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_err text;
  v_result jsonb;
BEGIN
  -- --- Emulate an authenticated owner/partner JWT (same mechanism as
  -- sql/106_empirical_zero_cost_guard_dev.sql). -----------------------------
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles — cannot emulate require_role.';
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'auth.uid() emulation failed (got %, expected %).',
      auth.uid(), v_actor;
  END IF;

  RAISE NOTICE 'JWT emulated auth.uid()=% (real role=%)', auth.uid(), v_original_role;

  -- ------------------------------------------------------------------------
  -- SCENARIO 1: post_journal_proposals, real owner/partner — must pass the
  -- new require_role gate and reach its own normal validation instead.
  -- Empty proposals array fails fast with no side effects either way.
  -- ------------------------------------------------------------------------
  BEGIN
    PERFORM post_journal_proposals('[]'::jsonb, CURRENT_DATE, now());
    RAISE EXCEPTION 'SCENARIO 1 FAIL: empty proposals array unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 1 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%At least one journal proposal is required%' THEN
        RAISE EXCEPTION
          'SCENARIO 1 FAIL: gate wrongly rejected a real owner/partner caller: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 1 PASS (owner/partner passes require_role, fails later validation as before): %', v_err;
  END;

  -- ------------------------------------------------------------------------
  -- SCENARIO 2: post_journal_proposals, simulated non-owner/partner
  -- ('seller') — must be rejected with 42501 BEFORE reaching any of the
  -- function's own input validation.
  -- ------------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  BEGIN
    PERFORM post_journal_proposals('[]'::jsonb, CURRENT_DATE, now());
    RAISE EXCEPTION 'SCENARIO 2 FAIL: seller-role caller unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 2 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION 'SCENARIO 2 FAIL: expected the require_role rejection, got: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 2 PASS (seller-role rejected before any input validation): %', v_err;
  END;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------------
  -- SCENARIO 3: record_write_off, real owner/partner — must pass the gate
  -- and reach its own validation. NULL item_type fails fast, no side effects.
  -- ------------------------------------------------------------------------
  BEGIN
    PERFORM record_write_off(NULL, NULL, NULL, 1, 'spoilage', NULL);
    RAISE EXCEPTION 'SCENARIO 3 FAIL: null item_type unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 3 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%item type must be ingredient or finished_good%' THEN
        RAISE EXCEPTION
          'SCENARIO 3 FAIL: gate wrongly rejected a real owner/partner caller: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 3 PASS (owner/partner passes require_role, fails later validation as before): %', v_err;
  END;

  -- ------------------------------------------------------------------------
  -- SCENARIO 4: record_write_off, simulated non-owner/partner — must be
  -- rejected with 42501.
  -- ------------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  BEGIN
    PERFORM record_write_off(NULL, NULL, NULL, 1, 'spoilage', NULL);
    RAISE EXCEPTION 'SCENARIO 4 FAIL: seller-role caller unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 4 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION 'SCENARIO 4 FAIL: expected the require_role rejection, got: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 4 PASS (seller-role rejected): %', v_err;
  END;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  -- ------------------------------------------------------------------------
  -- SCENARIO 5: allocate_finished_goods_fifo, real owner/partner,
  -- p_reason = 'waste' (the write-off path) — must pass the gate and reach
  -- normal validation. A random product id fails fast on "Product was not
  -- found." with no side effects (fails before the FIFO loop / any insert).
  -- ------------------------------------------------------------------------
  BEGIN
    v_result := allocate_finished_goods_fifo(
      gen_random_uuid(), 1, 'waste', 'waste_ticket', gen_random_uuid()
    );
    RAISE EXCEPTION 'SCENARIO 5 FAIL: fake product unexpectedly succeeded (%)', v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 5 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Product was not found%' THEN
        RAISE EXCEPTION
          'SCENARIO 5 FAIL: gate wrongly rejected a real owner/partner caller for a non-sale reason: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 5 PASS (owner/partner + waste passes require_role, fails later on fake product): %', v_err;
  END;

  -- ------------------------------------------------------------------------
  -- SCENARIO 6: allocate_finished_goods_fifo, simulated non-owner/partner,
  -- p_reason = 'waste' — must be rejected with 42501 (this is the actual
  -- bug being fixed: today this reason is not gated at all).
  -- ------------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;

  BEGIN
    v_result := allocate_finished_goods_fifo(
      gen_random_uuid(), 1, 'waste', 'waste_ticket', gen_random_uuid()
    );
    RAISE EXCEPTION 'SCENARIO 6 FAIL: seller-role caller with reason=waste unexpectedly succeeded (%)', v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 6 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION 'SCENARIO 6 FAIL: expected the require_role rejection, got: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 6 PASS (seller-role rejected for reason=waste): %', v_err;
  END;

  -- ------------------------------------------------------------------------
  -- SCENARIO 7 (the important one): allocate_finished_goods_fifo, STILL
  -- simulated non-owner/partner, p_reason = 'sale' — must NOT be rejected
  -- by the gate. This is the one check that actually proves the carve-out
  -- doesn't accidentally break the future Sales/Seller path: a seller-role
  -- caller should reach the function's own "Product was not found" error,
  -- not the permission error.
  -- ------------------------------------------------------------------------
  BEGIN
    v_result := allocate_finished_goods_fifo(
      gen_random_uuid(), 1, 'sale', 'sale_line', gen_random_uuid()
    );
    RAISE EXCEPTION 'SCENARIO 7 FAIL: fake product unexpectedly succeeded (%)', v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO 7 FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err LIKE '%Insufficient permissions%' THEN
        RAISE EXCEPTION
          'SCENARIO 7 FAIL: seller-role caller with reason=sale was wrongly blocked — this would break the future Sales/Seller path: %', v_err;
      END IF;
      IF v_err NOT LIKE '%Product was not found%' THEN
        RAISE EXCEPTION 'SCENARIO 7 FAIL: unexpected error: %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO 7 PASS (seller-role NOT blocked for reason=sale — fails later on fake product instead, exactly as intended): %', v_err;
  END;

  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  RAISE NOTICE 'sql/117 dry run: all 7 scenarios passed. Reminder: this proves the require_role gates only — it proves NOTHING about RLS enforcement (see header note). The genuine RLS negative case remains unverified pending a real non-owner/partner account.';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 — THE MIGRATION (apply this for real, after Part 1 has passed)
-- ============================================================================

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
  PERFORM require_role('owner', 'partner');

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
  'Persist one or more already-built Journal Proposals atomically: all land or none do. Each element is marked posted_now or already_posted in the returned array, same order as input. Posting Rules / account resolution are not part of this function -- callers pass fully-resolved proposals built in TS. Requires owner/partner (sql/117) -- Sales currently posts through this same function with no additional gate, per the documented pending Sales-focused RBAC tranche (sql/099).';

CREATE OR REPLACE FUNCTION allocate_finished_goods_fifo(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_remaining_to_allocate numeric;
  v_batch record;
  v_out_sum numeric;
  v_in_sum numeric;
  v_batch_remaining numeric;
  v_take numeric;
  v_line_total numeric;
  v_total_cost numeric := 0;
  v_allocated_quantity numeric := 0;
  v_consumption_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_notes text;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Allocation quantity must be greater than zero.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Allocation reason is required.';
  END IF;

  IF p_reason NOT IN (
    'sale',
    'internal_use',
    'waste',
    'spoilage',
    'stock_count',
    'manual_adjustment',
    'recipe_consumption'
  ) THEN
    RAISE EXCEPTION
      'Invalid allocation reason. return_restock is not allowed on FIFO outflow allocation.';
  END IF;

  -- p_reason is guaranteed non-null and one of the 7 values above by this
  -- point, so a plain <> comparison is safe here (no NULL-comparison
  -- pitfall). Only 'sale' (confirm_sale) is exempt, matching the decision:
  -- Sales stays ungated pending its own RBAC tranche (sql/099); every other
  -- reason -- including recipe_consumption (Production), which is already
  -- gated one layer up by complete_production_session's own require_role
  -- (sql/098) -- now also requires owner/partner here, closing the same
  -- direct-RPC-bypass risk this function's own EXECUTE grant otherwise
  -- leaves open for any authenticated caller.
  IF p_reason <> 'sale' THEN
    PERFORM require_role('owner', 'partner');
  END IF;

  IF p_source_type IS NULL OR btrim(p_source_type) = '' THEN
    RAISE EXCEPTION 'Source type is required.';
  END IF;

  IF p_source_type NOT IN (
    'sale_line',
    'pos_line',
    'order_line',
    'waste_ticket',
    'stock_count_line',
    'adjustment',
    'production_session_line'
  ) THEN
    RAISE EXCEPTION 'Invalid source type.';
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'Source id is required.';
  END IF;

  -- Until Products master exists, finished goods are represented by recipes
  -- (production_batches.finished_good_id = recipe_id).
  IF NOT EXISTS (
    SELECT 1
    FROM recipes
    WHERE id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Product was not found.';
  END IF;

  v_created_by := COALESCE(p_created_by, auth.uid());
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_remaining_to_allocate := p_quantity;

  -- Reject duplicate posting for the same (source document line, product).
  -- Widened from (source_type, source_id) alone -- see sql/085's
  -- file-header comment for why. finished_goods_batch_consumptions has no
  -- product_id column of its own -- the product is derived by joining
  -- through production_batches.finished_good_id, the same way every other
  -- reader of this ledger identifies which product a row belongs to.
  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions c
    JOIN production_batches pb ON pb.id = c.production_batch_id
    WHERE c.source_type = p_source_type
      AND c.source_id = p_source_id
      AND pb.finished_good_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'This source has already been allocated.';
  END IF;

  -- Lock all batches for this finished good (FIFO order) so concurrent
  -- allocations cannot oversell. Remaining is calculated, never stored.
  FOR v_batch IN
    SELECT
      pb.id,
      pb.produced_quantity,
      pb.unit_cost,
      pb.produced_at
    FROM production_batches pb
    WHERE pb.finished_good_id = p_product_id
    ORDER BY pb.produced_at ASC, pb.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;

    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    v_batch_remaining := v_batch.produced_quantity - v_out_sum + v_in_sum;

    -- Invariant: remaining must never be negative before allocation.
    IF v_batch_remaining < 0 THEN
      RAISE EXCEPTION
        'Finished goods ledger integrity error: batch remaining is negative.';
    END IF;

    IF v_batch_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_batch_remaining, v_remaining_to_allocate);
    v_line_total := round(v_take * v_batch.unit_cost, 4);

    INSERT INTO finished_goods_batch_consumptions (
      production_batch_id,
      quantity,
      unit_cost,
      total_cost,
      direction,
      reason,
      source_type,
      source_id,
      allocation_mode,
      notes,
      created_by
    )
    VALUES (
      v_batch.id,
      v_take,
      v_batch.unit_cost,
      v_line_total,
      'out',
      p_reason,
      p_source_type,
      p_source_id,
      'fifo',
      v_notes,
      v_created_by
    )
    RETURNING id INTO v_consumption_id;

    -- Post-insert invariant: Σ(out) − Σ(in) <= produced
    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    IF (v_out_sum - v_in_sum) > v_batch.produced_quantity THEN
      RAISE EXCEPTION
        'Finished goods allocation would make batch remaining negative.';
    END IF;

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'consumption_id', v_consumption_id,
        'production_batch_id', v_batch.id,
        'quantity', v_take,
        'unit_cost', v_batch.unit_cost,
        'total_cost', v_line_total,
        'produced_at', v_batch.produced_at
      )
    );

    v_remaining_to_allocate := v_remaining_to_allocate - v_take;
    v_allocated_quantity := v_allocated_quantity + v_take;
    v_total_cost := v_total_cost + v_line_total;
  END LOOP;

  IF v_remaining_to_allocate > 0 THEN
    RAISE EXCEPTION 'Insufficient finished goods stock for this product.';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'requested_quantity', p_quantity,
    'allocated_quantity', v_allocated_quantity,
    'total_cost', v_total_cost,
    'reason', p_reason,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'allocations', v_allocations
  );
END;
$$;

COMMENT ON FUNCTION allocate_finished_goods_fifo(
  uuid, numeric, text, text, uuid, text, uuid
) IS
  'FIFO allocate finished goods and append immutable batch consumption ledger rows. Remaining is calculated only. Duplicate-source guard is qualified by product_id so one source line can allocate several different products (assembly components). total_cost is rounded to 4 decimals at computation time (sql/087) to match finished_goods_batch_consumptions_total_cost_chk''s fresh recomputation. Requires owner/partner for any reason other than ''sale'' (sql/117) -- sale-driven allocation from confirm_sale stays ungated pending the same Sales-focused RBAC tranche; recipe_consumption (Production) is additionally gated here even though complete_production_session already checks role itself, closing the same direct-RPC-bypass risk for Production.';

CREATE OR REPLACE FUNCTION record_write_off(
  p_item_type text,
  p_ingredient_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unit_cost numeric(12, 4) := 0;
  v_total_value numeric(14, 4) := 0;
  v_allocation jsonb;
  v_ingredient_name text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good') THEN
    RAISE EXCEPTION 'Write-off item type must be ingredient or finished_good.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'An ingredient write-off requires ingredient_id and no product_id.';
    END IF;

    SELECT name, COALESCE(cost_per_unit, 0)
    INTO v_ingredient_name, v_unit_cost
    FROM ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
    END IF;

    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);

    v_total_value := round(p_quantity * v_unit_cost, 4);

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      p_ingredient_id,
      NULL,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'ingredient',
      p_ingredient_id,
      NULL,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  ELSE
    IF p_product_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'A finished-good write-off requires product_id and no ingredient_id.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM recipes WHERE id = p_product_id) THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    v_allocation := allocate_finished_goods_fifo(
      p_product_id,
      p_quantity,
      'waste',
      'waste_ticket',
      v_id,
      v_note,
      auth.uid()
    );

    v_total_value := COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    IF p_quantity > 0 THEN
      v_unit_cost := round(v_total_value / p_quantity, 4);
    END IF;

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      NULL,
      p_product_id,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'finished_good',
      NULL,
      p_product_id,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'item_type', p_item_type,
    'total_value', v_total_value
  );
END;
$$;

COMMENT ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) IS
  'Record a physical write-off. Ingredients: decrement_ingredient_stock + waste_out movement. Finished goods: allocate_finished_goods_fifo(waste, waste_ticket). Does not post journals. Requires owner/partner (sql/117).';

-- No REVOKE/GRANT here: all three functions already carry the correct
-- EXECUTE grant (authenticated only, revoked from PUBLIC and anon) from
-- their original migrations (sql/091, sql/087, sql/115). CREATE OR REPLACE
-- FUNCTION does not reset an existing function's ACL when the signature is
-- unchanged, and this repo's own precedent for this exact kind of edit
-- (sql/098, sql/099 -- adding require_role to an already-correctly-ACL'd
-- existing function) does not restate REVOKE/GRANT either. Confirmed by
-- reading each function's current tail before writing this file.

DROP POLICY IF EXISTS journal_entries_authenticated_all ON journal_entries;
CREATE POLICY journal_entries_owner_partner_all
  ON journal_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS journal_lines_authenticated_all ON journal_lines;
CREATE POLICY journal_lines_owner_partner_all
  ON journal_lines
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS ledger_entries_authenticated_all ON ledger_entries;
CREATE POLICY ledger_entries_owner_partner_all
  ON ledger_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

-- ============================================================================
-- PART 3 of 3 — POST-APPLY VERIFICATION (run standalone, NOT inside the
-- migration transaction — safe to run any time after a real COMMIT)
-- ============================================================================

-- 3a. Confirm each function's body now contains the new PERFORM/IF lines.
--     Read the printed definition text and visually confirm the gate is
--     present in the right place for each function.
SELECT
  p.proname AS function_name,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
WHERE p.proname IN (
  'post_journal_proposals',
  'allocate_finished_goods_fifo',
  'record_write_off'
);

-- 3b. Confirm ACL is unchanged (still authenticated-only, no PUBLIC/anon) --
--     should read exactly the same as before this migration.
SELECT
  p.proname AS function_name,
  p.prosecdef AS is_security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('PUBLIC', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
WHERE p.proname IN (
  'post_journal_proposals',
  'allocate_finished_goods_fifo',
  'record_write_off'
);
-- Expect all three rows: is_security_definer = true,
-- authenticated_can_execute = true, anon_can_execute = false,
-- public_can_execute = false -- unchanged from before this migration.

-- 3c. Confirm the new RLS policy text on all three ledger tables matches
--     the exact, already-proven shape live on accounts/fiscal_periods
--     (sql/099) -- side-by-side comparison, not just "a policy exists".
SELECT
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename IN (
  'journal_entries', 'journal_lines', 'ledger_entries',
  'accounts', 'fiscal_periods'
)
ORDER BY tablename, policyname;
-- Expect: exactly one *_owner_partner_all policy per table (no leftover
-- *_authenticated_all rows), and the journal_entries/journal_lines/
-- ledger_entries rows' qual/with_check text identical in shape to
-- accounts/fiscal_periods' own rows (both should read as
-- get_my_role() = ANY (ARRAY['owner'::text, 'partner'::text]) or
-- equivalent -- Postgres may normalize the IN (...) text this way; compare
-- the actual stored text, don't assume).
--
-- IMPORTANT — what 3a/3b/3c prove and do not prove:
--   - 3a/3b confirm the function body and ACL changed exactly as intended.
--   - 3c confirms the POLICY DEFINITION matches the proven shape -- it does
--     NOT confirm the policy actually blocks anyone. Both queries above are
--     introspection run as postgres; they say nothing about enforcement.

-- 3d. Real REST-level regression check for the three legitimate SELECT call
--     sites (expense-service.ts, production-accounting-service.ts,
--     sale-accounting-service.ts), using a REAL owner or partner user's
--     access token -- not the service_role key, not the SQL Editor. Ask
--     Mykola for a fresh access token (e.g. copy it from the browser's
--     network tab on an authenticated request, or via
--     supabase.auth.getSession() in a console) and run:
--
--   curl -s "$SUPABASE_URL/rest/v1/journal_entries?select=id,status&limit=1" \
--     -H "apikey: $SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $OWNER_OR_PARTNER_ACCESS_TOKEN"
--
-- Expect: HTTP 200 with a JSON array (possibly empty if no journal_entries
-- exist yet) -- NOT a 401/403/42501. This confirms the tightened policy
-- still allows a genuine owner/partner session to read journal_entries,
-- which is all three existing call sites ever do.
--
-- 3e. DEFERRED, NOT DONE HERE — the true RLS negative case. Once a Seller
--     (or any non-owner/partner) Supabase Auth user actually exists, run
--     the same curl command as 3d but with that user's access token.
--     Expect: HTTP 401/403 (PostgREST translates a denied RLS row into an
--     empty result set for SELECT, or a permission error for INSERT/UPDATE/
--     DELETE — confirm the exact PostgREST behavior for a SELECT-denied-by-
--     RLS case empirically at that time, since it may return 200 with an
--     empty array rather than an error code, which is normal RLS behavior
--     for SELECT and would still mean "correctly blocked", not a failure).
--     This step cannot be completed today and must not be treated as done.
