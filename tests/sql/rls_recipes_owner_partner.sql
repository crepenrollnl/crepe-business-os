-- SQL test: sql/141 — recipes, recipe_items, recipe_components: read for every
-- signed-in user, write for owner/partner only (audit S1 step 3).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/rls_recipes_owner_partner.sql
-- (exit 0) after a full replay of sql/*.sql.
--
-- Scenarios:
--   A — catalog: 4 policies per table (SELECT all; INSERT/UPDATE/DELETE
--       owner/partner via get_my_role()); no TRUNCATE; anon nothing
--   B — owner does what the Recipes screen does (create, lines, update,
--       photo url, replace lines)
--   C — a seller reads every row but cannot insert (RLS error) and their
--       UPDATE/DELETE change nothing; no TRUNCATE
--   D — a user without an active profile cannot write
--   E — owner deletes a dish; recipe_components cascade
--   F — anon can neither read nor write

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun141_expect(
  p_label text, p_sqlstate text, p_message_like text, p_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_state text;
  v_err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%] for: %',
          p_label, p_sqlstate, p_message_like, v_state, v_err, p_sql;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun141_expect(text, text, text, text)
  TO authenticated, anon;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_tables text[] := ARRAY['recipes', 'recipe_items', 'recipe_components'];
  v_table text;
  v_count integer;
  v_ing uuid;
  v_comp uuid;
  v_dish uuid;
  v_item uuid;
  v_rc uuid;
  v_name text;
  v_price numeric;
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  -- ------------------------------------------------------------------
  -- A. Catalog: 4 policies per table, privileges.
  -- ------------------------------------------------------------------
  FOREACH v_table IN ARRAY v_tables
  LOOP
    SELECT count(*) INTO v_count FROM pg_policies
    WHERE schemaname = 'public' AND tablename = v_table;
    IF v_count <> 4
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = v_table || '_authenticated_select' AND cmd = 'SELECT' AND qual = 'true')
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = v_table || '_owner_partner_insert' AND cmd = 'INSERT'
                      AND with_check LIKE '%get_my_role()%owner%partner%')
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = v_table || '_owner_partner_update' AND cmd = 'UPDATE'
                      AND qual LIKE '%get_my_role()%owner%partner%'
                      AND with_check LIKE '%get_my_role()%owner%partner%')
       OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table
                      AND policyname = v_table || '_owner_partner_delete' AND cmd = 'DELETE'
                      AND qual LIKE '%get_my_role()%owner%partner%') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % policies wrong (% policies)', v_table, v_count;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_table, 'TRUNCATE')
       OR has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       OR NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR NOT has_table_privilege('authenticated', 'public.' || v_table, 'INSERT') THEN
      RAISE EXCEPTION 'SCENARIO A FAIL: % privileges wrong', v_table;
    END IF;
  END LOOP;

  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_S1S3_ing_' || v_tag, 'kg', 10, 0, 1.00, true)
  RETURNING id INTO v_ing;

  -- ------------------------------------------------------------------
  -- B. Owner/partner does what the Recipes screen does: create a
  --    component and a dish, items, components, update, photo url,
  --    replace lines, delete (with cascade).
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S3_comp_' || v_tag, 1, 'pcs', true, 'component')
  RETURNING id INTO v_comp;
  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_comp, v_ing, 0.1, 'kg')
  RETURNING id INTO v_item;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_S1S3_dish_' || v_tag, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_dish;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs')
  RETURNING id INTO v_rc;

  UPDATE recipes SET selling_price = 9.50, image_url = 'https://example.test/p.jpg'
  WHERE id = v_dish;
  UPDATE recipe_items SET quantity = 0.2 WHERE id = v_item;
  UPDATE recipe_components SET quantity = 2 WHERE id = v_rc;
  DELETE FROM recipe_components WHERE id = v_rc;
  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit)
  VALUES (v_dish, v_comp, 1, 'pcs')
  RETURNING id INTO v_rc;

  RESET ROLE;
  IF (SELECT selling_price FROM recipes WHERE id = v_dish) IS DISTINCT FROM 9.50
     OR (SELECT quantity FROM recipe_items WHERE id = v_item) IS DISTINCT FROM 0.2
     OR NOT EXISTS (SELECT 1 FROM recipe_components WHERE id = v_rc) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: owner writes did not land';
  END IF;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_n;
    v_counts := v_counts || jsonb_build_object(v_table, v_n);
  END LOOP;

  -- ------------------------------------------------------------------
  -- C. A SELLER reads everything but cannot create, change or delete.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_n;
    IF v_n IS DISTINCT FROM (v_counts ->> v_table)::bigint THEN
      RAISE EXCEPTION 'SCENARIO C FAIL: seller sees % rows in %, owner %', v_n, v_table, v_counts ->> v_table;
    END IF;
  END LOOP;

  PERFORM public.dryrun141_expect('SCENARIO C1 seller insert recipe', '42501', '%row-level security%',
    format('INSERT INTO public.recipes (name, yield_quantity, yield_unit, is_active, recipe_role) VALUES (%L, 1, %L, true, %L)',
           'TEST_S1S3_seller_' || v_tag, 'pcs', 'component'));
  PERFORM public.dryrun141_expect('SCENARIO C2 seller insert item', '42501', '%row-level security%',
    format('INSERT INTO public.recipe_items (recipe_id, ingredient_id, quantity, unit) VALUES (%L, %L, 1, %L)',
           v_comp, v_ing, 'kg'));
  PERFORM public.dryrun141_expect('SCENARIO C3 seller insert component', '42501', '%row-level security%',
    format('INSERT INTO public.recipe_components (assembly_recipe_id, component_recipe_id, quantity, unit) VALUES (%L, %L, 1, %L)',
           v_dish, v_comp, 'pcs'));
  PERFORM public.dryrun141_expect('SCENARIO C4 seller truncate', '42501', 'permission denied%',
    'TRUNCATE public.recipe_items');

  UPDATE recipes SET selling_price = 0.01, name = 'HACKED' WHERE id = v_dish;
  UPDATE recipe_items SET quantity = 99 WHERE id = v_item;
  UPDATE recipe_components SET quantity = 99 WHERE id = v_rc;
  DELETE FROM recipe_components WHERE id = v_rc;
  DELETE FROM recipe_items WHERE id = v_item;
  DELETE FROM recipes WHERE id = v_comp;

  RESET ROLE;
  SELECT name, selling_price INTO v_name, v_price FROM recipes WHERE id = v_dish;
  IF v_name IS DISTINCT FROM 'TEST_S1S3_dish_' || v_tag OR v_price IS DISTINCT FROM 9.50
     OR (SELECT quantity FROM recipe_items WHERE id = v_item) IS DISTINCT FROM 0.2
     OR (SELECT quantity FROM recipe_components WHERE id = v_rc) IS DISTINCT FROM 1
     OR NOT EXISTS (SELECT 1 FROM recipes WHERE id = v_comp) THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: a seller update/delete changed data';
  END IF;

  -- ------------------------------------------------------------------
  -- D. A user without an active profile can read but not write.
  -- ------------------------------------------------------------------
  UPDATE profiles SET role = v_original_role, is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun141_expect('SCENARIO D no profile insert', '42501', '%row-level security%',
    format('INSERT INTO public.recipes (name, yield_quantity, yield_unit, is_active, recipe_role) VALUES (%L, 1, %L, true, %L)',
           'TEST_S1S3_noprof_' || v_tag, 'pcs', 'component'));
  UPDATE recipes SET name = 'HACKED' WHERE id = v_dish;
  RESET ROLE;
  UPDATE profiles SET is_active = true WHERE auth_user_id = v_actor;
  IF (SELECT name FROM recipes WHERE id = v_dish) IS DISTINCT FROM 'TEST_S1S3_dish_' || v_tag THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: user without profile changed a recipe';
  END IF;

  -- ------------------------------------------------------------------
  -- E. Owner deletes the dish; its recipe_components go with it (cascade).
  -- ------------------------------------------------------------------
  SET LOCAL ROLE authenticated;
  DELETE FROM recipes WHERE id = v_dish;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM recipes WHERE id = v_dish)
     OR EXISTS (SELECT 1 FROM recipe_components WHERE id = v_rc) THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: owner delete / cascade did not happen';
  END IF;

  -- ------------------------------------------------------------------
  -- F. anon can neither read nor write.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM public.dryrun141_expect('SCENARIO F1 anon select', '42501', 'permission denied%',
    'SELECT count(*) FROM public.recipes');
  PERFORM public.dryrun141_expect('SCENARIO F2 anon insert', '42501', 'permission denied%',
    'INSERT INTO public.recipe_items DEFAULT VALUES');
  RESET ROLE;

  RAISE NOTICE 'sql/141 dry-run: scenarios A-F passed.';
END;
$test$;

ROLLBACK;
