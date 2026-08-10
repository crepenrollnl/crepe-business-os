-- Accounting Fiscal Periods Foundation (DEV-087)
-- Run in Supabase SQL editor after sql/053_accounting_currencies.sql.
--
-- SCHEMA ONLY:
--   fiscal_periods
--
-- Controls future posting windows (open / closed / locked).
-- No posting engine and no automatic period close in this script.
--
-- Does NOT:
--   - create posting engine / RPCs / automatic postings
--   - create journal, ledger, VAT, or statement objects
--   - modify Inventory / Purchases / Production / Sales / Reporting
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- fiscal_periods
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,

  start_date date NOT NULL,
  end_date date NOT NULL,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'locked')),

  closed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_periods_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT fiscal_periods_name_key UNIQUE (name),
  CONSTRAINT fiscal_periods_date_range
    CHECK (start_date <= end_date),
  CONSTRAINT fiscal_periods_closed_at_when_closed
    CHECK (
      (status = 'open' AND closed_at IS NULL)
      OR (status IN ('closed', 'locked'))
    )
);

COMMENT ON TABLE fiscal_periods IS
  'Accounting fiscal periods. Posting Engine (future) may post only into open periods per policy.';

CREATE INDEX IF NOT EXISTS fiscal_periods_status_idx
  ON fiscal_periods (status);

CREATE INDEX IF NOT EXISTS fiscal_periods_date_range_idx
  ON fiscal_periods (start_date, end_date);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'fiscal_periods'
      AND policyname = 'fiscal_periods_authenticated_all'
  ) THEN
    CREATE POLICY fiscal_periods_authenticated_all
      ON fiscal_periods
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
