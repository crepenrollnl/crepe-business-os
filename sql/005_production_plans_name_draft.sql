-- Additive: Production Plan name + Draft status (DEV-008)
-- Run in Supabase SQL editor after 004_create_production_plans.sql.
-- Planning only: does NOT change inventory stock.

-- ---------------------------------------------------------------------------
-- Name column (required for create UI)
-- ---------------------------------------------------------------------------

ALTER TABLE production_plans
  ADD COLUMN IF NOT EXISTS name text;

UPDATE production_plans
SET name = 'Plan #' || plan_number::text
WHERE name IS NULL OR btrim(name) = '';

ALTER TABLE production_plans
  ALTER COLUMN name SET NOT NULL;

-- ---------------------------------------------------------------------------
-- Allow Draft status; default new plans to draft
-- ---------------------------------------------------------------------------

ALTER TABLE production_plans
  DROP CONSTRAINT IF EXISTS production_plans_status_check;

ALTER TABLE production_plans
  ADD CONSTRAINT production_plans_status_check
  CHECK (
    status IN (
      'draft',
      'planned',
      'waiting_for_purchases',
      'ready_to_produce',
      'completed',
      'cancelled'
    )
  );

ALTER TABLE production_plans
  ALTER COLUMN status SET DEFAULT 'draft';
