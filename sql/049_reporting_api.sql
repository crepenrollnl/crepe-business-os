-- Reporting API Foundation (DEV-072)
-- Run in Supabase SQL editor after:
--   sql/041_inventory_dashboard.sql
--   sql/042_production_dashboard.sql
--   sql/043_company_dashboard.sql
--   sql/044_executive_dashboard.sql
--   sql/045_kpi_dashboard.sql
--   sql/046_alerts_dashboard.sql
--   sql/047_audit_dashboard.sql
--   sql/048_user_activity_dashboard.sql
--
-- Read-only reporting API projection + get RPCs:
--   reporting_api_sections
--   reporting_api
--   get_reporting_overview()
--   get_reporting_section(section_name)
--
-- Unified entry point over existing dashboard read models.
-- No duplicated base aggregations, no writes, no inventory mutation.
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
--     Alerts Dashboard / Audit Dashboard / User Activity Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- reporting_api_sections (read-only catalog of reporting sections)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW reporting_api_sections AS
SELECT *
FROM (
  VALUES
    (
      'executive'::text,
      'Executive Dashboard'::text,
      'executive_dashboard'::text,
      'get_executive_dashboard'::text
    ),
    (
      'kpi'::text,
      'KPI Dashboard'::text,
      'kpi_dashboard'::text,
      'get_kpi_dashboard'::text
    ),
    (
      'company'::text,
      'Company Dashboard'::text,
      'company_dashboard'::text,
      'get_company_dashboard'::text
    ),
    (
      'inventory'::text,
      'Inventory Dashboard'::text,
      'inventory_dashboard'::text,
      'get_inventory_dashboard'::text
    ),
    (
      'production'::text,
      'Production Dashboard'::text,
      'production_dashboard'::text,
      'get_production_dashboard'::text
    ),
    (
      'audit'::text,
      'Audit Dashboard'::text,
      'audit_dashboard'::text,
      'get_audit_dashboard'::text
    ),
    (
      'user_activity'::text,
      'User Activity Dashboard'::text,
      'user_activity_dashboard'::text,
      'get_user_activity_dashboard'::text
    ),
    (
      'alerts'::text,
      'Alerts Dashboard'::text,
      'alerts_dashboard'::text,
      'get_alerts_dashboard'::text
    )
) AS t(section_name, title, source_view, source_rpc);

COMMENT ON VIEW reporting_api_sections IS
  'Read-only catalog of reporting API sections and their source dashboard views/RPCs. No writes or calculations.';

GRANT SELECT ON reporting_api_sections TO authenticated;

-- ---------------------------------------------------------------------------
-- reporting_api (read-only overview - one row embedding dashboard payloads)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW reporting_api AS
SELECT
  now() AS generated_at,
  (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'section_name', s.section_name,
          'title', s.title,
          'source_view', s.source_view,
          'source_rpc', s.source_rpc
        )
        ORDER BY s.section_name ASC
      ),
      '[]'::jsonb
    )
    FROM reporting_api_sections s
  ) AS sections,
  (
    SELECT to_jsonb(d.*)
    FROM executive_dashboard d
    LIMIT 1
  ) AS executive,
  (
    SELECT to_jsonb(d.*)
    FROM kpi_dashboard d
    LIMIT 1
  ) AS kpi,
  (
    SELECT to_jsonb(d.*)
    FROM company_dashboard d
    LIMIT 1
  ) AS company,
  (
    SELECT to_jsonb(d.*)
    FROM inventory_dashboard d
    LIMIT 1
  ) AS inventory,
  (
    SELECT to_jsonb(d.*)
    FROM production_dashboard d
    LIMIT 1
  ) AS production,
  (
    SELECT to_jsonb(d.*)
    FROM audit_dashboard d
    LIMIT 1
  ) AS audit,
  (
    SELECT to_jsonb(d.*)
    FROM user_activity_dashboard d
    LIMIT 1
  ) AS user_activity,
  (
    SELECT to_jsonb(d.*)
    FROM alerts_dashboard d
    LIMIT 1
  ) AS alerts;

COMMENT ON VIEW reporting_api IS
  'Read-only reporting API overview. Embeds existing dashboard view rows as JSON payloads. No duplicated calculations or writes.';

GRANT SELECT ON reporting_api TO authenticated;

-- ---------------------------------------------------------------------------
-- get_reporting_overview
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_reporting_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(r.*)
  INTO v_result
  FROM reporting_api r
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_reporting_overview() IS
  'Return reporting API overview as JSON. Read-only composition of existing dashboard projections.';

GRANT EXECUTE ON FUNCTION get_reporting_overview() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_reporting_section
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_reporting_section(
  p_section_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_section_name text;
  v_title text;
  v_source_view text;
  v_source_rpc text;
  v_data jsonb;
BEGIN
  v_section_name := lower(btrim(COALESCE(p_section_name, '')));

  IF v_section_name = '' THEN
    RAISE EXCEPTION 'Section name is required.';
  END IF;

  SELECT
    s.section_name,
    s.title,
    s.source_view,
    s.source_rpc
  INTO
    v_section_name,
    v_title,
    v_source_view,
    v_source_rpc
  FROM reporting_api_sections s
  WHERE s.section_name = v_section_name;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.';
  END IF;

  v_data := CASE v_section_name
    WHEN 'executive' THEN (
      SELECT to_jsonb(d.*)
      FROM executive_dashboard d
      LIMIT 1
    )
    WHEN 'kpi' THEN (
      SELECT to_jsonb(d.*)
      FROM kpi_dashboard d
      LIMIT 1
    )
    WHEN 'company' THEN (
      SELECT to_jsonb(d.*)
      FROM company_dashboard d
      LIMIT 1
    )
    WHEN 'inventory' THEN (
      SELECT to_jsonb(d.*)
      FROM inventory_dashboard d
      LIMIT 1
    )
    WHEN 'production' THEN (
      SELECT to_jsonb(d.*)
      FROM production_dashboard d
      LIMIT 1
    )
    WHEN 'audit' THEN (
      SELECT to_jsonb(d.*)
      FROM audit_dashboard d
      LIMIT 1
    )
    WHEN 'user_activity' THEN (
      SELECT to_jsonb(d.*)
      FROM user_activity_dashboard d
      LIMIT 1
    )
    WHEN 'alerts' THEN (
      SELECT to_jsonb(d.*)
      FROM alerts_dashboard d
      LIMIT 1
    )
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'section_name', v_section_name,
    'title', v_title,
    'source_view', v_source_view,
    'source_rpc', v_source_rpc,
    'data', COALESCE(v_data, '{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION get_reporting_section(text) IS
  'Return one reporting API section as JSON (metadata + dashboard payload). Read-only; section_name required.';

GRANT EXECUTE ON FUNCTION get_reporting_section(text) TO authenticated;
