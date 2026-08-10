-- Finished Goods Batch Consumptions (DEV-021)
-- Run in Supabase SQL editor after sql/007_complete_production.sql
-- (requires production_batches).
--
-- Append-only Finished Goods consumption ledger.
-- Each row is an immutable movement against a production_batch.
--
-- Remaining quantity is NEVER stored here or on production_batches.
-- It is always calculated:
--   Remaining = produced_quantity
--             − SUM(out quantities)
--             + SUM(in quantities)
--
-- This migration creates SCHEMA ONLY:
--   - no RPCs
--   - no triggers
--   - no views
--   - no allocation / FIFO logic
--
-- Does not modify production_batches or any other existing table.

-- ---------------------------------------------------------------------------
-- finished_goods_batch_consumptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finished_goods_batch_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  production_batch_id uuid NOT NULL
    REFERENCES production_batches (id),

  quantity numeric(12, 3) NOT NULL
    CHECK (quantity > 0),

  unit_cost numeric(12, 4) NOT NULL
    CHECK (unit_cost >= 0),

  total_cost numeric(14, 4) NOT NULL
    CHECK (total_cost >= 0),

  direction text NOT NULL
    CHECK (direction IN ('out', 'in')),

  reason text NOT NULL
    CHECK (
      reason IN (
        'sale',
        'internal_use',
        'waste',
        'spoilage',
        'stock_count',
        'manual_adjustment',
        'recipe_consumption',
        'return_restock'
      )
    ),

  source_type text NOT NULL
    CHECK (
      source_type IN (
        'sale_line',
        'pos_line',
        'order_line',
        'waste_ticket',
        'stock_count_line',
        'adjustment',
        'production_session_line'
      )
    ),

  source_id uuid NOT NULL,

  allocation_mode text NOT NULL DEFAULT 'fifo'
    CHECK (allocation_mode IN ('fifo', 'explicit_batch')),

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  CONSTRAINT finished_goods_batch_consumptions_total_cost_chk
    CHECK (total_cost = quantity * unit_cost)
);

COMMENT ON TABLE finished_goods_batch_consumptions IS
  'Append-only Finished Goods batch consumption ledger. Never store remaining_quantity; never mutate production_batches.';

-- ---------------------------------------------------------------------------
-- Indexes (DEV-020 justified only)
-- ---------------------------------------------------------------------------

-- Remaining reconstruction / batch lock path
CREATE INDEX IF NOT EXISTS finished_goods_batch_consumptions_batch_id_idx
  ON finished_goods_batch_consumptions (production_batch_id);

-- Source document lookup + idempotency foundation
CREATE INDEX IF NOT EXISTS finished_goods_batch_consumptions_source_idx
  ON finished_goods_batch_consumptions (source_type, source_id);

-- One consumption layer per source document line + batch
CREATE UNIQUE INDEX IF NOT EXISTS finished_goods_batch_consumptions_source_batch_uidx
  ON finished_goods_batch_consumptions (source_type, source_id, production_batch_id);

-- Reporting by reason over time
CREATE INDEX IF NOT EXISTS finished_goods_batch_consumptions_reason_created_at_idx
  ON finished_goods_batch_consumptions (reason, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS (table access; mutations still belong to future RPCs)
-- ---------------------------------------------------------------------------

ALTER TABLE finished_goods_batch_consumptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'finished_goods_batch_consumptions'
      AND policyname = 'finished_goods_batch_consumptions_authenticated_all'
  ) THEN
    CREATE POLICY finished_goods_batch_consumptions_authenticated_all
      ON finished_goods_batch_consumptions
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
