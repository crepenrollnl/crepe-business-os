-- Cash Reconciliation (DEV-113)
-- Run in Supabase SQL editor AFTER sql/060_create_shifts.sql.
--
-- One immutable reconciliation per closed Shift.
-- Does NOT modify Sales / Production / Accounting / Tax / Reporting.

-- ---------------------------------------------------------------------------
-- shift_cash_reconciliations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_cash_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  shift_id uuid NOT NULL REFERENCES shifts (id),

  expected_cash numeric(12, 2) NOT NULL,
  counted_cash numeric(12, 2) NOT NULL,
  difference numeric(12, 2) NOT NULL,

  notes text,

  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shift_cash_reconciliations_shift_uidx UNIQUE (shift_id),

  CONSTRAINT shift_cash_reconciliations_counted_non_negative CHECK (
    counted_cash >= 0
  ),

  CONSTRAINT shift_cash_reconciliations_difference_matches CHECK (
    difference = counted_cash - expected_cash
  )
);

COMMENT ON TABLE shift_cash_reconciliations IS
  'Immutable cash reconciliation for a closed Shift. One row per shift.';

CREATE INDEX IF NOT EXISTS shift_cash_reconciliations_reconciled_at_idx
  ON shift_cash_reconciliations (reconciled_at DESC);

ALTER TABLE shift_cash_reconciliations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'shift_cash_reconciliations'
      AND policyname = 'shift_cash_reconciliations_authenticated_all'
  ) THEN
    CREATE POLICY shift_cash_reconciliations_authenticated_all
      ON shift_cash_reconciliations
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
