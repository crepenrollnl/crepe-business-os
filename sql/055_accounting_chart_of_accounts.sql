-- Accounting Chart of Accounts Foundation (DEV-087)
-- Run in Supabase SQL editor after sql/054_accounting_fiscal_periods.sql.
--
-- SCHEMA ONLY:
--   accounts
--
-- Hierarchical chart of accounts for future journal lines and statements.
-- No seed COA and no posting role bindings in this script.
--
-- Does NOT:
--   - create posting engine / RPCs / automatic postings
--   - create journal, ledger, VAT, or statement objects
--   - modify Inventory / Purchases / Production / Sales / Reporting
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL,
  name text NOT NULL,

  account_type text NOT NULL
    CHECK (
      account_type IN (
        'asset',
        'liability',
        'equity',
        'revenue',
        'expense',
        'contra_asset',
        'contra_liability'
      )
    ),

  parent_account_id uuid
    REFERENCES accounts (id) ON DELETE RESTRICT,

  -- Leaf accounts accept journal lines; headers are grouping-only.
  is_postable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT accounts_code_key UNIQUE (code),
  CONSTRAINT accounts_code_not_blank
    CHECK (length(btrim(code)) > 0),
  CONSTRAINT accounts_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT accounts_parent_not_self
    CHECK (parent_account_id IS NULL OR parent_account_id <> id)
);

COMMENT ON TABLE accounts IS
  'Chart of Accounts. Only postable leaf accounts should receive journal lines (enforced by future Posting Engine).';

COMMENT ON COLUMN accounts.is_postable IS
  'When false, account is a header/group node and must not receive journal lines.';

CREATE INDEX IF NOT EXISTS accounts_parent_account_id_idx
  ON accounts (parent_account_id);

CREATE INDEX IF NOT EXISTS accounts_account_type_idx
  ON accounts (account_type);

CREATE INDEX IF NOT EXISTS accounts_is_active_idx
  ON accounts (is_active);

CREATE INDEX IF NOT EXISTS accounts_is_postable_idx
  ON accounts (is_postable);

CREATE INDEX IF NOT EXISTS accounts_code_idx
  ON accounts (code);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'accounts'
      AND policyname = 'accounts_authenticated_all'
  ) THEN
    CREATE POLICY accounts_authenticated_all
      ON accounts
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
