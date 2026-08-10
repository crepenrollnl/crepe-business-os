-- User Activity Dashboard Foundation (DEV-071)
-- Run in Supabase SQL editor after:
--   sql/025_audit_log.sql
--   sql/026_users_roles.sql
--
-- Read-only user activity dashboard projection + get RPC:
--   user_activity_dashboard
--   get_user_activity_dashboard()
--
-- Summarizes attributed audit_log events (user_id IS NOT NULL).
-- Reuses audit_log entity/action classifications from audit_dashboard.
-- No duplicated base event projections, no writes, no inventory mutation.
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
--     Alerts Dashboard / Audit Dashboard / Users & Roles
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- user_activity_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW user_activity_dashboard AS
WITH attributed AS (
  SELECT
    a.user_id,
    a.occurred_at,
    a.entity_type,
    a.action
  FROM audit_log a
  WHERE a.user_id IS NOT NULL
),
stats AS (
  SELECT
    COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.occurred_at >= date_trunc('day', now())
    )::integer AS active_users_today,
    COUNT(DISTINCT a.user_id) FILTER (
      WHERE a.occurred_at >= (now() - interval '7 days')
    )::integer AS active_users_last_7_days,
    COUNT(*)::integer AS total_user_actions,
    COUNT(*) FILTER (
      WHERE a.entity_type IN ('production_session', 'production_batch')
    )::integer AS production_actions,
    COUNT(*) FILTER (
      WHERE (
        a.entity_type = 'purchase'
        AND a.action = 'received'
      )
      OR (
        a.entity_type = 'production_batch'
        AND a.action = 'produced'
      )
    )::integer AS inventory_actions,
    COUNT(*) FILTER (
      WHERE a.entity_type = 'purchase'
    )::integer AS purchase_actions,
    COUNT(*) FILTER (
      WHERE a.entity_type = 'sale'
    )::integer AS sales_actions,
    MAX(a.occurred_at) AS last_user_activity_at,
    COUNT(DISTINCT a.user_id)::integer AS distinct_users
  FROM attributed a
),
top_user AS (
  SELECT
    COALESCE(u.full_name, u.email, a.user_id::text) AS most_active_user
  FROM attributed a
  LEFT JOIN users u
    ON u.id = a.user_id
  GROUP BY
    a.user_id,
    u.full_name,
    u.email
  ORDER BY COUNT(*) DESC, a.user_id ASC
  LIMIT 1
)
SELECT
  COALESCE(s.active_users_today, 0)::integer AS active_users_today,
  COALESCE(s.active_users_last_7_days, 0)::integer AS active_users_last_7_days,
  COALESCE(s.total_user_actions, 0)::integer AS total_user_actions,
  COALESCE(s.production_actions, 0)::integer AS production_actions,
  COALESCE(s.inventory_actions, 0)::integer AS inventory_actions,
  COALESCE(s.purchase_actions, 0)::integer AS purchase_actions,
  COALESCE(s.sales_actions, 0)::integer AS sales_actions,
  s.last_user_activity_at,
  t.most_active_user,
  CASE
    WHEN COALESCE(s.distinct_users, 0) > 0 THEN
      (
        s.total_user_actions::numeric / s.distinct_users
      )::numeric(14, 2)
    ELSE NULL
  END AS average_actions_per_user
FROM stats s
LEFT JOIN top_user t
  ON TRUE;

COMMENT ON VIEW user_activity_dashboard IS
  'Read-only user activity dashboard. Aggregates attributed audit_log events (user_id present). most_active_user from users.full_name/email. No writes or stock mutation.';

GRANT SELECT ON user_activity_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_user_activity_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_activity_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'active_users_today', d.active_users_today,
    'active_users_last_7_days', d.active_users_last_7_days,
    'total_user_actions', d.total_user_actions,
    'production_actions', d.production_actions,
    'inventory_actions', d.inventory_actions,
    'purchase_actions', d.purchase_actions,
    'sales_actions', d.sales_actions,
    'last_user_activity_at', d.last_user_activity_at,
    'most_active_user', d.most_active_user,
    'average_actions_per_user', d.average_actions_per_user
  )
  INTO v_result
  FROM user_activity_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_user_activity_dashboard() IS
  'Return user activity dashboard summary as JSON. Read-only aggregation over attributed audit_log events.';

GRANT EXECUTE ON FUNCTION get_user_activity_dashboard() TO authenticated;
