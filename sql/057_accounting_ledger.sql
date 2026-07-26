-- Accounting Ledger Foundation (DEV-087)
-- Run in Supabase SQL editor after sql/056_accounting_journals.sql.
--
-- SCHEMA ONLY:
--   ledger_entries
--
-- Append-only general ledger facts for future Trial Balance / P&L /
-- Balance Sheet / Cash Flow projections.
-- Immutable via triggers (no UPDATE / DELETE).
--
-- Does NOT:
--   - create posting engine / RPCs / automatic postings
--   - materialize ledger rows from journals automatically
--   - create VAT tables or financial statement views
--   - modify Inventory / Purchases / Production / Sales / Reporting
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- ledger_entries (append-only GL facts)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  journal_entry_id uuid NOT NULL
    REFERENCES journal_entries (id) ON DELETE RESTRICT,

  journal_line_id uuid NOT NULL
    REFERENCES journal_lines (id) ON DELETE RESTRICT,

  fiscal_period_id uuid NOT NULL
    REFERENCES fiscal_periods (id) ON DELETE RESTRICT,

  account_id uuid NOT NULL
    REFERENCES accounts (id) ON DELETE RESTRICT,

  entry_date date NOT NULL,

  debit_base numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (debit_base >= 0),
  credit_base numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (credit_base >= 0),

  debit_transaction numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (debit_transaction >= 0),
  credit_transaction numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (credit_transaction >= 0),

  transaction_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,
  base_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_entries_journal_line_id_key UNIQUE (journal_line_id),

  CONSTRAINT ledger_entries_transaction_single_side
    CHECK (NOT (debit_transaction > 0 AND credit_transaction > 0)),

  CONSTRAINT ledger_entries_base_single_side
    CHECK (NOT (debit_base > 0 AND credit_base > 0)),

  CONSTRAINT ledger_entries_has_amount
    CHECK (
      debit_transaction > 0
      OR credit_transaction > 0
      OR debit_base > 0
      OR credit_base > 0
    )
);

COMMENT ON TABLE ledger_entries IS
  'Append-only General Ledger facts. Never update or delete; reverse via new journal + ledger rows.';

CREATE INDEX IF NOT EXISTS ledger_entries_account_date_idx
  ON ledger_entries (account_id, entry_date);

CREATE INDEX IF NOT EXISTS ledger_entries_period_account_idx
  ON ledger_entries (fiscal_period_id, account_id);

CREATE INDEX IF NOT EXISTS ledger_entries_journal_entry_id_idx
  ON ledger_entries (journal_entry_id);

CREATE INDEX IF NOT EXISTS ledger_entries_entry_date_idx
  ON ledger_entries (entry_date DESC);

CREATE INDEX IF NOT EXISTS ledger_entries_base_currency_idx
  ON ledger_entries (base_currency);

-- ---------------------------------------------------------------------------
-- Immutability (append-only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting_reject_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_entries is append-only and does not allow %.',
    TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON ledger_entries;
CREATE TRIGGER ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION accounting_reject_ledger_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'ledger_entries'
      AND policyname = 'ledger_entries_authenticated_all'
  ) THEN
    CREATE POLICY ledger_entries_authenticated_all
      ON ledger_entries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
