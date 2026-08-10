-- Global Search Foundation (DEV-046)
-- Run in Supabase SQL editor after:
--   sql/020_reporting_foundation.sql
--   sql/018_create_customers.sql
--   sql/019_create_suppliers.sql
--   sql/002_create_recipes.sql
--
-- Unified read-only search index:
--   global_search
--
-- Reuses report_*_summary where possible; masters for customers/suppliers/recipes.
-- search_text concatenates searchable fields for future ILIKE / full-text queries.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers / Suppliers
--   - recalculate FIFO or rewrite ledger / consumptions
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW global_search AS
-- Ingredients
SELECT
  'ingredient'::text AS entity_type,
  i.ingredient_id AS entity_id,
  NULL::text AS code,
  i.ingredient_name AS title,
  i.unit AS subtitle,
  CASE
    WHEN i.is_below_minimum IS TRUE THEN 'below_minimum'
    ELSE 'ok'
  END AS status,
  lower(
    concat_ws(
      ' ',
      i.ingredient_name,
      i.unit,
      CASE
        WHEN i.is_below_minimum IS TRUE THEN 'below_minimum'
        ELSE 'ok'
      END
    )
  ) AS search_text
FROM report_inventory_summary i

UNION ALL

-- Finished goods (availability read model)
SELECT
  'finished_good'::text AS entity_type,
  f.product_id AS entity_id,
  NULL::text AS code,
  COALESCE(f.product_name, f.product_id::text) AS title,
  NULL::text AS subtitle,
  f.production_status AS status,
  lower(
    concat_ws(
      ' ',
      f.product_name,
      f.production_status
    )
  ) AS search_text
FROM report_finished_goods_summary f

UNION ALL

-- Recipes
SELECT
  'recipe'::text AS entity_type,
  r.id AS entity_id,
  NULL::text AS code,
  r.name AS title,
  NULL::text AS subtitle,
  CASE
    WHEN r.is_active IS TRUE THEN 'active'
    ELSE 'inactive'
  END AS status,
  lower(
    concat_ws(
      ' ',
      r.name,
      CASE
        WHEN r.is_active IS TRUE THEN 'active'
        ELSE 'inactive'
      END
    )
  ) AS search_text
FROM recipes r

UNION ALL

-- Customers
SELECT
  'customer'::text AS entity_type,
  c.id AS entity_id,
  c.code,
  c.name AS title,
  NULLIF(
    concat_ws(' · ', c.email, c.phone),
    ''
  ) AS subtitle,
  CASE
    WHEN c.is_active IS TRUE THEN 'active'
    ELSE 'inactive'
  END AS status,
  lower(
    concat_ws(
      ' ',
      c.code,
      c.name,
      c.email,
      c.phone,
      c.vat_number,
      CASE
        WHEN c.is_active IS TRUE THEN 'active'
        ELSE 'inactive'
      END
    )
  ) AS search_text
FROM customers c

UNION ALL

-- Suppliers
SELECT
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  s.code,
  s.name AS title,
  NULLIF(
    concat_ws(' · ', s.contact_name, s.email, s.phone),
    ''
  ) AS subtitle,
  CASE
    WHEN s.is_active IS TRUE THEN 'active'
    ELSE 'inactive'
  END AS status,
  lower(
    concat_ws(
      ' ',
      s.code,
      s.name,
      s.contact_name,
      s.email,
      s.phone,
      s.vat_number,
      CASE
        WHEN s.is_active IS TRUE THEN 'active'
        ELSE 'inactive'
      END
    )
  ) AS search_text
FROM suppliers s

UNION ALL

-- Sales
SELECT
  'sale'::text AS entity_type,
  sale.sale_id AS entity_id,
  sale.sale_number AS code,
  sale.sale_number AS title,
  sale.sale_date::text AS subtitle,
  sale.status,
  lower(
    concat_ws(
      ' ',
      sale.sale_number,
      sale.status,
      sale.sale_date::text
    )
  ) AS search_text
FROM report_sales_summary sale

UNION ALL

-- Purchases
SELECT
  'purchase'::text AS entity_type,
  p.purchase_id AS entity_id,
  p.invoice_number AS code,
  COALESCE(p.invoice_number, p.purchase_id::text) AS title,
  p.purchased_at::text AS subtitle,
  p.status,
  lower(
    concat_ws(
      ' ',
      p.invoice_number,
      p.status,
      p.purchased_at::text,
      p.currency
    )
  ) AS search_text
FROM report_purchase_summary p;

COMMENT ON VIEW global_search IS
  'Read-only unified search index across ingredients, finished goods, recipes, customers, suppliers, sales, and purchases. search_text is concatenated for future ILIKE/full-text. No mutations.';

GRANT SELECT ON global_search TO authenticated;
