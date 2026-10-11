-- Recipes: only owner/partner may create, change or delete (audit S1, step 3).
-- Run in the Supabase SQL editor after sql/140_rls_close_sales.sql.
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- Decision (Mykola, 2026-10-11): every change that affects money or stock is
-- made only by owner or partner. A recipe sets the selling price, the cost
-- and what a sale / production takes from stock, so a seller may read
-- recipes (POS, kitchen) but not change them.
--
-- Today recipes, recipe_items and recipe_components have the policy
--   <table>_authenticated_all  FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- (sql/002, sql/085), so any signed-in user can change them directly.
-- The app's Recipes screen writes these tables directly from the browser
-- (persistRecipe, replaceRecipeItems, replaceRecipeComponents,
-- updateRecipeImageUrl, deleteRecipe). That keeps working for owner/partner:
-- this file uses the same pattern as ingredients (sql/124):
--   <table>_authenticated_select        FOR SELECT  everyone signed in
--   <table>_owner_partner_insert/update/delete      only get_my_role() in (owner, partner)
-- Privileges: authenticated SELECT, INSERT, UPDATE, DELETE (RLS decides who);
-- no TRUNCATE/REFERENCES/TRIGGER; PUBLIC and anon nothing.
-- Recipe photos in storage are already owner/partner only (sql/103).
--
-- Note: for a seller, INSERT fails with a row-level security error, while
-- UPDATE/DELETE match no rows and change nothing (standard RLS). The Recipes
-- screen should be hidden from sellers (audit S4/U5); until then a seller
-- who tries to edit sees no change.
--
-- Does NOT: make recipe saving atomic (audit D8), change any function.

DO $s1_step3$
DECLARE
  v_table text;
  v_tables text[] := ARRAY['recipes', 'recipe_items', 'recipe_components'];
  v_role_check text := 'get_my_role() = ANY (ARRAY[''owner''::text, ''partner''::text])';
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Table public.% does not exist. Nothing changed.', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_all', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_select', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_owner_partner_insert', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_owner_partner_update', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_owner_partner_delete', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_table || '_authenticated_select', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',
      v_table || '_owner_partner_insert', v_table, v_role_check);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
      v_table || '_owner_partner_update', v_table, v_role_check, v_role_check);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',
      v_table || '_owner_partner_delete', v_table, v_role_check);

    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', v_table);
  END LOOP;

  RAISE NOTICE 'sql/141: recipes, recipe_items, recipe_components — read for all signed-in users, write for owner/partner only.';
END;
$s1_step3$;
