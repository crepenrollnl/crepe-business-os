-- Manual Operating Expense Entry (Critical Finding #3, Phase D, step 1)
-- Run in Supabase SQL editor after sql/081_accounting_v1_seed.sql
-- and sql/080_account_role_bindings.sql.
--
-- Investigation notes (recorded before writing this migration):
--   1. allocate_posting_number(p_entry_date) (sql/064) has no session-scoped
--      side effects beyond its own internal counter table
--      (journal_posting_sequences): it does an idempotent
--      INSERT ... ON CONFLICT DO NOTHING followed by an atomic
--      UPDATE ... RETURNING next_seq - 1 against a single row keyed by
--      fiscal_year. That row lock is independent of every other lock this
--      function takes (accounts, fiscal_periods, account_role_bindings are
--      all plain SELECTs here, no FOR UPDATE), so calling it partway through
--      this transaction introduces no new deadlock ordering risk.
--   2. It is a normal SECURITY DEFINER plpgsql function, not something wired
--      to only work via supabase.rpc(...) from TS -- nothing in its body
--      references request/session context (no auth.uid(), no GUC reads), so
--      "SELECT allocate_posting_number(p_expense_date) INTO v_posting_number"
--      from inside another SECURITY DEFINER function works identically to
--      calling it over PostgREST. (It has previously only ever been called
--      from posting-service.ts -- this is the first SQL-side caller -- but
--      nothing about its definition restricts that.)
--   3. currencies has an active 'EUR' row (seeded in sql/053, is_active =
--      true, never deactivated by any later migration) -- no blocker for
--      journal_entries.transaction_currency / base_currency.
-- No blockers found; proceeding to implementation.
--
-- Problem: Phase D needs a way to record operating expenses that are paid
-- immediately out of Cash/Bank (fuel, packaging, market fees, etc. -- the 14
-- Group 2 accounts seeded in sql/081, 6010-6140) and have each one post a
-- real, balanced, immutable double-entry journal in the same transaction --
-- consistent with every other money path in this project (Purchases,
-- Production, Sales). There is currently no table and no RPC for this at
-- all; expenses like these have no representation anywhere in Accounting.
--
-- Fix: a new expense_entries table (the durable, queryable record of what
-- was spent and why) plus a single SECURITY DEFINER RPC, record_expense,
-- that validates its inputs, builds a balanced journal entry
-- (Dr <chosen expense account> net, Dr VAT Input net's VAT if > 0,
-- Cr Cash/Bank gross) directly against journal_entries / journal_lines /
-- ledger_entries, allocates a real posting_number, marks the journal posted,
-- and only then inserts the expense_entries row referencing it -- all inside
-- one PL/pgSQL function body, i.e. one atomic transaction. Cash and VAT
-- Input accounts are resolved through account_role_bindings (roles 'cash'
-- and 'vat_input') rather than hardcoded account codes, so this stays
-- correct if those bindings are ever repointed.
--
-- Additive only:
--   table:    expense_entries
--   function: record_expense(p_account_id, p_expense_date, p_net_amount,
--             p_vat_amount, p_description, p_supplier) -> jsonb
--
-- Does NOT:
--   - change accounts / fiscal_periods / account_role_bindings /
--     journal_entries / journal_lines / ledger_entries schema
--   - change allocate_posting_number (sql/064)
--   - touch Purchases / Production / Sales / Finished Goods
--   - create any UI, hook, or service (separate follow-up step)
--   - implement Phase E (fixed assets / depreciation)

-- ---------------------------------------------------------------------------
-- expense_entries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expense_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  expense_date date NOT NULL,

  account_id uuid NOT NULL
    REFERENCES accounts (id) ON DELETE RESTRICT,

  description text NOT NULL,
  supplier text,

  net_amount numeric(12, 2) NOT NULL
    CHECK (net_amount >= 0),
  vat_amount numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (vat_amount >= 0),
  gross_amount numeric(12, 2) NOT NULL
    CHECK (gross_amount > 0),

  journal_entry_id uuid
    REFERENCES journal_entries (id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  CONSTRAINT expense_entries_gross_equals_net_plus_vat
    CHECK (gross_amount = net_amount + vat_amount)
);

COMMENT ON TABLE expense_entries IS
  'Manual operating expense records (Phase D), each paid immediately from Cash/Bank and posted as a balanced journal via record_expense(). journal_entry_id traces to the posted journal.';

CREATE INDEX IF NOT EXISTS expense_entries_expense_date_idx
  ON expense_entries (expense_date DESC);

CREATE INDEX IF NOT EXISTS expense_entries_account_id_idx
  ON expense_entries (account_id);

CREATE INDEX IF NOT EXISTS expense_entries_journal_entry_id_idx
  ON expense_entries (journal_entry_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE expense_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'expense_entries'
      AND policyname = 'expense_entries_authenticated_all'
  ) THEN
    CREATE POLICY expense_entries_authenticated_all
      ON expense_entries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Explicit table-level REVOKE in addition to RLS -- anon holds its own
-- direct grant on this project independent of PUBLIC membership (see
-- sql/074), same pattern as account_role_bindings / accounts / fiscal_periods
-- (sql/080, sql/082).
REVOKE ALL ON TABLE expense_entries FROM PUBLIC;
REVOKE ALL ON TABLE expense_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE expense_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- record_expense
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_expense(
  p_account_id uuid,
  p_expense_date date,
  p_net_amount numeric,
  p_vat_amount numeric,
  p_description text,
  p_supplier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account accounts%ROWTYPE;
  v_period fiscal_periods%ROWTYPE;
  v_cash_account_id uuid;
  v_vat_input_account_id uuid;
  v_net_amount numeric(12, 2);
  v_vat_amount numeric(12, 2);
  v_gross_amount numeric(12, 2);
  v_journal_entry_id uuid;
  v_line_no integer := 0;
  v_line_id uuid;
  v_posting_number text;
  v_expense_entry_id uuid;
  v_now timestamptz := now();
BEGIN
  -- 0. Basic input validation.
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Expense account is required.';
  END IF;

  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required.';
  END IF;

  IF p_net_amount IS NULL OR p_vat_amount IS NULL THEN
    RAISE EXCEPTION 'Net amount and VAT amount are required (VAT may be 0).';
  END IF;

  IF p_net_amount < 0 OR p_vat_amount < 0 THEN
    RAISE EXCEPTION 'Net amount and VAT amount cannot be negative.';
  END IF;

  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required.';
  END IF;

  -- Round once, up front, so the same rounded values are used for the
  -- journal lines and the expense_entries row -- avoids a mismatch between
  -- gross_amount and net_amount + vat_amount from rounding net/vat and the
  -- computed gross separately.
  v_net_amount := round(p_net_amount, 2);
  v_vat_amount := round(p_vat_amount, 2);
  v_gross_amount := v_net_amount + v_vat_amount;

  IF v_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Expense must have a positive total amount.';
  END IF;

  -- 1. Validate the chosen expense account.
  SELECT * INTO v_account
  FROM accounts
  WHERE id = p_account_id;

  IF NOT FOUND
    OR v_account.is_active IS NOT TRUE
    OR v_account.is_postable IS NOT TRUE
    OR v_account.account_type <> 'expense'
  THEN
    RAISE EXCEPTION 'Selected account is not a valid, active expense account.';
  END IF;

  -- 2. Find the open fiscal period covering the expense date.
  SELECT * INTO v_period
  FROM fiscal_periods
  WHERE status = 'open'
    AND p_expense_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open fiscal period covers this date.';
  END IF;

  -- 3. Resolve Cash/Bank and VAT Input accounts from account_role_bindings --
  -- never hardcode account codes here, so a repointed binding stays correct.
  SELECT account_id INTO v_cash_account_id
  FROM account_role_bindings
  WHERE role = 'cash' AND is_active = true
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account role binding is configured for cash.';
  END IF;

  IF v_vat_amount > 0 THEN
    SELECT account_id INTO v_vat_input_account_id
    FROM account_role_bindings
    WHERE role = 'vat_input' AND is_active = true
    LIMIT 1;

    IF v_vat_input_account_id IS NULL THEN
      RAISE EXCEPTION 'No active account role binding is configured for VAT input.';
    END IF;
  END IF;

  -- 4. Create the draft journal entry header.
  INSERT INTO journal_entries (
    fiscal_period_id,
    entry_date,
    memo,
    status,
    transaction_currency,
    base_currency,
    exchange_rate
  )
  VALUES (
    v_period.id,
    p_expense_date,
    'Expense: ' || p_description,
    'draft',
    'EUR',
    'EUR',
    1
  )
  RETURNING id INTO v_journal_entry_id;

  -- 5. Journal lines + mirrored ledger entries. Same currency and rate = 1,
  -- so transaction and base amounts are identical.

  -- Line: Dr <expense account> net_amount (skip if net is 0 -- an all-VAT
  -- expense would be unusual but must not insert a zero-amount line, which
  -- journal_lines_has_amount would reject anyway).
  IF v_net_amount > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO journal_lines (
      journal_entry_id, line_no, account_id, description,
      debit_transaction, credit_transaction, debit_base, credit_base
    )
    VALUES (
      v_journal_entry_id, v_line_no, p_account_id, p_description,
      v_net_amount, 0, v_net_amount, 0
    )
    RETURNING id INTO v_line_id;

    INSERT INTO ledger_entries (
      journal_entry_id, journal_line_id, fiscal_period_id, account_id,
      entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
      transaction_currency, base_currency
    )
    VALUES (
      v_journal_entry_id, v_line_id, v_period.id, p_account_id,
      p_expense_date, v_net_amount, 0, v_net_amount, 0,
      'EUR', 'EUR'
    );
  END IF;

  -- Line: Dr VAT Input vat_amount (only when VAT > 0).
  IF v_vat_amount > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO journal_lines (
      journal_entry_id, line_no, account_id, description,
      debit_transaction, credit_transaction, debit_base, credit_base
    )
    VALUES (
      v_journal_entry_id, v_line_no, v_vat_input_account_id, p_description,
      v_vat_amount, 0, v_vat_amount, 0
    )
    RETURNING id INTO v_line_id;

    INSERT INTO ledger_entries (
      journal_entry_id, journal_line_id, fiscal_period_id, account_id,
      entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
      transaction_currency, base_currency
    )
    VALUES (
      v_journal_entry_id, v_line_id, v_period.id, v_vat_input_account_id,
      p_expense_date, v_vat_amount, 0, v_vat_amount, 0,
      'EUR', 'EUR'
    );
  END IF;

  -- Line: Cr Cash/Bank gross_amount.
  v_line_no := v_line_no + 1;

  INSERT INTO journal_lines (
    journal_entry_id, line_no, account_id, description,
    debit_transaction, credit_transaction, debit_base, credit_base
  )
  VALUES (
    v_journal_entry_id, v_line_no, v_cash_account_id, p_description,
    0, v_gross_amount, 0, v_gross_amount
  )
  RETURNING id INTO v_line_id;

  INSERT INTO ledger_entries (
    journal_entry_id, journal_line_id, fiscal_period_id, account_id,
    entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
    transaction_currency, base_currency
  )
  VALUES (
    v_journal_entry_id, v_line_id, v_period.id, v_cash_account_id,
    p_expense_date, 0, v_gross_amount, 0, v_gross_amount,
    'EUR', 'EUR'
  );

  -- 6. Allocate the real posting number and mark the journal posted.
  SELECT allocate_posting_number(p_expense_date) INTO v_posting_number;

  UPDATE journal_entries
  SET
    status = 'posted',
    posting_number = v_posting_number,
    posted_at = v_now
  WHERE id = v_journal_entry_id;

  -- 7. Insert the expense_entries row referencing the posted journal.
  INSERT INTO expense_entries (
    expense_date, account_id, description, supplier,
    net_amount, vat_amount, gross_amount,
    journal_entry_id, created_by
  )
  VALUES (
    p_expense_date, p_account_id, p_description, p_supplier,
    v_net_amount, v_vat_amount, v_gross_amount,
    v_journal_entry_id, auth.uid()
  )
  RETURNING id INTO v_expense_entry_id;

  RETURN jsonb_build_object(
    'expense_entry_id', v_expense_entry_id,
    'journal_entry_id', v_journal_entry_id,
    'posting_number', v_posting_number
  );
END;
$$;

COMMENT ON FUNCTION record_expense(uuid, date, numeric, numeric, text, text) IS
  'Record a manual operating expense paid immediately from Cash/Bank: validates the chosen expense account and fiscal period, resolves Cash/Bank + VAT Input via account_role_bindings, posts a balanced journal (Dr expense [+ Dr VAT Input], Cr Cash/Bank) with a real posting_number, then inserts the expense_entries row referencing it -- all in one transaction.';

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION record_expense(uuid, date, numeric, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_expense(uuid, date, numeric, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_expense(uuid, date, numeric, numeric, text, text) TO authenticated;
