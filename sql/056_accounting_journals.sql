-- Accounting Journals Foundation (DEV-087)
-- Run in Supabase SQL editor after:
--   sql/007_complete_production.sql (transactions table; optional FK)
--   sql/053_accounting_currencies.sql
--   sql/054_accounting_fiscal_periods.sql
--   sql/055_accounting_chart_of_accounts.sql
--
-- SCHEMA ONLY:
--   journal_entries
--   journal_lines
--
-- Multi-currency line amounts (transaction + base).
-- tax_code reserved for future VAT.
-- business_event_id reserved for future Accounting Business Events (no FK yet).
--
-- Does NOT:
--   - create posting engine / RPCs / automatic postings
--   - create ledger_entries (see sql/057_accounting_ledger.sql)
--   - create business events, posting rules, or VAT tables
--   - modify Inventory / Purchases / Production / Sales / Reporting
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reserved for future accounting_business_events (no FK in DEV-087).
  business_event_id uuid,

  -- Optional link to ERP transaction spine when present.
  transaction_id uuid,

  fiscal_period_id uuid NOT NULL
    REFERENCES fiscal_periods (id) ON DELETE RESTRICT,

  entry_date date NOT NULL,

  memo text,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'voided')),

  transaction_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,
  base_currency text NOT NULL
    REFERENCES currencies (code) ON DELETE RESTRICT,

  exchange_rate numeric(18, 6) NOT NULL DEFAULT 1
    CHECK (exchange_rate > 0),

  reversal_of_journal_entry_id uuid
    REFERENCES journal_entries (id) ON DELETE RESTRICT,

  posted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT journal_entries_posted_at_when_posted
    CHECK (
      (status = 'draft' AND posted_at IS NULL)
      OR (status IN ('posted', 'voided'))
    )
);

COMMENT ON TABLE journal_entries IS
  'Double-entry journal headers. Posted/voided rows are immutable; corrections use reversing entries.';

COMMENT ON COLUMN journal_entries.business_event_id IS
  'Reserved for future Accounting Business Event link. No FK until events table exists.';

COMMENT ON COLUMN journal_entries.exchange_rate IS
  'Rate used to convert transaction_currency amounts into base_currency for this entry.';

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_business_event_id_uidx
  ON journal_entries (business_event_id)
  WHERE business_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS journal_entries_fiscal_period_id_idx
  ON journal_entries (fiscal_period_id);

CREATE INDEX IF NOT EXISTS journal_entries_entry_date_idx
  ON journal_entries (entry_date DESC);

CREATE INDEX IF NOT EXISTS journal_entries_status_idx
  ON journal_entries (status);

CREATE INDEX IF NOT EXISTS journal_entries_transaction_id_idx
  ON journal_entries (transaction_id);

CREATE INDEX IF NOT EXISTS journal_entries_reversal_of_idx
  ON journal_entries (reversal_of_journal_entry_id);

-- Optional FK to transactions when that table exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'journal_entries_transaction_id_fkey'
  ) THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_transaction_id_fkey
      FOREIGN KEY (transaction_id)
      REFERENCES transactions (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- journal_lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  journal_entry_id uuid NOT NULL
    REFERENCES journal_entries (id) ON DELETE CASCADE,

  line_no integer NOT NULL
    CHECK (line_no > 0),

  account_id uuid NOT NULL
    REFERENCES accounts (id) ON DELETE RESTRICT,

  description text,

  debit_transaction numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (debit_transaction >= 0),
  credit_transaction numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (credit_transaction >= 0),

  debit_base numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (debit_base >= 0),
  credit_base numeric(18, 2) NOT NULL DEFAULT 0
    CHECK (credit_base >= 0),

  -- Reserved for future VAT posting (tax_rates / VAT return).
  tax_code text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT journal_lines_entry_line_no_key
    UNIQUE (journal_entry_id, line_no),

  CONSTRAINT journal_lines_transaction_single_side
    CHECK (NOT (debit_transaction > 0 AND credit_transaction > 0)),

  CONSTRAINT journal_lines_base_single_side
    CHECK (NOT (debit_base > 0 AND credit_base > 0)),

  CONSTRAINT journal_lines_has_amount
    CHECK (
      debit_transaction > 0
      OR credit_transaction > 0
      OR debit_base > 0
      OR credit_base > 0
    )
);

COMMENT ON TABLE journal_lines IS
  'Journal lines with transaction-currency and base-currency debit/credit. tax_code reserved for future VAT.';

COMMENT ON COLUMN journal_lines.tax_code IS
  'Optional VAT/tax code for future VAT-ready posting. No FK in DEV-087.';

CREATE INDEX IF NOT EXISTS journal_lines_journal_entry_id_idx
  ON journal_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS journal_lines_account_id_idx
  ON journal_lines (account_id);

CREATE INDEX IF NOT EXISTS journal_lines_tax_code_idx
  ON journal_lines (tax_code);

-- ---------------------------------------------------------------------------
-- Immutability for posted / voided journals
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accounting_reject_posted_journal_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted', 'voided') THEN
      RAISE EXCEPTION
        'Posted or voided journal entries are immutable and cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status IN ('posted', 'voided') THEN
    RAISE EXCEPTION
      'Posted or voided journal entries are immutable and cannot be updated.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entries_immutable_posted ON journal_entries;
CREATE TRIGGER journal_entries_immutable_posted
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION accounting_reject_posted_journal_mutation();

CREATE OR REPLACE FUNCTION accounting_reject_posted_journal_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
  v_journal_id uuid;
BEGIN
  v_journal_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT je.status
  INTO v_status
  FROM journal_entries je
  WHERE je.id = v_journal_id;

  IF v_status IN ('posted', 'voided') THEN
    RAISE EXCEPTION
      'Journal lines for posted or voided journal entries are immutable.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_lines_immutable_posted ON journal_lines;
CREATE TRIGGER journal_lines_immutable_posted
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW
  EXECUTE FUNCTION accounting_reject_posted_journal_line_mutation();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'journal_entries'
      AND policyname = 'journal_entries_authenticated_all'
  ) THEN
    CREATE POLICY journal_entries_authenticated_all
      ON journal_entries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'journal_lines'
      AND policyname = 'journal_lines_authenticated_all'
  ) THEN
    CREATE POLICY journal_lines_authenticated_all
      ON journal_lines
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
