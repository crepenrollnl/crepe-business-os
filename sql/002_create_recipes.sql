-- Recipes module schema
-- Run in Supabase SQL editor before using the Recipes feature.
-- Defines bill-of-materials only. Does not change inventory stock.

CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  yield_quantity numeric(12, 3) NOT NULL CHECK (yield_quantity > 0),
  yield_unit text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  UNIQUE (recipe_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS recipes_name_idx ON recipes (name);
CREATE INDEX IF NOT EXISTS recipes_is_active_idx ON recipes (is_active);
CREATE INDEX IF NOT EXISTS recipe_items_recipe_id_idx ON recipe_items (recipe_id);
CREATE INDEX IF NOT EXISTS recipe_items_ingredient_id_idx ON recipe_items (ingredient_id);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recipes' AND policyname = 'recipes_authenticated_all'
  ) THEN
    CREATE POLICY recipes_authenticated_all
      ON recipes
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recipe_items' AND policyname = 'recipe_items_authenticated_all'
  ) THEN
    CREATE POLICY recipe_items_authenticated_all
      ON recipe_items
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
