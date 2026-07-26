-- Reporting Workspace Foundation (DEV-075)
-- Run in Supabase SQL editor after:
--   sql/049_reporting_api.sql
--   sql/050_dashboard_navigation.sql
--   sql/051_reporting_home.sql
--
-- Read-only reporting workspace projection + get RPC:
--   reporting_workspace
--   get_reporting_workspace()
--
-- Aggregates existing reporting entry points into one workspace model.
-- Reuses reporting_home, dashboard_navigation, and reporting_api only.
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
--     Reporting API / Dashboard Navigation / Reporting Home
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- reporting_workspace (read-only workspace aggregate - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW reporting_workspace AS
SELECT
  'Reporting Workspace'::text AS workspace_title,
  h.application_reporting_version AS reporting_version,
  h.available_dashboards,
  (
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
    FROM dashboard_navigation n
  ) AS navigation_catalog,
  (
    SELECT to_jsonb(r.*)
    FROM reporting_api r
    LIMIT 1
  ) AS reporting_overview,
  (
    SELECT r.generated_at
    FROM reporting_api r
    LIMIT 1
  ) AS generated_at
FROM reporting_home h
LIMIT 1;

COMMENT ON VIEW reporting_workspace IS
  'Read-only reporting workspace aggregate. Composes reporting_home, dashboard_navigation, and reporting_api. No duplicated aggregations or writes.';

GRANT SELECT ON reporting_workspace TO authenticated;

-- ---------------------------------------------------------------------------
-- get_reporting_workspace
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_reporting_workspace()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'workspace_title', w.workspace_title,
    'reporting_version', w.reporting_version,
    'available_dashboards', w.available_dashboards,
    'navigation_catalog', w.navigation_catalog,
    'reporting_overview', w.reporting_overview,
    'generated_at', w.generated_at
  )
  INTO v_result
  FROM reporting_workspace w
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_reporting_workspace() IS
  'Return reporting workspace aggregate as JSON. Read-only composition of reporting home, navigation, and API overview.';

GRANT EXECUTE ON FUNCTION get_reporting_workspace() TO authenticated;
