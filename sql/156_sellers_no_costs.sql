-- sql/156 — audit S4/U5 phase 2b + the rest of S2: the database stops
-- giving sellers costs, margins and stock values.
--
-- Mykola's rule (11.10/14.10): a seller sells, works the kitchen queue,
-- opens/closes the shift and counts the cash; sees stock QUANTITIES and
-- recipes (view only); never sees purchase prices, cost of goods, profit
-- or stock value. Phase 1 (PR #106) hid them on screen, phase 2a (sql/155,
-- PR #107) moved the seller screens to cost-free views. This file closes
-- the database side:
--
--   1. Four report RPCs become owner/partner only (they return COGS,
--      margins, stock values): get_reporting_workspace, get_sales_by_product,
--      verify_sale_cost_and_profit, get_inventory_movement_history_by_ingredient.
--      Exactly one line changes in each: the sql/145 guard
--        PERFORM require_role('owner', 'partner', 'seller');  -- sql/145
--      becomes
--        PERFORM require_role('owner', 'partner');  -- sql/156
--   2. close_shift, confirm_sale and create_and_confirm_sale still work for
--      sellers, but return profit_summary / total_cogs only to owner and
--      partner; a seller gets null in that field. Exactly one expression
--      changes in each (marked /* sql/156 */). Stock, journals and the
--      stored summaries are computed exactly as before.
--   3. Reading these tables directly becomes owner/partner only:
--      ingredients (purchase price), production_batches,
--      finished_goods_batch_consumptions, stock_movements, write_offs,
--      inventory_adjustments (unit costs), shift_daily_profit_summaries
--      (COGS, profit, margin), transactions (money amounts).
--      Sellers read quantities through the sql/155 views, which run with
--      the owner's rights and are not affected.
--   4. global_search (top-bar search, also for sellers) reads ingredients
--      and finished goods from the sql/155 views instead of the cost
--      reports, so it keeps working for sellers. Same rows for owner and
--      partner (checked below inside this transaction).
--   5. record_posting_failure is no longer callable from the app: since
--      audit D2 the database records posting failures itself, and nothing
--      in the database calls this function.
--
-- Writes are not touched (closed earlier by sql/138–143). Re-running stops
-- at the precheck ("already applied").

DO $pre156$
DECLARE
  v_t text;
  v_count integer;
BEGIN
  IF to_regclass('public.ingredient_stock_levels') IS NULL
     OR to_regclass('public.finished_goods_stock_summary') IS NULL
     OR to_regclass('public.global_search') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.record_posting_failure(text, text, uuid, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'sql/156: expected objects are missing (sql/155 applied?)';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc
             WHERE pronamespace = 'public'::regnamespace AND prosrc LIKE '%sql/156%') THEN
    RAISE EXCEPTION 'sql/156: already applied';
  END IF;

  -- Nothing in the database calls record_posting_failure.
  SELECT count(*) INTO v_count FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname <> 'record_posting_failure'
    AND prosrc ~ 'record_posting_failure\s*\(';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'sql/156: % database function(s) call record_posting_failure — review', v_count;
  END IF;

  -- Each table: RLS on and not forced, and the owner of the sql/155 views
  -- is not held back by RLS on it (it owns the table, or bypasses RLS) —
  -- otherwise those views would go empty for sellers. And exactly one
  -- SELECT-capable policy: <table>_authenticated_select = true.
  FOREACH v_t IN ARRAY ARRAY['ingredients', 'production_batches',
    'finished_goods_batch_consumptions', 'stock_movements', 'write_offs',
    'inventory_adjustments', 'shift_daily_profit_summaries', 'transactions']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c, pg_class v, pg_roles r
      WHERE c.oid = ('public.' || v_t)::regclass
        AND v.oid = 'public.ingredient_stock_levels'::regclass
        AND r.oid = v.relowner
        AND c.relrowsecurity AND NOT c.relforcerowsecurity
        AND (c.relowner = v.relowner OR r.rolbypassrls OR r.rolsuper)
    ) THEN
      RAISE EXCEPTION 'sql/156: % — RLS off/forced, or the sql/155 views would not see past it', v_t;
    END IF;
    IF (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = v_t AND cmd IN ('SELECT', 'ALL')) <> 1
       OR NOT EXISTS (
         SELECT 1 FROM pg_policies
         WHERE schemaname = 'public' AND tablename = v_t
           AND policyname = v_t || '_authenticated_select'
           AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
           AND roles = '{authenticated}'::name[] AND qual = 'true') THEN
      RAISE EXCEPTION 'sql/156: % — read policies are not the expected single "authenticated, true"', v_t;
    END IF;
  END LOOP;

  -- global_search: the columns the app reads, built on the two cost reports.
  IF (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum)
      FROM pg_attribute
      WHERE attrelid = 'public.global_search'::regclass AND attnum > 0 AND NOT attisdropped)
     IS DISTINCT FROM 'entity_type:text,entity_id:uuid,code:text,title:text,subtitle:text,status:text,search_text:text'
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.global_search'::regclass
                    AND reloptions @> ARRAY['security_invoker=true']) THEN
    RAISE EXCEPTION 'sql/156: global_search columns/options are not as expected';
  END IF;
  SELECT count(DISTINCT s.relname) INTO v_count
  FROM pg_rewrite r
  JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
  JOIN pg_class s ON s.oid = d.refobjid
  WHERE r.ev_class = 'public.global_search'::regclass AND s.oid <> r.ev_class
    AND s.relname IN ('report_inventory_summary', 'report_finished_goods_summary',
                      'recipes', 'customers', 'suppliers',
                      'report_sales_summary', 'report_purchase_summary');
  IF v_count <> 7 OR (
    SELECT count(DISTINCT d.refobjid) FROM pg_rewrite r
    JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_class s ON s.oid = d.refobjid
    WHERE r.ev_class = 'public.global_search'::regclass AND s.oid <> r.ev_class) <> 7 THEN
    RAISE EXCEPTION 'sql/156: global_search does not read the 7 expected sources';
  END IF;
END;
$pre156$;

-- ---------------------------------------------------------------------
-- 1 + 2. One-line / one-expression rewrites of 7 functions.
-- For each: the text to replace must occur exactly once in the body;
-- after the rewrite, putting the old text back must give the old body
-- byte for byte, and the function must still be SECURITY DEFINER.
-- ---------------------------------------------------------------------
DO $fn156$
DECLARE
  v_edits jsonb := jsonb_build_array(
    jsonb_build_array('get_reporting_workspace()',
      'PERFORM require_role(''owner'', ''partner'', ''seller'');  -- sql/145',
      'PERFORM require_role(''owner'', ''partner'');  -- sql/156'),
    jsonb_build_array('get_sales_by_product(timestamp with time zone, timestamp with time zone)',
      'PERFORM require_role(''owner'', ''partner'', ''seller'');  -- sql/145',
      'PERFORM require_role(''owner'', ''partner'');  -- sql/156'),
    jsonb_build_array('verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric)',
      'PERFORM require_role(''owner'', ''partner'', ''seller'');  -- sql/145',
      'PERFORM require_role(''owner'', ''partner'');  -- sql/156'),
    jsonb_build_array('get_inventory_movement_history_by_ingredient(uuid)',
      'PERFORM require_role(''owner'', ''partner'', ''seller'');  -- sql/145',
      'PERFORM require_role(''owner'', ''partner'');  -- sql/156'),
    jsonb_build_array('close_shift(uuid, text)',
      '''profit_summary'', to_jsonb(v_profit_summary)',
      '''profit_summary'', CASE WHEN public.get_my_role() IN (''owner'', ''partner'') THEN to_jsonb(v_profit_summary) END /* sql/156 */'),
    jsonb_build_array('confirm_sale(uuid)',
      '''total_cogs'', v_total_cogs',
      '''total_cogs'', CASE WHEN public.get_my_role() IN (''owner'', ''partner'') THEN v_total_cogs END /* sql/156 */'),
    jsonb_build_array('create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)',
      '''total_cogs'', compute_sale_total_cogs(v_existing_id)',
      '''total_cogs'', CASE WHEN public.get_my_role() IN (''owner'', ''partner'') THEN compute_sale_total_cogs(v_existing_id) END /* sql/156 */')
  );
  v_e jsonb;
  v_sig text;
  v_old text;
  v_new text;
  v_oid oid;
  v_old_src text;
  v_new_src text;
  v_def text;
BEGIN
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_edits)
  LOOP
    v_sig := v_e ->> 0;
    v_old := v_e ->> 1;
    v_new := v_e ->> 2;
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'sql/156: function public.% not found', v_sig;
    END IF;

    SELECT p.prosrc INTO v_old_src FROM pg_proc p
    JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_oid AND p.prosecdef AND l.lanname = 'plpgsql';
    IF v_old_src IS NULL THEN
      RAISE EXCEPTION 'sql/156: % is not a plpgsql SECURITY DEFINER function', v_sig;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF (length(v_old_src) - length(replace(v_old_src, v_old, ''))) / length(v_old) <> 1
       OR (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
      RAISE EXCEPTION 'sql/156: % — the text to replace does not occur exactly once: %', v_sig, v_old;
    END IF;

    EXECUTE replace(v_def, v_old, v_new);

    SELECT p.prosrc INTO v_new_src FROM pg_proc p WHERE p.oid = v_oid;
    IF replace(v_new_src, v_new, v_old) IS DISTINCT FROM v_old_src
       OR v_new_src = v_old_src
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'sql/156: rewrite of % changed more than the one expression', v_sig;
    END IF;
  END LOOP;
END;
$fn156$;

-- ---------------------------------------------------------------------
-- 3. Direct reads of cost tables: owner/partner only.
-- ---------------------------------------------------------------------
DROP POLICY ingredients_authenticated_select ON public.ingredients;
CREATE POLICY ingredients_owner_partner_select ON public.ingredients
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY production_batches_authenticated_select ON public.production_batches;
CREATE POLICY production_batches_owner_partner_select ON public.production_batches
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY finished_goods_batch_consumptions_authenticated_select ON public.finished_goods_batch_consumptions;
CREATE POLICY finished_goods_batch_consumptions_owner_partner_select ON public.finished_goods_batch_consumptions
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY stock_movements_authenticated_select ON public.stock_movements;
CREATE POLICY stock_movements_owner_partner_select ON public.stock_movements
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY write_offs_authenticated_select ON public.write_offs;
CREATE POLICY write_offs_owner_partner_select ON public.write_offs
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY inventory_adjustments_authenticated_select ON public.inventory_adjustments;
CREATE POLICY inventory_adjustments_owner_partner_select ON public.inventory_adjustments
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY shift_daily_profit_summaries_authenticated_select ON public.shift_daily_profit_summaries;
CREATE POLICY shift_daily_profit_summaries_owner_partner_select ON public.shift_daily_profit_summaries
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

DROP POLICY transactions_authenticated_select ON public.transactions;
CREATE POLICY transactions_owner_partner_select ON public.transactions
  FOR SELECT TO authenticated USING (public.get_my_role() IN ('owner', 'partner'));

-- ---------------------------------------------------------------------
-- 4. global_search on the cost-free views. Same rows for owner/partner:
-- compared below as an owner, inside this transaction.
-- ---------------------------------------------------------------------
CREATE TEMP TABLE gs156_before AS SELECT * FROM public.global_search;

CREATE OR REPLACE VIEW public.global_search
WITH (security_invoker = true) AS
SELECT 'ingredient'::text AS entity_type,
       i.id AS entity_id,
       NULL::text AS code,
       i.name AS title,
       i.unit AS subtitle,
       CASE WHEN (i.current_stock <= i.minimum_stock) IS TRUE THEN 'below_minimum'::text
            ELSE 'ok'::text END AS status,
       lower(concat_ws(' '::text, i.name, i.unit,
         CASE WHEN (i.current_stock <= i.minimum_stock) IS TRUE THEN 'below_minimum'::text
              ELSE 'ok'::text END)) AS search_text
FROM public.ingredient_stock_levels i
UNION ALL
SELECT 'finished_good'::text, f.product_id, NULL::text,
       COALESCE(f.product_name, f.product_id::text), NULL::text,
       f.production_status,
       lower(concat_ws(' '::text, f.product_name, f.production_status))
FROM public.finished_goods_stock_summary f
UNION ALL
SELECT 'recipe'::text, r.id, NULL::text, r.name, NULL::text,
       CASE WHEN r.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END,
       lower(concat_ws(' '::text, r.name,
         CASE WHEN r.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END))
FROM public.recipes r
UNION ALL
SELECT 'customer'::text, c.id, c.code, c.name,
       NULLIF(concat_ws(' · '::text, c.email, c.phone), ''::text),
       CASE WHEN c.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END,
       lower(concat_ws(' '::text, c.code, c.name, c.email, c.phone, c.vat_number,
         CASE WHEN c.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END))
FROM public.customers c
UNION ALL
SELECT 'supplier'::text, s.id, s.code, s.name,
       NULLIF(concat_ws(' · '::text, s.contact_name, s.email, s.phone), ''::text),
       CASE WHEN s.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END,
       lower(concat_ws(' '::text, s.code, s.name, s.contact_name, s.email, s.phone, s.vat_number,
         CASE WHEN s.is_active IS TRUE THEN 'active'::text ELSE 'inactive'::text END))
FROM public.suppliers s
UNION ALL
SELECT 'sale'::text, sale.sale_id, sale.sale_number, sale.sale_number,
       sale.sale_date::text, sale.status,
       lower(concat_ws(' '::text, sale.sale_number, sale.status, sale.sale_date::text))
FROM public.report_sales_summary sale
UNION ALL
SELECT 'purchase'::text, p.purchase_id, p.invoice_number,
       COALESCE(p.invoice_number, p.purchase_id::text), p.purchased_at::text, p.status,
       lower(concat_ws(' '::text, p.invoice_number, p.status, p.purchased_at::text, p.currency))
FROM public.report_purchase_summary p;

DO $gs156$
DECLARE
  v_owner uuid;
  v_diff bigint;
BEGIN
  SELECT p.auth_user_id INTO v_owner FROM public.profiles p
  WHERE p.is_active AND p.role = 'owner'
  ORDER BY p.auth_user_id LIMIT 1;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'sql/156: no active owner in profiles — cannot compare global_search';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  IF public.get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'sql/156: could not act as the owner for the global_search check';
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT * FROM gs156_before EXCEPT ALL SELECT * FROM public.global_search)
    UNION ALL
    (SELECT * FROM public.global_search EXCEPT ALL SELECT * FROM gs156_before)
  ) d;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'sql/156: global_search for the owner differs in % row(s)', v_diff;
  END IF;
END;
$gs156$;

DROP TABLE gs156_before;

-- ---------------------------------------------------------------------
-- 5. record_posting_failure: no longer callable from the app.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.record_posting_failure(text, text, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
