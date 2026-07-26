-- License & Application Information Foundation (DEV-056)
-- Run in Supabase SQL editor after:
--   sql/028_company_settings.sql
--
-- Read-only application information projection + get RPC:
--   application_info
--   get_application_info()
--
-- Uses existing metadata where available (PostgreSQL server version,
-- company_settings.timezone). Foundation constants supply product identity
-- fields that are not stored elsewhere. No writes, no background jobs.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Users & Roles
--   - start daemons, cron, or background workers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- application_info (read-only view - single row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW application_info AS
SELECT
  'Crepe''n Roll OS'::text AS application_name,
  '0.1.0'::text AS application_version,
  current_setting('server_version')::text AS database_version,
  '1'::text AS build_number,
  COALESCE(
    NULLIF(current_setting('app.environment', true), ''),
    'unknown'
  )::text AS environment,
  COALESCE(
    (
      SELECT cs.timezone
      FROM company_settings cs
      WHERE cs.singleton IS TRUE
      LIMIT 1
    ),
    current_setting('TimeZone')
  )::text AS timezone,
  now() AS generated_at;

COMMENT ON VIEW application_info IS
  'Read-only application information projection (name, version, database version, build, environment, timezone). No writes or stored snapshots.';

GRANT SELECT ON application_info TO authenticated;

-- ---------------------------------------------------------------------------
-- get_application_info
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_application_info()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'application_name', i.application_name,
    'application_version', i.application_version,
    'database_version', i.database_version,
    'build_number', i.build_number,
    'environment', i.environment,
    'timezone', i.timezone,
    'generated_at', i.generated_at
  )
  INTO v_result
  FROM application_info i
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_application_info() IS
  'Return read-only application information as JSON. Aggregates existing metadata and foundation constants only.';

GRANT EXECUTE ON FUNCTION get_application_info() TO authenticated;
