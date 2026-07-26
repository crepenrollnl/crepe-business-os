-- Audit Dashboard Foundation (DEV-070)
-- Run in Supabase SQL editor after:
--   sql/025_audit_log.sql
--
-- Read-only audit dashboard projection + get RPC:
--   audit_dashboard
--   get_audit_dashboard()
--
-- Summarizes audit activity from the existing audit_log read model.
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
--     Alerts Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- audit_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW audit_dashboard AS
SELECT
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
  ) AS total_audit_events,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.occurred_at >= date_trunc('day', now())
  ) AS events_today,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.occurred_at >= (now() - interval '7 days')
  ) AS events_last_7_days,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.action IN ('cancelled', 'deactivated')
  ) AS failed_operations,
  (
    SELECT COUNT(DISTINCT a.user_id)::integer
    FROM audit_log a
    WHERE a.user_id IS NOT NULL
  ) AS user_activity_count,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.entity_type IN ('production_session', 'production_batch')
  ) AS production_events,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE (
      a.entity_type = 'purchase'
      AND a.action = 'received'
    )
    OR (
      a.entity_type = 'production_batch'
      AND a.action = 'produced'
    )
  ) AS inventory_events,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.entity_type = 'sale'
  ) AS sales_events,
  (
    SELECT COUNT(*)::integer
    FROM audit_log a
    WHERE a.entity_type = 'purchase'
  ) AS purchase_events,
  (
    SELECT MAX(a.occurred_at)
    FROM audit_log a
  ) AS last_audit_event_at;

COMMENT ON VIEW audit_dashboard IS
  'Read-only audit dashboard summary. Aggregates counts and recency from audit_log (failed = cancelled/deactivated; inventory = purchase received + batch produced). No writes or stock mutation.';

GRANT SELECT ON audit_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_audit_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_audit_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_audit_events', d.total_audit_events,
    'events_today', d.events_today,
    'events_last_7_days', d.events_last_7_days,
    'failed_operations', d.failed_operations,
    'user_activity_count', d.user_activity_count,
    'production_events', d.production_events,
    'inventory_events', d.inventory_events,
    'sales_events', d.sales_events,
    'purchase_events', d.purchase_events,
    'last_audit_event_at', d.last_audit_event_at
  )
  INTO v_result
  FROM audit_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_audit_dashboard() IS
  'Return audit dashboard summary as JSON. Read-only aggregation over audit_log.';

GRANT EXECUTE ON FUNCTION get_audit_dashboard() TO authenticated;
