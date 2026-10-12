-- sql/144 — audit S2 + S3, step 1: close client EXECUTE on 56 SECURITY DEFINER
-- functions that the app never calls directly.
--
-- What it does: REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated
-- for each function below. Nothing else: no function body changes, no table
-- or policy changes. The owner (postgres) and service_role keep EXECUTE, so
-- every SECURITY DEFINER function that calls these internally keeps working.
--
-- Not touched here (still callable by signed-in users, guarded later):
--   sale RPCs used by POS / Quick Sale / /sales (create_and_confirm_sale,
--   create_draft_sale, add_sale_line, update_sale_line, delete_sale_line,
--   confirm_sale, set_sale_paid_flag), record_posting_failure,
--   get_company_settings, verify_sale_cost_and_profit,
--   get_inventory_movement_history_by_ingredient, get_reporting_workspace,
--   get_sales_by_product, get_my_role, require_role.
--
-- Safety checks inside this migration (any failure aborts the whole file):
--   1. before: every one of the 56 names exists in public, and no function in
--      public that is NOT SECURITY DEFINER mentions any of them (such a caller
--      would run with the user's rights and break after the revoke);
--   2. after: no overload of any of the 56 names is executable by anon or
--      authenticated.
--
-- Rollback (if ever needed): GRANT EXECUTE ON FUNCTION <signature> TO authenticated;
-- Idempotent: safe to run twice.

DO $pre144$
DECLARE
  v_names text[] := ARRAY[
    'allocate_finished_goods_fifo', 'apply_sale_header_discount', 'recalculate_sale_commercial_totals', 'compute_sale_total_cogs',
    'allocate_posting_number', 'explode_component_recipe_leaves', 'is_nested_component_recipe', 'verify_journal_posting_amounts',
    'create_user', 'update_user', 'deactivate_user', 'create_role',
    'assign_role', 'create_backup_record', 'complete_backup_record', 'list_backups',
    'create_import_job', 'update_import_job_progress', 'complete_import_job', 'list_import_jobs',
    'create_export_job', 'update_export_job_progress', 'complete_export_job', 'list_export_jobs',
    'create_customer', 'update_customer', 'deactivate_customer', 'get_alerts_dashboard',
    'get_audit_dashboard', 'get_company_dashboard', 'get_dashboard_navigation', 'get_executive_dashboard',
    'get_inventory_dashboard', 'get_kpi_dashboard', 'get_production_dashboard', 'get_reporting_home',
    'get_reporting_overview', 'get_reporting_section', 'get_user_activity_dashboard', 'get_application_info',
    'get_system_health', 'get_customer_sales_analytics', 'get_customer_sales_analytics_by_customer', 'get_inventory_valuation',
    'get_inventory_item_value', 'get_inventory_movement_history', 'get_purchase_price_history', 'get_purchase_price_history_by_ingredient',
    'get_recipe_cost', 'get_recipe_cost_analysis', 'get_sales_trends', 'get_sales_trend_summary',
    'get_supplier_performance', 'get_supplier_performance_by_supplier', 'verify_daily_sales_summary', 'verify_daily_profit_summary'
  ];
  v_missing text[];
  v_callers text;
BEGIN
  SELECT array_agg(n ORDER BY n) INTO v_missing
  FROM unnest(v_names) AS n
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = n
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'sql/144 precheck: functions not found in public: %', v_missing;
  END IF;

  SELECT string_agg(DISTINCT p.oid::regprocedure::text || ' -> ' || n, '; ')
  INTO v_callers
  FROM unnest(v_names) AS n
  JOIN pg_proc p
    ON p.pronamespace = 'public'::regnamespace
   AND p.proname <> n
   AND NOT p.prosecdef
   AND p.prosrc ~ ('\m' || n || '\M');
  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION 'sql/144 precheck: non-SECURITY DEFINER functions call revoked functions: %', v_callers;
  END IF;
END;
$pre144$;

-- A. Internal helpers. Called only from inside other SECURITY DEFINER functions,
--    which run as the function owner, so revoking client EXECUTE does not affect
--    them. allocate_finished_goods_fifo is the S3 hole: its owner/partner check
--    is skipped when p_reason = 'sale', so a signed-in user could call it
--    directly and consume finished goods.
REVOKE ALL ON FUNCTION public.allocate_finished_goods_fifo(uuid, numeric, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_sale_header_discount(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_sale_commercial_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.compute_sale_total_cogs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_posting_number(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.explode_component_recipe_leaves(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_nested_component_recipe(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_journal_posting_amounts(text, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;

-- B. Old admin RPCs (users / roles / backups / imports / exports). No page in
--    the app uses them. Roles that matter live in profiles (get_my_role), which
--    these functions never touch.
REVOKE ALL ON FUNCTION public.create_user(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_user(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_user(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_role(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_role(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_backup_record(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_backup_record(uuid, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_backups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_import_job(text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_import_job_progress(uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_import_job(uuid, text, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_import_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_export_job(text, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_export_job_progress(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_export_job(uuid, text, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_export_jobs() FROM PUBLIC, anon, authenticated;

-- C. Customer RPCs. No page in the app uses them; customers stays readable.
REVOKE ALL ON FUNCTION public.create_customer(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_customer(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.deactivate_customer(uuid) FROM PUBLIC, anon, authenticated;

-- D. Old dashboards and reports that no page calls. They expose purchase prices,
--    stock value, margins and KPIs to any signed-in user.
REVOKE ALL ON FUNCTION public.get_alerts_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_audit_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_company_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_navigation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_executive_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_kpi_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_production_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reporting_home() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reporting_overview() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_reporting_section(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_activity_dashboard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_application_info() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_system_health() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_sales_analytics() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_sales_analytics_by_customer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_valuation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_item_value(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inventory_movement_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_purchase_price_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_purchase_price_history_by_ingredient(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_recipe_cost(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_recipe_cost_analysis() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sales_trends(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_sales_trend_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_supplier_performance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_supplier_performance_by_supplier(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_daily_sales_summary(uuid, integer, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_daily_profit_summary(uuid, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

DO $post144$
DECLARE
  v_names text[] := ARRAY[
    'allocate_finished_goods_fifo', 'apply_sale_header_discount', 'recalculate_sale_commercial_totals', 'compute_sale_total_cogs',
    'allocate_posting_number', 'explode_component_recipe_leaves', 'is_nested_component_recipe', 'verify_journal_posting_amounts',
    'create_user', 'update_user', 'deactivate_user', 'create_role',
    'assign_role', 'create_backup_record', 'complete_backup_record', 'list_backups',
    'create_import_job', 'update_import_job_progress', 'complete_import_job', 'list_import_jobs',
    'create_export_job', 'update_export_job_progress', 'complete_export_job', 'list_export_jobs',
    'create_customer', 'update_customer', 'deactivate_customer', 'get_alerts_dashboard',
    'get_audit_dashboard', 'get_company_dashboard', 'get_dashboard_navigation', 'get_executive_dashboard',
    'get_inventory_dashboard', 'get_kpi_dashboard', 'get_production_dashboard', 'get_reporting_home',
    'get_reporting_overview', 'get_reporting_section', 'get_user_activity_dashboard', 'get_application_info',
    'get_system_health', 'get_customer_sales_analytics', 'get_customer_sales_analytics_by_customer', 'get_inventory_valuation',
    'get_inventory_item_value', 'get_inventory_movement_history', 'get_purchase_price_history', 'get_purchase_price_history_by_ingredient',
    'get_recipe_cost', 'get_recipe_cost_analysis', 'get_sales_trends', 'get_sales_trend_summary',
    'get_supplier_performance', 'get_supplier_performance_by_supplier', 'verify_daily_sales_summary', 'verify_daily_profit_summary'
  ];
  v_open text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text)
  INTO v_open
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = ANY (v_names)
    AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'sql/144 self-check: still executable by anon/authenticated: %', v_open;
  END IF;
END;
$post144$;
