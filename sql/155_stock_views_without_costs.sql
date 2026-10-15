-- sql/155 — audit S4/U5 phase 2a: stock read models WITHOUT costs for sellers.
--
-- Sellers need stock QUANTITIES (POS "can be sold now", Inventory and
-- Finished goods tabs, ingredient names in the read-only recipe view), but
-- must not see costs. Today those screens read tables/views that also carry
-- cost_per_unit, unit_cost and stock value. Phase 2b will close those tables
-- to owner/partner; before that, the app switches its seller screens to these
-- three views.
--
--   ingredient_stock_levels        id, name, category_id, unit, current_stock,
--                                  minimum_stock, active
--   finished_goods_stock_batches   production_batch_id, product_id,
--                                  batch_number, produced_at,
--                                  produced_quantity, available_quantity
--   finished_goods_stock_summary   product_id, product_name, available_quantity,
--                                  active_batch_count, oldest_batch_at,
--                                  newest_batch_at, production_status
--
-- Same numbers as finished_goods_batch_availability /
-- report_finished_goods_summary (checked by the test), minus every cost column.
--
-- The views run with the rights of their owner (security_invoker = false), so
-- they keep working after phase 2b restricts the underlying tables. They
-- return rows only to a signed-in user with an active role (get_my_role()), and
-- are not granted to anon. Nothing else changes: no existing view, table,
-- policy or function is touched, so the current app keeps working.

DO $pre155$
BEGIN
  IF to_regprocedure('public.get_my_role()') IS NULL
     OR to_regclass('public.finished_goods_batch_availability') IS NULL
     OR to_regclass('public.report_finished_goods_summary') IS NULL THEN
    RAISE EXCEPTION 'sql/155: expected objects are missing';
  END IF;
  IF to_regclass('public.ingredient_stock_levels') IS NOT NULL
     OR to_regclass('public.finished_goods_stock_batches') IS NOT NULL
     OR to_regclass('public.finished_goods_stock_summary') IS NOT NULL THEN
    RAISE EXCEPTION 'sql/155: already applied';
  END IF;
  -- An owner-rights view only sees past RLS if the tables do not FORCE it.
  IF EXISTS (SELECT 1 FROM pg_class
             WHERE oid IN ('public.ingredients'::regclass, 'public.production_batches'::regclass,
                           'public.finished_goods_batch_consumptions'::regclass, 'public.recipes'::regclass)
               AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'sql/155: a source table has FORCE ROW LEVEL SECURITY — review';
  END IF;
END;
$pre155$;

CREATE VIEW public.ingredient_stock_levels
WITH (security_invoker = false) AS
SELECT i.id, i.name, i.category_id, i.unit, i.current_stock, i.minimum_stock, i.active
FROM public.ingredients i
WHERE public.get_my_role() IN ('owner', 'partner', 'seller');

CREATE VIEW public.finished_goods_stock_batches
WITH (security_invoker = false) AS
SELECT pb.id AS production_batch_id,
       pb.finished_good_id AS product_id,
       pb.batch_number,
       pb.produced_at,
       pb.produced_quantity,
       pb.produced_quantity
         - COALESCE(m.out_quantity, 0::numeric)
         + COALESCE(m.in_quantity, 0::numeric) AS available_quantity
FROM public.production_batches pb
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(c.quantity) FILTER (WHERE c.direction = 'out'), 0::numeric) AS out_quantity,
         COALESCE(sum(c.quantity) FILTER (WHERE c.direction = 'in'), 0::numeric) AS in_quantity
  FROM public.finished_goods_batch_consumptions c
  WHERE c.production_batch_id = pb.id
) m ON true
WHERE public.get_my_role() IN ('owner', 'partner', 'seller');

CREATE VIEW public.finished_goods_stock_summary
WITH (security_invoker = false) AS
SELECT b.product_id,
       r.name AS product_name,
       COALESCE(sum(b.available_quantity) FILTER (WHERE b.available_quantity > 0), 0::numeric)
         AS available_quantity,
       count(*) FILTER (WHERE b.available_quantity > 0) AS active_batch_count,
       min(b.produced_at) FILTER (WHERE b.available_quantity > 0) AS oldest_batch_at,
       max(b.produced_at) FILTER (WHERE b.available_quantity > 0) AS newest_batch_at,
       CASE
         WHEN COALESCE(sum(b.available_quantity) FILTER (WHERE b.available_quantity > 0), 0::numeric) <= 0
           THEN 'out_of_stock'
         ELSE 'available'
       END AS production_status
FROM public.finished_goods_stock_batches b
LEFT JOIN public.recipes r ON r.id = b.product_id
GROUP BY b.product_id, r.name;

REVOKE ALL ON public.ingredient_stock_levels, public.finished_goods_stock_batches,
              public.finished_goods_stock_summary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ingredient_stock_levels, public.finished_goods_stock_batches,
                public.finished_goods_stock_summary TO authenticated;
