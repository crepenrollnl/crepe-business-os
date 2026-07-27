-- Daily Sales Summary (DEV-114)
-- Run in Supabase SQL editor AFTER sql/060_create_shifts.sql.
--
-- One immutable commercial summary per closed Shift.
-- Generated once at shift close from completed sales in the shift window.
-- Does NOT modify Sales / Accounting / Tax / Reporting / Production schema.

-- ---------------------------------------------------------------------------
-- shift_daily_sales_summaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_daily_sales_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  shift_id uuid NOT NULL REFERENCES shifts (id),

  sales_count integer NOT NULL
    CHECK (sales_count >= 0),
  items_sold numeric(12, 3) NOT NULL
    CHECK (items_sold >= 0),
  gross_revenue numeric(12, 2) NOT NULL
    CHECK (gross_revenue >= 0),
  net_revenue numeric(12, 2) NOT NULL
    CHECK (net_revenue >= 0),
  average_receipt numeric(12, 2) NOT NULL
    CHECK (average_receipt >= 0),

  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT shift_daily_sales_summaries_shift_uidx UNIQUE (shift_id)
);

COMMENT ON TABLE shift_daily_sales_summaries IS
  'Immutable daily sales summary for a closed Shift. Generated once; never recalculated.';

CREATE INDEX IF NOT EXISTS shift_daily_sales_summaries_generated_at_idx
  ON shift_daily_sales_summaries (generated_at DESC);

ALTER TABLE shift_daily_sales_summaries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'shift_daily_sales_summaries'
      AND policyname = 'shift_daily_sales_summaries_authenticated_all'
  ) THEN
    CREATE POLICY shift_daily_sales_summaries_authenticated_all
      ON shift_daily_sales_summaries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
