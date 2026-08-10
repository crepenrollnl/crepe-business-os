-- Enable RLS on ingredients / ingredient_categories (V1 Phase 3 follow-up)
-- Run in Supabase SQL editor after sql/074_revoke_public_anon_access.sql.
--
-- Problem: ingredients and ingredient_categories predate every migration in
-- sql/ (per AGENTS.md, "current live tables") and never received RLS from
-- any file — unlike suppliers, the third table in that same original set,
-- which sql/019_create_suppliers.sql did enable RLS on. Confirmed
-- empirically after sql/074: an anonymous, unauthenticated call still
-- returned real ingredients-derived numbers (total_inventory_value,
-- inventory_items_below_minimum) via dashboard_summary, while
-- purchases/suppliers-derived columns in the same view correctly returned
-- zero. security_invoker on the views has nothing to enforce if the base
-- table itself never had an RLS policy.
--
-- Fix: same pattern used by every other table in the project —
-- ENABLE ROW LEVEL SECURITY + a single permissive
-- "<table>_authenticated_all" policy (FOR ALL TO authenticated
-- USING (true) WITH CHECK (true)).
--
-- Additive only:
--   RLS + policy for: ingredients, ingredient_categories
--
-- Does NOT:
--   - change either table's schema or data
--   - touch any other table, view, or function

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_categories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingredients'
      AND policyname = 'ingredients_authenticated_all'
  ) THEN
    CREATE POLICY ingredients_authenticated_all
      ON ingredients FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ingredient_categories'
      AND policyname = 'ingredient_categories_authenticated_all'
  ) THEN
    CREATE POLICY ingredient_categories_authenticated_all
      ON ingredient_categories FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;
