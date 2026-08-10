-- E2E test data cleanup (manual, periodic).
--
-- NOT run automatically — never from CI, never from a test, never by an
-- agent. Run by hand in the Supabase SQL Editor whenever "TEST "-prefixed
-- clutter from e2e/*.spec.ts (see e2e/README.md "Test data policy",
-- decision 09.08.2026) is worth clearing out of the shared dev project.
--
-- How to run:
--   1. Paste this whole file into the Supabase SQL Editor.
--   2. Wrap it yourself: start with `BEGIN;`, run everything below, then
--      inspect the row counts each DELETE reports.
--   3. If the counts look right (only TEST-prefixed rows affected), run
--      `COMMIT;`. If anything looks off, run `ROLLBACK;` instead.
--   This file intentionally contains no BEGIN/COMMIT/ROLLBACK of its own —
--   that decision belongs to whoever runs it, every time, not to the file.
--
-- Deletion order follows the real FK dependency chain (verified against
-- sql/001_create_purchases.sql, sql/002_create_recipes.sql,
-- sql/004_create_production_plans.sql, sql/006_create_production_sessions.sql,
-- sql/007_complete_production.sql, sql/013_create_sales.sql,
-- sql/019_create_suppliers.sql, and sql/085_recipe_assembly_layer.sql):
--   purchase_items --(purchase_id)--> purchases --(supplier_id)--> suppliers
--   purchase_items --(ingredient_id)--> ingredients
--   production_batches --(production_session_id)--> production_sessions
--   production_batches --(production_session_line_id)--> production_session_lines
--   production_batches --(recipe_id)--> recipes
--   production_sessions --(production_plan_id)--> production_plans
--   production_plan_ingredients --(production_plan_id)--> production_plans
--   production_plan_products --(production_plan_id)--> production_plans
--   production_plan_products --(recipe_id)--> recipes
--   sale_lines --(sale_id)--> sales
--   recipe_components --(assembly_recipe_id)--> recipes
--   recipe_components --(component_recipe_id)--> recipes
--   recipe_items --(recipe_id)--> recipes
--   recipe_items --(ingredient_id)--> ingredients
-- production_session_lines.production_session_id IS ON DELETE CASCADE from
-- production_sessions, every *.production_plan_id FK above is also
-- ON DELETE CASCADE from production_plans, sale_lines.sale_id is
-- ON DELETE CASCADE from sales, recipe_components.assembly_recipe_id is
-- ON DELETE CASCADE from recipes, and recipe_items.recipe_id is
-- ON DELETE CASCADE from recipes -- all still deleted explicitly first
-- anyway, same reasoning as purchase_items below: this script should not
-- silently depend on a TEST row never ending up referenced from an
-- unexpected direction. production_batches' three FKs (session, session
-- line, recipe) are plain (NOT cascading) -- production_batches must be
-- deleted before production_sessions, or the cascade from deleting
-- production_sessions into production_session_lines would itself hit a
-- blocking FK violation from production_batches still referencing those
-- lines. production_plan_products.recipe_id, recipe_components.
-- component_recipe_id, and recipe_items.ingredient_id are also NOT
-- cascading, so recipes/ingredients must not be deleted before their
-- referencing rows are gone.
--
-- sale_lines.product_id has NO foreign key at all (by design -- see
-- sql/013_create_sales.sql and the sale-confirm E2E investigation this
-- session: "finished_good_id = recipe_id" is a planning convention, not a
-- master-table reference). So a TEST sale cannot be found by a schema
-- constraint; it's identified here purely by content -- a sale_lines row
-- whose product_id equals a TEST-named recipe's id (that recipe is always
-- the TEST Assembly product sold in e2e/sale-confirm.spec.ts). This means
-- the "sales" delete below must run BEFORE the "recipes" delete lower in
-- this file, while sale_lines/recipes still hold the rows it joins through
-- -- unlike every other step here, this one is not FK-ordering, it's
-- query-ordering.
--
-- Not covered, and intentionally so: journal_entries and ledger_entries.
-- Production Execution's "Finish Production" and Sales' "Confirm Sale" can
-- both post a real accounting journal entry -- but per docs/ACCOUNTING.md,
-- posted journals and ledger entries are append-only/immutable by
-- architecture: "Posted journals are immutable. Corrections use reversal /
-- adjusting entries, never silent edits." There is no DELETE path for
-- these tables in this project at all, by design, so this script does not
-- attempt one. Any journal entry a TEST run posts in the shared dev
-- project stays there permanently -- an accepted side effect of E2E work
-- continuing in the shared dev database, not something this cleanup
-- script is meant to solve.
--
-- Also not covered (out of scope for the specs that exist today):
-- purchases.production_plan_id is a plain (non-cascading) FK to
-- production_plans. No existing spec ever calls "Send to Purchases" on a
-- TEST plan, so no TEST plan is ever referenced that way today. A future
-- spec that does will need to extend this script further.

-- 1. purchase_items referencing TEST purchases or TEST ingredients.
DELETE FROM purchase_items
WHERE purchase_id IN (
  SELECT p.id
  FROM purchases p
  JOIN suppliers s ON s.id = p.supplier_id
  WHERE s.name LIKE 'TEST %'
)
OR ingredient_id IN (
  SELECT id FROM ingredients WHERE name LIKE 'TEST %'
);

-- 2. purchases placed with a TEST supplier.
DELETE FROM purchases
WHERE supplier_id IN (
  SELECT id FROM suppliers WHERE name LIKE 'TEST %'
);

-- 3. production_batches for TEST production sessions, or referencing TEST
--    recipes -- must run before production_sessions (see FK note above).
DELETE FROM production_batches
WHERE production_session_id IN (
  SELECT ps.id
  FROM production_sessions ps
  JOIN production_plans pp ON pp.id = ps.production_plan_id
  WHERE pp.name LIKE 'TEST %'
)
OR recipe_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
);

-- 4. TEST production sessions (now unreferenced by production_batches).
--    Cascades production_session_lines automatically.
DELETE FROM production_sessions
WHERE production_plan_id IN (
  SELECT id FROM production_plans WHERE name LIKE 'TEST %'
);

-- 5. production_plan_ingredients (requirements snapshot) for TEST plans.
DELETE FROM production_plan_ingredients
WHERE production_plan_id IN (
  SELECT id FROM production_plans WHERE name LIKE 'TEST %'
);

-- 6. production_plan_products for TEST plans, or referencing TEST recipes.
DELETE FROM production_plan_products
WHERE production_plan_id IN (
  SELECT id FROM production_plans WHERE name LIKE 'TEST %'
)
OR recipe_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
);

-- 7. TEST production plans (now unreferenced by their own children).
DELETE FROM production_plans
WHERE name LIKE 'TEST %';

-- 8. TEST sales -- identified via a sale_lines row selling a TEST-named
--    recipe (the only way to find them; see note above). Must run while
--    "recipes" still has the TEST rows this subquery joins through.
--    Cascades sale_lines automatically.
DELETE FROM sales
WHERE id IN (
  SELECT sale_id
  FROM sale_lines
  WHERE product_id IN (
    SELECT id FROM recipes WHERE name LIKE 'TEST %'
  )
);

-- 9. sale_lines selling a TEST recipe (defensive redundant pass -- catches
--    a TEST-product line that ended up on a non-TEST-named sale header,
--    which step 8 above would not find). Ordinarily a no-op: step 8's
--    cascade already removed these.
DELETE FROM sale_lines
WHERE product_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
);

-- 10. recipe_components linking a TEST assembly and/or TEST component
--     recipe -- must run before recipes (component_recipe_id is NOT
--     cascading).
DELETE FROM recipe_components
WHERE assembly_recipe_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
)
OR component_recipe_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
);

-- 11. recipe_items for TEST recipes, or referencing TEST ingredients.
DELETE FROM recipe_items
WHERE recipe_id IN (
  SELECT id FROM recipes WHERE name LIKE 'TEST %'
)
OR ingredient_id IN (
  SELECT id FROM ingredients WHERE name LIKE 'TEST %'
);

-- 12. TEST recipes (now unreferenced by production_batches/
--     production_plan_products/sale_lines/recipe_components/recipe_items).
DELETE FROM recipes
WHERE name LIKE 'TEST %';

-- 13. TEST ingredients (now unreferenced by purchase_items/recipe_items).
DELETE FROM ingredients
WHERE name LIKE 'TEST %';

-- 14. TEST suppliers (now unreferenced by purchases).
DELETE FROM suppliers
WHERE name LIKE 'TEST %';
