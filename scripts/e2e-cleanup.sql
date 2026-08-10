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
-- sql/001_create_purchases.sql and sql/019_create_suppliers.sql):
--   purchase_items --(purchase_id)--> purchases --(supplier_id)--> suppliers
--   purchase_items --(ingredient_id)--> ingredients
-- purchase_items.purchase_id already cascades on purchase delete, but it's
-- deleted explicitly first anyway so this script also covers a TEST
-- ingredient used on a non-TEST-supplier purchase (shouldn't happen from
-- e2e/purchase-receive.spec.ts as written, but the delete order should not
-- silently depend on that never happening).

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

-- 3. TEST ingredients (now unreferenced by purchase_items).
DELETE FROM ingredients
WHERE name LIKE 'TEST %';

-- 4. TEST suppliers (now unreferenced by purchases).
DELETE FROM suppliers
WHERE name LIKE 'TEST %';
