-- Production Sessions (DEV-014)
-- Run in Supabase SQL editor after 004_create_production_plans.sql.
--
-- A Production Session is the execution document for a Production Plan.
-- It records actual produced quantities. It does NOT:
--   - mutate inventory
--   - create finished goods
--   - create production batches
-- Those belong to a later phase.
--
-- Production Plans remain immutable from this schema.

-- ---------------------------------------------------------------------------
-- Production sessions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  production_plan_id uuid NOT NULL REFERENCES production_plans (id),
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (
      status IN (
        'ready',
        'in_progress',
        'completed',
        'cancelled'
      )
    ),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  operator_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Session lines: planned vs actual per product (snapshot from plan products)
CREATE TABLE IF NOT EXISTS production_session_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_session_id uuid NOT NULL REFERENCES production_sessions (id) ON DELETE CASCADE,
  production_plan_product_id uuid REFERENCES production_plan_products (id) ON DELETE SET NULL,
  recipe_id uuid NOT NULL REFERENCES recipes (id),
  product_name text NOT NULL,
  planned_quantity numeric(12, 3) NOT NULL CHECK (planned_quantity > 0),
  actual_produced_quantity numeric(12, 3)
    CHECK (
      actual_produced_quantity IS NULL
      OR actual_produced_quantity >= 0
    ),
  yield_unit text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_sessions_plan_id_idx
  ON production_sessions (production_plan_id);
CREATE INDEX IF NOT EXISTS production_sessions_status_idx
  ON production_sessions (status);
CREATE INDEX IF NOT EXISTS production_sessions_started_at_idx
  ON production_sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS production_session_lines_session_id_idx
  ON production_session_lines (production_session_id);

-- At most one open session per plan (ready or in progress)
CREATE UNIQUE INDEX IF NOT EXISTS production_sessions_open_plan_uidx
  ON production_sessions (production_plan_id)
  WHERE status IN ('ready', 'in_progress');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE production_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_session_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_sessions'
      AND policyname = 'production_sessions_authenticated_all'
  ) THEN
    CREATE POLICY production_sessions_authenticated_all
      ON production_sessions
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_session_lines'
      AND policyname = 'production_session_lines_authenticated_all'
  ) THEN
    CREATE POLICY production_session_lines_authenticated_all
      ON production_session_lines
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
