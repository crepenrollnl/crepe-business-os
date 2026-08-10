-- Production execution tables (future Start Production phase)
-- Prefer sql/004_create_production_plans.sql for Production Planning (Phase 2).
-- These tables remain reserved for future execution: deduct ingredients,
-- create finished goods, and post production transactions.
-- Does NOT change inventory stock by itself.

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes (id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  planned_quantity numeric(12, 3) NOT NULL CHECK (planned_quantity > 0),
  planned_date date NOT NULL,
  notes text,
  produced_quantity numeric(12, 3) NOT NULL DEFAULT 0
    CHECK (produced_quantity >= 0),
  completed_at timestamptz,
  transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Reserved for future execution (ingredient consumption / finished output).
-- Phase 1 does not write to this table.
CREATE TABLE IF NOT EXISTS production_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id uuid NOT NULL REFERENCES production_orders (id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES ingredients (id),
  product_id uuid,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  direction text NOT NULL CHECK (direction IN ('input', 'output')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_orders_recipe_id_idx
  ON production_orders (recipe_id);
CREATE INDEX IF NOT EXISTS production_orders_status_idx
  ON production_orders (status);
CREATE INDEX IF NOT EXISTS production_orders_planned_date_idx
  ON production_orders (planned_date DESC);
CREATE INDEX IF NOT EXISTS production_items_production_order_id_idx
  ON production_items (production_order_id);
CREATE INDEX IF NOT EXISTS production_items_ingredient_id_idx
  ON production_items (ingredient_id);

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_orders'
      AND policyname = 'production_orders_authenticated_all'
  ) THEN
    CREATE POLICY production_orders_authenticated_all
      ON production_orders
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_items'
      AND policyname = 'production_items_authenticated_all'
  ) THEN
    CREATE POLICY production_items_authenticated_all
      ON production_items
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
