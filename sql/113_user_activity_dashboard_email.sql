-- User Activity Dashboard: resolve most_active_user from auth.users.email.
--
-- Run in Supabase SQL editor after sql/048_user_activity_dashboard.sql
-- and sql/074_revoke_public_anon_access.sql.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Replaces user_activity_dashboard only. get_user_activity_dashboard()
-- is unchanged — it already reads most_active_user from this view.
--
-- sql/048 joined public.users on users.id = audit_log.user_id. Those
-- ids are not the same domain: audit_log.user_id is a Supabase Auth id
-- (auth.uid()), so the join never matched and the widget showed a UUID.
-- This overlay joins auth.users instead and displays email, falling back
-- to the Auth id text when email is NULL.
--
-- GRANT on auth.users: not added. The live read path is
-- get_user_activity_dashboard() (SECURITY DEFINER). During that call
-- current_user is the function owner (postgres), which already can read
-- auth.users in Supabase. GRANT SELECT ON auth.users TO authenticated
-- would expose every Auth email to any logged-in role and is not needed
-- for the RPC. Direct SELECT on this view as authenticated would fail
-- on auth.users because the view stays security_invoker (sql/074);
-- the app does not use that path.
--
-- CREATE OR REPLACE VIEW can drop reloptions; restore security_invoker
-- as set by sql/074 so the view does not regress to owner-privilege
-- execution.
--
-- Does NOT:
--   - edit sql/048_user_activity_dashboard.sql
--   - replace get_user_activity_dashboard()
--   - change reporting_api / get_reporting_overview
--   - grant SELECT on auth.users
--   - write operational data

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
    COALESCE(au.email::text, a.user_id::text) AS most_active_user
  FROM attributed a
  LEFT JOIN auth.users au
    ON au.id = a.user_id
  GROUP BY
    a.user_id,
    au.email
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
  'Read-only user activity dashboard. Aggregates attributed audit_log events (user_id present). most_active_user from auth.users.email, else Auth id text. No writes or stock mutation.';

GRANT SELECT ON user_activity_dashboard TO authenticated;
ALTER VIEW user_activity_dashboard SET (security_invoker = true);
