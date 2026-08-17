-- BTW Report catalog entry on dashboard_navigation.
-- Run in Supabase SQL editor after sql/095.
--
-- CREATE OR REPLACE of dashboard_navigation (sql/050) plus one extra
-- nav_meta row for btw_report. The existing 8 reporting_api_sections
-- rows keep the same LEFT JOIN. btw_report is not in
-- reporting_api_sections, so it is appended via UNION ALL with
-- availability always 'available' (own RPC get_btw_report, sql/095).
--
-- Preserves security_invoker = true from sql/074 so the replaced view
-- does not regress to owner-privilege execution.
--
-- Does NOT:
--   - change reporting_api_sections
--   - change get_dashboard_navigation (it already reads this view)
--   - write operational data

CREATE OR REPLACE VIEW dashboard_navigation
WITH (security_invoker = true)
AS
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
      ),
      (
        'btw_report'::text,
        'governance'::text,
        'Quarterly NL VAT (BTW) declaration report -- rubrieken 1a/1b/5a/5b/5c.'::text,
        90::integer,
        'btw-report'::text
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
  ON m.dashboard_key = s.section_name

UNION ALL

SELECT
  'btw_report'::text AS dashboard_key,
  'BTW Report'::text AS display_name,
  m.category,
  m.description,
  m.sort_order,
  m.icon_identifier,
  'available'::text AS availability
FROM nav_meta m
WHERE m.dashboard_key = 'btw_report';

COMMENT ON VIEW dashboard_navigation IS
  'Read-only dashboard navigation catalog. Reuses reporting_api_sections keys/titles; btw_report is appended via UNION ALL (own RPC). Availability for section-backed rows reflects source dashboard view presence. No writes or aggregations.';

GRANT SELECT ON dashboard_navigation TO authenticated;
