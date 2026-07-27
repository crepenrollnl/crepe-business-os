-- Shift Management (DEV-112)
-- Run in Supabase SQL editor.
--
-- Operational container for the business day:
--   - at most one open shift at a time
--   - closed shifts are historical (append-only after close)
--
-- Does NOT modify Sales / Production / Accounting / Tax / Reporting.

-- ---------------------------------------------------------------------------
-- shifts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,

  status text NOT NULL
    CHECK (status IN ('open', 'closed')),

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  closed_by uuid,

  CONSTRAINT shifts_open_has_null_closed_at CHECK (
    (status = 'open' AND closed_at IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL)
  )
);

COMMENT ON TABLE shifts IS
  'Business-day shift container. Only one row may have status = open.';

-- Enforce a single active (open) shift.
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_uidx
  ON shifts ((true))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS shifts_status_idx
  ON shifts (status);

CREATE INDEX IF NOT EXISTS shifts_opened_at_idx
  ON shifts (opened_at DESC);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'shifts'
      AND policyname = 'shifts_authenticated_all'
  ) THEN
    CREATE POLICY shifts_authenticated_all
      ON shifts
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
