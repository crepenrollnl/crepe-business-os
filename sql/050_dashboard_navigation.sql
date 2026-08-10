-- Dashboard Navigation Foundation (DEV-073)
-- Run in Supabase SQL editor after:
--   sql/049_reporting_api.sql
--
-- Read-only dashboard navigation catalog + get RPC:
--   dashboard_navigation
--   get_dashboard_navigation()
--
-- Discovery metadata for reporting/dashboard modules.
-- Reuses reporting_api_sections for keys and display names.
-- No duplicated dashboard aggregations, no writes, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History /
--     Sales Trend Analytics / Inventory Dashboard / Production Dashboard /
--     Company Dashboard / Executive Dashboard / KPI Dashboard /
--     Alerts Dashboard / Audit Dashboard / User Activity Dashboard /
--     Reporting API
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- dashboard_navigation (read-only catalog for dashboard discovery)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW dashboard_navigation AS
WITH nav_meta AS (
  SELECT *
  FROM (
    VALUES
      (
        'executive'::text,
        'overview'::text,
        'Highest-level company health, growth, and operating signals.'::text,
        10::integer,
        'executive'::text
      ),
      (
        'kpi'::text,
        'overview'::text,
        'Core business KPIs across revenue, inventory, and operations.'::text,
        20::integer,
        'kpi'::text
      ),
      (
        'company'::text,
        'overview'::text,
        'Company-wide master-data and activity totals.'::text,
        30::integer,
        'company'::text
      ),
      (
        'inventory'::text,
        'operations'::text,
        'Ingredient stock levels, valuation, and purchase freshness.'::text,
        40::integer,
        'inventory'::text
      ),
      (
        'production'::text,
        'operations'::text,
        'Production batch volume, completion, and finished goods.'::text,
        50::integer,
        'production'::text
      ),
      (
        'alerts'::text,
        'operations'::text,
        'Operational alerts across stock, production, and system readiness.'::text,
        60::integer,
        'alerts'::text
      ),
      (
        'audit'::text,
        'governance'::text,
        'Audit activity volume, failures, and domain event mix.'::text,
        70::integer,
        'audit'::text
      ),
      (
        'user_activity'::text,
        'governance'::text,
        'Attributed user activity and usage concentration.'::text,
        80::integer,
        'user-activity'::text
      )
  ) AS t(
    dashboard_key,
    category,
    description,
    sort_order,
    icon_identifier
  )
)
SELECT
  s.section_name AS dashboard_key,
  s.title AS display_name,
  COALESCE(m.category, 'other'::text) AS category,
  COALESCE(m.description, s.title) AS description,
  COALESCE(m.sort_order, 999) AS sort_order,
  COALESCE(m.icon_identifier, s.section_name) AS icon_identifier,
  CASE
    WHEN to_regclass(('public.' || s.source_view)::text) IS NOT NULL
      THEN 'available'::text
    ELSE 'unavailable'::text
  END AS availability
FROM reporting_api_sections s
LEFT JOIN nav_meta m
  ON m.dashboard_key = s.section_name;

COMMENT ON VIEW dashboard_navigation IS
  'Read-only dashboard navigation catalog. Reuses reporting_api_sections keys/titles; availability reflects source dashboard view presence. No writes or aggregations.';

GRANT SELECT ON dashboard_navigation TO authenticated;

-- ---------------------------------------------------------------------------
-- get_dashboard_navigation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_dashboard_navigation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'dashboard_key', n.dashboard_key,
        'display_name', n.display_name,
        'category', n.category,
        'description', n.description,
        'sort_order', n.sort_order,
        'icon_identifier', n.icon_identifier,
        'availability', n.availability
      )
      ORDER BY n.sort_order ASC, n.dashboard_key ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM dashboard_navigation n;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_dashboard_navigation() IS
  'Return dashboard navigation catalog as JSON. Read-only discovery metadata over reporting dashboard sections.';

GRANT EXECUTE ON FUNCTION get_dashboard_navigation() TO authenticated;
