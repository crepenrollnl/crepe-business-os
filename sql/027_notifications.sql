-- Notifications Foundation (DEV-050)
-- Run in Supabase SQL editor after:
--   sql/023_inventory_alerts.sql
--   sql/001_create_purchases.sql
--   sql/006_create_production_sessions.sql
--   sql/013_create_sales.sql
--
-- Read-only notification projection for future Notifications UI / services:
--   notifications
--
-- Built from inventory_alerts + existing document timestamps - no triggers,
-- no writes, no stored notification rows.
--
-- Notification types:
--   LOW_STOCK / OUT_OF_STOCK / NEGATIVE_STOCK - current inventory state
--   PRODUCTION_COMPLETED / PURCHASE_RECEIVED / SALE_CONFIRMED - domain events
--
-- is_read is projected as false (foundation only; no per-user read-state table).
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales
--   - modify Dashboard / Reporting / Global Search / Audit Log / Inventory Alerts
--   - recalculate FIFO or ledger
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW notifications AS
-- ---------------------------------------------------------------------------
-- Inventory stock notifications (reuse inventory_alerts classification)
-- ---------------------------------------------------------------------------
SELECT
  (
    'notification.'
    || lower(a.alert_type)
    || '.'
    || a.ingredient_id::text
  ) AS id,
  a.alert_type AS notification_type,
  a.severity,
  CASE a.alert_type
    WHEN 'NEGATIVE_STOCK' THEN 'Negative stock'
    WHEN 'OUT_OF_STOCK' THEN 'Out of stock'
    WHEN 'LOW_STOCK' THEN 'Low stock'
  END AS title,
  CASE a.alert_type
    WHEN 'NEGATIVE_STOCK' THEN
      concat(
        a.ingredient_name,
        ' stock is negative (',
        a.current_quantity::text,
        ')'
      )
    WHEN 'OUT_OF_STOCK' THEN
      concat(a.ingredient_name, ' has no stock remaining')
    WHEN 'LOW_STOCK' THEN
      concat(
        a.ingredient_name,
        ' is below minimum (',
        a.current_quantity::text,
        ' / min ',
        a.minimum_quantity::text,
        ')'
      )
  END AS message,
  'ingredient'::text AS entity_type,
  a.ingredient_id AS entity_id,
  a.created_at,
  false AS is_read
FROM inventory_alerts a

UNION ALL

-- ---------------------------------------------------------------------------
-- Production completed
-- ---------------------------------------------------------------------------
SELECT
  ('notification.production_completed.' || ps.id::text) AS id,
  'PRODUCTION_COMPLETED'::text AS notification_type,
  'info'::text AS severity,
  'Production completed'::text AS title,
  concat(
    'Production session #',
    ps.session_number::text,
    ' completed'
  ) AS message,
  'production_session'::text AS entity_type,
  ps.id AS entity_id,
  ps.completed_at AS created_at,
  false AS is_read
FROM production_sessions ps
WHERE ps.completed_at IS NOT NULL
  AND ps.status = 'completed'

UNION ALL

-- ---------------------------------------------------------------------------
-- Purchase received
-- ---------------------------------------------------------------------------
SELECT
  ('notification.purchase_received.' || p.id::text) AS id,
  'PURCHASE_RECEIVED'::text AS notification_type,
  'info'::text AS severity,
  'Purchase received'::text AS title,
  concat_ws(
    ' ',
    'Purchase received',
    NULLIF(p.invoice_number, '')
  ) AS message,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  COALESCE(p.updated_at, p.purchased_at, p.created_at) AS created_at,
  false AS is_read
FROM purchases p
WHERE p.status = 'received'

UNION ALL

-- ---------------------------------------------------------------------------
-- Sale confirmed
-- ---------------------------------------------------------------------------
SELECT
  ('notification.sale_confirmed.' || s.id::text) AS id,
  'SALE_CONFIRMED'::text AS notification_type,
  'info'::text AS severity,
  'Sale confirmed'::text AS title,
  concat('Sale ', s.sale_number, ' confirmed') AS message,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  s.confirmed_at AS created_at,
  false AS is_read
FROM sales s
WHERE s.confirmed_at IS NOT NULL
  AND s.status IN ('confirmed', 'paid');

COMMENT ON VIEW notifications IS
  'Read-only notifications projection over inventory_alerts, production_sessions, purchases, and sales. Stable id strings; is_read always false until a read-state store exists. No triggers or mutations.';

GRANT SELECT ON notifications TO authenticated;
