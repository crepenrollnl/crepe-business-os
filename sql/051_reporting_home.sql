-- Reporting Home Foundation (DEV-074)
-- Run in Supabase SQL editor after:
--   sql/049_reporting_api.sql
--   sql/050_dashboard_navigation.sql
--
-- Read-only reporting home projection + get RPC:
--   reporting_home
--   get_reporting_home()
--
-- Single entry point for the reporting workspace.
-- Composes existing metadata from dashboard_navigation,
-- reporting_api_sections, and reporting_api only.
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
--     Reporting API / Dashboard Navigation
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- reporting_home (read-only workspace entry point - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW reporting_home AS
SELECT
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
    WHERE n.availability = 'available'
  ) AS available_dashboards,
  (
    SELECT COALESCE(
      jsonb_agg(c.category ORDER BY c.category ASC),
      '[]'::jsonb
    )
    FROM (
      SELECT DISTINCT n.category
      FROM dashboard_navigation n
    ) c
  ) AS reporting_categories,
  (
    SELECT COUNT(*)::integer
    FROM dashboard_navigation n
  ) AS total_dashboard_count,
  (
    SELECT COUNT(*)::integer
    FROM reporting_api_sections s
  ) AS available_section_count,
  (
    SELECT r.generated_at
    FROM reporting_api r
    LIMIT 1
  ) AS last_generated_at,
  '1.0'::text AS application_reporting_version;

COMMENT ON VIEW reporting_home IS
  'Read-only reporting workspace home. Composes dashboard_navigation, reporting_api_sections, and reporting_api metadata. No duplicated aggregations or writes.';

GRANT SELECT ON reporting_home TO authenticated;

-- ---------------------------------------------------------------------------
-- get_reporting_home
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_reporting_home()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'available_dashboards', h.available_dashboards,
    'reporting_categories', h.reporting_categories,
    'total_dashboard_count', h.total_dashboard_count,
    'available_section_count', h.available_section_count,
    'last_generated_at', h.last_generated_at,
    'application_reporting_version', h.application_reporting_version
  )
  INTO v_result
  FROM reporting_home h
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_reporting_home() IS
  'Return reporting home workspace summary as JSON. Read-only composition of reporting navigation and API metadata.';

GRANT EXECUTE ON FUNCTION get_reporting_home() TO authenticated;
