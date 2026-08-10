-- Revoke PUBLIC/anon Access (V1 Phase 3 — critical security finding)
-- Run in Supabase SQL editor after sql/073_enable_missing_rls.sql.
--
-- Problem, confirmed empirically with the anon (publishable) key and no
-- authenticated session:
--
--   1. Every "CREATE OR REPLACE FUNCTION" in this project grants EXECUTE to
--      `authenticated` explicitly, but PostgreSQL grants EXECUTE on newly
--      created functions to PUBLIC by default, and almost nothing in sql/
--      ever revokes that default (the one correct exception is
--      decrement_ingredient_stock in sql/007_complete_production.sql).
--      Since `anon` is a member of PUBLIC, every RPC in the project
--      (calculate/create/confirm/etc.) was callable with ZERO
--      authentication. Verified live: an anonymous call to
--      create_draft_sale() succeeded and inserted a real row.
--
--   2. Views (dashboard_summary and everything built the same way) execute
--      with the privileges of the view OWNER by default in Postgres, not
--      the querying role, unless the view is created with
--      `security_invoker = true`. None of the 34 views in this project set
--      that option, so RLS on their underlying tables is bypassed
--      regardless of who queries the view.
--
-- Fix:
--   Part 1 — for every function in the public schema, REVOKE EXECUTE FROM
--   PUBLIC and FROM anon. This does NOT touch the existing
--   `GRANT EXECUTE ... TO authenticated` entries already in place (REVOKE
--   FROM PUBLIC/anon and GRANT TO authenticated are independent ACL
--   entries) — legitimate authenticated calls are unaffected. Uses a
--   dynamic loop over pg_proc so no function signature has to be
--   hand-typed (avoids transcription mistakes across 83 functions) and
--   nothing new is missed if you add functions later without this rule in
--   mind — re-running this file is always safe (idempotent: revoking an
--   already-revoked privilege is a no-op).
--
--   Part 2 — ALTER VIEW ... SET (security_invoker = true) for every view,
--   so views now enforce the RLS of the querying role instead of the
--   owner's. Requires PostgreSQL 15+ (Supabase's default since 2023); if
--   this errors on ALTER VIEW, check `SELECT version();` first.
--
-- Does NOT:
--   - change any function body, table schema, or RLS policy
--   - grant anything new to authenticated (it already has what it needs)
--   - touch tables directly (RLS on tables already correctly restricts
--     anon — confirmed empirically: an anonymous `select * from sales`
--     returned zero rows)

-- ---------------------------------------------------------------------------
-- Part 1: revoke EXECUTE from PUBLIC and anon on every public-schema
-- function (83 functions as of this migration; see chat for the full list).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    n := n + 1;
    RAISE NOTICE 'Revoked PUBLIC/anon EXECUTE on %', r.sig;
  END LOOP;
  RAISE NOTICE 'Total functions processed: %', n;
END $$;

-- ---------------------------------------------------------------------------
-- Part 2: force views to run with the querying role's privileges (and
-- therefore its RLS), not the view owner's.
-- ---------------------------------------------------------------------------

ALTER VIEW alerts_dashboard SET (security_invoker = true);
ALTER VIEW application_info SET (security_invoker = true);
ALTER VIEW audit_dashboard SET (security_invoker = true);
ALTER VIEW audit_log SET (security_invoker = true);
ALTER VIEW company_dashboard SET (security_invoker = true);
ALTER VIEW customer_sales_analytics SET (security_invoker = true);
ALTER VIEW dashboard_navigation SET (security_invoker = true);
ALTER VIEW dashboard_summary SET (security_invoker = true);
ALTER VIEW executive_dashboard SET (security_invoker = true);
ALTER VIEW finished_goods_batch_availability SET (security_invoker = true);
ALTER VIEW global_search SET (security_invoker = true);
ALTER VIEW inventory_alerts SET (security_invoker = true);
ALTER VIEW inventory_dashboard SET (security_invoker = true);
ALTER VIEW inventory_movement_history SET (security_invoker = true);
ALTER VIEW inventory_valuation SET (security_invoker = true);
ALTER VIEW kpi_dashboard SET (security_invoker = true);
ALTER VIEW notifications SET (security_invoker = true);
ALTER VIEW production_dashboard SET (security_invoker = true);
ALTER VIEW purchase_price_history SET (security_invoker = true);
ALTER VIEW recipe_cost_analysis SET (security_invoker = true);
ALTER VIEW report_finished_goods_summary SET (security_invoker = true);
ALTER VIEW report_inventory_summary SET (security_invoker = true);
ALTER VIEW report_purchase_summary SET (security_invoker = true);
ALTER VIEW report_sales_summary SET (security_invoker = true);
ALTER VIEW reporting_api SET (security_invoker = true);
ALTER VIEW reporting_api_sections SET (security_invoker = true);
ALTER VIEW reporting_home SET (security_invoker = true);
ALTER VIEW reporting_workspace SET (security_invoker = true);
ALTER VIEW sale_details_view SET (security_invoker = true);
ALTER VIEW sales_list_view SET (security_invoker = true);
ALTER VIEW sales_trend_analytics SET (security_invoker = true);
ALTER VIEW supplier_performance SET (security_invoker = true);
ALTER VIEW system_health SET (security_invoker = true);
ALTER VIEW user_activity_dashboard SET (security_invoker = true);
