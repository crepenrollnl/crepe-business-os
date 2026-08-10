-- System Health Foundation (DEV-055)
-- Run in Supabase SQL editor after:
--   sql/026_users_roles.sql
--   sql/028_company_settings.sql
--   sql/029_backup_history.sql
--   sql/030_import_jobs.sql
--   sql/031_export_jobs.sql
--
-- Read-only system health projection + get RPC:
--   system_health
--   get_system_health()
--
-- Aggregates existing foundation metadata only - no monitoring daemon,
-- no background jobs, no writes, no stored health snapshots.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     Users & Roles
--   - start daemons, cron, or background workers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- system_health (read-only view)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW system_health AS
-- ---------------------------------------------------------------------------
-- Database connectivity (query success implies reachable)
-- ---------------------------------------------------------------------------
SELECT
  'database'::text AS component,
  'ok'::text AS status,
  now() AS last_checked_at,
  jsonb_build_object(
    'database_name', current_database()
  ) AS details

UNION ALL

-- ---------------------------------------------------------------------------
-- Company settings singleton
-- ---------------------------------------------------------------------------
SELECT
  'company_settings'::text AS component,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM company_settings cs
      WHERE cs.singleton IS TRUE
    ) THEN 'ok'
    ELSE 'unavailable'
  END AS status,
  now() AS last_checked_at,
  jsonb_build_object(
    'configured', EXISTS (
      SELECT 1
      FROM company_settings cs
      WHERE cs.singleton IS TRUE
    ),
    'company_name', (
      SELECT cs.company_name
      FROM company_settings cs
      WHERE cs.singleton IS TRUE
      LIMIT 1
    )
  ) AS details

UNION ALL

-- ---------------------------------------------------------------------------
-- Users foundation
-- ---------------------------------------------------------------------------
SELECT
  'users'::text AS component,
  CASE
    WHEN (SELECT COUNT(*) FROM users) > 0 THEN 'ok'
    ELSE 'unknown'
  END AS status,
  now() AS last_checked_at,
  jsonb_build_object(
    'user_count', (SELECT COUNT(*)::integer FROM users),
    'active_user_count', (
      SELECT COUNT(*)::integer
      FROM users u
      WHERE u.is_active IS TRUE
    ),
    'role_count', (SELECT COUNT(*)::integer FROM roles)
  ) AS details

UNION ALL

-- ---------------------------------------------------------------------------
-- Backup metadata (latest backup_history row)
-- ---------------------------------------------------------------------------
SELECT
  'backup'::text AS component,
  COALESCE(
    (
      SELECT
        CASE b.status
          WHEN 'completed' THEN 'ok'
          WHEN 'failed' THEN 'degraded'
          ELSE 'degraded'
        END
      FROM backup_history b
      ORDER BY b.created_at DESC, b.id ASC
      LIMIT 1
    ),
    'unknown'
  ) AS status,
  COALESCE(
    (
      SELECT b.created_at
      FROM backup_history b
      ORDER BY b.created_at DESC, b.id ASC
      LIMIT 1
    ),
    now()
  ) AS last_checked_at,
  jsonb_build_object(
    'latest_status', (
      SELECT b.status
      FROM backup_history b
      ORDER BY b.created_at DESC, b.id ASC
      LIMIT 1
    ),
    'latest_id', (
      SELECT b.id
      FROM backup_history b
      ORDER BY b.created_at DESC, b.id ASC
      LIMIT 1
    ),
    'total_count', (SELECT COUNT(*)::integer FROM backup_history)
  ) AS details

UNION ALL

-- ---------------------------------------------------------------------------
-- Import jobs metadata (latest import_jobs row)
-- ---------------------------------------------------------------------------
SELECT
  'import'::text AS component,
  COALESCE(
    (
      SELECT
        CASE j.status
          WHEN 'completed' THEN 'ok'
          WHEN 'failed' THEN 'degraded'
          WHEN 'running' THEN 'degraded'
          ELSE 'degraded'
        END
      FROM import_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'unknown'
  ) AS status,
  COALESCE(
    (
      SELECT COALESCE(j.started_at, j.completed_at)
      FROM import_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    now()
  ) AS last_checked_at,
  jsonb_build_object(
    'latest_status', (
      SELECT j.status
      FROM import_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'latest_id', (
      SELECT j.id
      FROM import_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'total_count', (SELECT COUNT(*)::integer FROM import_jobs),
    'running_count', (
      SELECT COUNT(*)::integer
      FROM import_jobs j
      WHERE j.status = 'running'
    )
  ) AS details

UNION ALL

-- ---------------------------------------------------------------------------
-- Export jobs metadata (latest export_jobs row)
-- ---------------------------------------------------------------------------
SELECT
  'export'::text AS component,
  COALESCE(
    (
      SELECT
        CASE j.status
          WHEN 'completed' THEN 'ok'
          WHEN 'failed' THEN 'degraded'
          WHEN 'running' THEN 'degraded'
          ELSE 'degraded'
        END
      FROM export_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'unknown'
  ) AS status,
  COALESCE(
    (
      SELECT COALESCE(j.started_at, j.completed_at)
      FROM export_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    now()
  ) AS last_checked_at,
  jsonb_build_object(
    'latest_status', (
      SELECT j.status
      FROM export_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'latest_id', (
      SELECT j.id
      FROM export_jobs j
      ORDER BY COALESCE(j.started_at, j.completed_at) DESC NULLS LAST, j.id ASC
      LIMIT 1
    ),
    'total_count', (SELECT COUNT(*)::integer FROM export_jobs),
    'running_count', (
      SELECT COUNT(*)::integer
      FROM export_jobs j
      WHERE j.status = 'running'
    )
  ) AS details;

COMMENT ON VIEW system_health IS
  'Read-only system health projection over foundation metadata (database, company_settings, users, backup, import, export). No daemon, writes, or stored snapshots.';

GRANT SELECT ON system_health TO authenticated;

-- ---------------------------------------------------------------------------
-- get_system_health
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_system_health()
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
        'component', h.component,
        'status', h.status,
        'last_checked_at', h.last_checked_at,
        'details', h.details
      )
      ORDER BY h.component ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM system_health h;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_system_health() IS
  'Return read-only system health rows as JSON. Aggregates existing metadata only.';

GRANT EXECUTE ON FUNCTION get_system_health() TO authenticated;
