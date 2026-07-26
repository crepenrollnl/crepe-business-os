-- Production Planning schema (Phase 2)
-- Run in Supabase SQL editor after 002_create_recipes.sql and 001_create_purchases.sql.
-- Planning only: does NOT change inventory stock.
--
-- Future execution tables (production_orders / production_items from 003) remain
-- reserved for Start Production in a later phase.

-- ---------------------------------------------------------------------------
-- Production plans
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'planned',
        'waiting_for_purchases',
        'ready_to_produce',
        'completed',
        'cancelled'
      )
    ),
  planning_date date NOT NULL,
  notes text,
  shopping_list_generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Planned products (multi-recipe snapshot)
CREATE TABLE IF NOT EXISTS production_plan_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id uuid NOT NULL REFERENCES production_plans (id) ON DELETE CASCADE,
  recipe_id uuid NOT NULL REFERENCES recipes (id),
  recipe_name text NOT NULL,
  planned_quantity numeric(12, 3) NOT NULL CHECK (planned_quantity > 0),
  yield_quantity numeric(12, 3) NOT NULL CHECK (yield_quantity > 0),
  yield_unit text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ingredient requirements snapshot at planning time (immutable after create)
CREATE TABLE IF NOT EXISTS production_plan_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id uuid NOT NULL REFERENCES production_plans (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  ingredient_name text NOT NULL,
  unit text NOT NULL,
  required_quantity numeric(12, 3) NOT NULL CHECK (required_quantity > 0),
  inventory_quantity_at_planning numeric(12, 3) NOT NULL DEFAULT 0,
  missing_quantity numeric(12, 3) NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_plan_id, ingredient_id)
);

-- Shopping list recommendation (missing ingredients only)
CREATE TABLE IF NOT EXISTS production_plan_shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_plan_id uuid NOT NULL REFERENCES production_plans (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  ingredient_name text NOT NULL,
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_plan_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS production_plans_status_idx
  ON production_plans (status);
CREATE INDEX IF NOT EXISTS production_plans_planning_date_idx
  ON production_plans (planning_date DESC);
CREATE INDEX IF NOT EXISTS production_plan_products_plan_id_idx
  ON production_plan_products (production_plan_id);
CREATE INDEX IF NOT EXISTS production_plan_ingredients_plan_id_idx
  ON production_plan_ingredients (production_plan_id);
CREATE INDEX IF NOT EXISTS production_plan_shopping_items_plan_id_idx
  ON production_plan_shopping_items (production_plan_id);

-- ---------------------------------------------------------------------------
-- Link purchase drafts to production plans (optional workflow)
-- ---------------------------------------------------------------------------

ALTER TABLE purchases
  ALTER COLUMN supplier_id DROP NOT NULL;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS production_plan_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchases_production_plan_id_fkey'
  ) THEN
    ALTER TABLE purchases
      ADD CONSTRAINT purchases_production_plan_id_fkey
      FOREIGN KEY (production_plan_id)
      REFERENCES production_plans (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS purchases_production_plan_id_uidx
  ON purchases (production_plan_id)
  WHERE production_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchases_production_plan_id_idx
  ON purchases (production_plan_id);

-- Optional link from future execution orders back to a plan
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'production_orders'
  ) THEN
    ALTER TABLE production_orders
      ADD COLUMN IF NOT EXISTS production_plan_id uuid REFERENCES production_plans (id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE production_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_plan_shopping_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_plans'
      AND policyname = 'production_plans_authenticated_all'
  ) THEN
    CREATE POLICY production_plans_authenticated_all
      ON production_plans
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_plan_products'
      AND policyname = 'production_plan_products_authenticated_all'
  ) THEN
    CREATE POLICY production_plan_products_authenticated_all
      ON production_plan_products
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_plan_ingredients'
      AND policyname = 'production_plan_ingredients_authenticated_all'
  ) THEN
    CREATE POLICY production_plan_ingredients_authenticated_all
      ON production_plan_ingredients
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_plan_shopping_items'
      AND policyname = 'production_plan_shopping_items_authenticated_all'
  ) THEN
    CREATE POLICY production_plan_shopping_items_authenticated_all
      ON production_plan_shopping_items
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
