-- Inventory Alerts (DEV-045)
-- Run in Supabase SQL editor after sql/020_reporting_foundation.sql.
--
-- Read-only alert projection over report_inventory_summary:
--   inventory_alerts
--
-- Alert types (mutually exclusive per ingredient):
--   NEGATIVE_STOCK — current_quantity < 0
--   OUT_OF_STOCK   — current_quantity = 0
--   LOW_STOCK      — current_quantity > 0 AND current_quantity <= minimum_quantity
--
-- EXPIRING_SOON / EXPIRED are omitted: ingredients have no expiration columns yet.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales
--   - recalculate stock, FIFO, or ledger
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW inventory_alerts AS
SELECT
  'NEGATIVE_STOCK'::text AS alert_type,
  i.ingredient_id,
  i.ingredient_name,
  i.current_stock AS current_quantity,
  i.minimum_stock AS minimum_quantity,
  'critical'::text AS severity,
  now() AS created_at
FROM report_inventory_summary i
WHERE i.current_stock < 0

UNION ALL

SELECT
  'OUT_OF_STOCK'::text AS alert_type,
  i.ingredient_id,
  i.ingredient_name,
  i.current_stock AS current_quantity,
  i.minimum_stock AS minimum_quantity,
  'high'::text AS severity,
  now() AS created_at
FROM report_inventory_summary i
WHERE i.current_stock = 0

UNION ALL

SELECT
  'LOW_STOCK'::text AS alert_type,
  i.ingredient_id,
  i.ingredient_name,
  i.current_stock AS current_quantity,
  i.minimum_stock AS minimum_quantity,
  'medium'::text AS severity,
  now() AS created_at
FROM report_inventory_summary i
WHERE i.current_stock > 0
  AND i.current_stock <= i.minimum_stock;

COMMENT ON VIEW inventory_alerts IS
  'Read-only inventory alerts from report_inventory_summary. LOW_STOCK / OUT_OF_STOCK / NEGATIVE_STOCK only; no expiration alerts until dates exist. No stock mutations.';

GRANT SELECT ON inventory_alerts TO authenticated;
