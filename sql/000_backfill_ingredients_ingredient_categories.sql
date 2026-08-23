-- sql/000_backfill_ingredients_ingredient_categories.sql
-- Backfill: public.ingredient_categories + public.ingredients
-- (tables that predate every numbered migration in sql/).
--
-- Schema verified against live production (crepe-business-V1) via
-- information_schema.columns / information_schema.table_constraints on
-- 2026-08-23. Run in Supabase SQL editor BEFORE sql/001 on an empty
-- database. On databases that already have these tables CREATE TABLE
-- IF NOT EXISTS is a no-op.
--
-- RLS is NOT in this file — sql/075_enable_ingredients_rls.sql remains the
-- canonical place for ENABLE ROW LEVEL SECURITY + *_authenticated_all.
--
-- Does NOT create suppliers (sql/019). ingredients.supplier_id FK below
-- assumes suppliers already exists — same pre-existing ordering gap noted
-- separately (sql/001 references suppliers before sql/019 creates it),
-- out of scope for this file.

CREATE TABLE IF NOT EXISTS ingredient_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES ingredient_categories (id),
  supplier_id uuid REFERENCES suppliers (id),
  unit text NOT NULL,
  current_stock numeric(12, 3) DEFAULT 0,
  minimum_stock numeric(12, 3) DEFAULT 0,
  cost_per_unit numeric(12, 2) DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
