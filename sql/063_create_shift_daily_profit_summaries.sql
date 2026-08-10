-- Daily Profit Summary (DEV-115)
-- Run in Supabase SQL editor AFTER sql/060_create_shifts.sql.
--
-- One immutable profit snapshot per closed Shift.
-- Built once at close from frozen Sale Profit facts (DEV-110).
-- Does NOT modify Sales / Accounting / Tax / Reporting / Production schema.

-- ---------------------------------------------------------------------------
-- shift_daily_profit_summaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_daily_profit_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  shift_id uuid NOT NULL REFERENCES shifts (id),

  net_revenue numeric(12, 2) NOT NULL
    CHECK (net_revenue >= 0),
  total_cogs numeric(12, 2) NOT NULL
    CHECK (total_cogs >= 0),
  gross_profit numeric(12, 2) NOT NULL,
  -- null when net_revenue = 0 (undefined margin), same rule as sale profit.
  gross_margin_percent numeric(8, 2),

  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shift_daily_profit_summaries_shift_uidx UNIQUE (shift_id),

  CONSTRAINT shift_daily_profit_summaries_margin_null_when_zero_revenue CHECK (
    (net_revenue = 0 AND gross_margin_percent IS NULL)
    OR (net_revenue > 0 AND gross_margin_percent IS NOT NULL)
  )
);

COMMENT ON TABLE shift_daily_profit_summaries IS
  'Immutable daily profit summary for a closed Shift. Generated once from frozen sale profits; never recalculated.';

CREATE INDEX IF NOT EXISTS shift_daily_profit_summaries_generated_at_idx
  ON shift_daily_profit_summaries (generated_at DESC);

ALTER TABLE shift_daily_profit_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'shift_daily_profit_summaries'
      AND policyname = 'shift_daily_profit_summaries_authenticated_all'
  ) THEN
    CREATE POLICY shift_daily_profit_summaries_authenticated_all
      ON shift_daily_profit_summaries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
