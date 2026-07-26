-- Production Dashboard Foundation (DEV-065)
-- Run in Supabase SQL editor after:
--   sql/006_create_production_sessions.sql
--   sql/007_complete_production.sql
--
-- Read-only production dashboard projection + get RPC:
--   production_dashboard
--   get_production_dashboard()
--
-- Reuses production_sessions and production_batches metadata.
-- No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History /
--     Sales Trend Analytics / Inventory Dashboard
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- production_dashboard (read-only view - single summary row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW production_dashboard AS
SELECT
  (
    SELECT COUNT(*)::integer
    FROM production_batches b
  ) AS total_batches,
  (
    SELECT COUNT(*)::integer
    FROM production_sessions ps
    WHERE ps.status = 'completed'
  ) AS completed_batches,
  (
    SELECT COUNT(*)::integer
    FROM production_sessions ps
    WHERE ps.status = 'cancelled'
  ) AS failed_batches,
  (
    SELECT COALESCE(SUM(b.produced_quantity), 0)::numeric(14, 3)
    FROM production_batches b
  ) AS total_finished_goods,
  COALESCE(
    (
      SELECT MAX(b.produced_at)
      FROM production_batches b
    ),
    (
      SELECT MAX(ps.completed_at)
      FROM production_sessions ps
      WHERE ps.completed_at IS NOT NULL
    )
  ) AS last_production_date,
  (
    SELECT AVG(
      EXTRACT(EPOCH FROM (ps.completed_at - ps.started_at))
    )::numeric(14, 2)
    FROM production_sessions ps
    WHERE ps.status = 'completed'
      AND ps.completed_at IS NOT NULL
  ) AS average_batch_duration;

COMMENT ON VIEW production_dashboard IS
  'Read-only production dashboard summary. Projects batch/session counts, finished-goods totals, and average completed-session duration (seconds). No writes or stock mutation.';

GRANT SELECT ON production_dashboard TO authenticated;

-- ---------------------------------------------------------------------------
-- get_production_dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_production_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_batches', d.total_batches,
    'completed_batches', d.completed_batches,
    'failed_batches', d.failed_batches,
    'total_finished_goods', d.total_finished_goods,
    'last_production_date', d.last_production_date,
    'average_batch_duration', d.average_batch_duration
  )
  INTO v_result
  FROM production_dashboard d
  LIMIT 1;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION get_production_dashboard() IS
  'Return production dashboard summary as JSON. Read-only projection over production_sessions and production_batches.';

GRANT EXECUTE ON FUNCTION get_production_dashboard() TO authenticated;
