-- Audit Log Foundation (DEV-048)
-- Run in Supabase SQL editor after core operational scripts
-- (purchases, production sessions/batches, sales, customers, suppliers,
--  finished_goods_batch_consumptions).
--
-- Read-only projection of domain events for future Activity Timeline / Audit UI:
--   audit_log
--
-- Built from existing immutable / document timestamps — no triggers, no writes.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers / Suppliers
--   - modify Dashboard / Reporting / Global Search
--   - recalculate FIFO or ledger
--   - create RPCs, triggers, hooks, services, UI, or tests

CREATE OR REPLACE VIEW audit_log AS
-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
SELECT
  ('purchase.created.' || p.id::text) AS event_id,
  p.created_at AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase created',
    NULLIF(p.invoice_number, ''),
    '(' || p.status || ')'
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id,
    'total', p.total,
    'currency', p.currency,
    'purchased_at', p.purchased_at
  ) AS metadata
FROM purchases p

UNION ALL

SELECT
  ('purchase.received.' || p.id::text) AS event_id,
  COALESCE(p.updated_at, p.purchased_at, p.created_at) AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'received'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase received',
    NULLIF(p.invoice_number, '')
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id,
    'total', p.total,
    'currency', p.currency,
    'purchased_at', p.purchased_at
  ) AS metadata
FROM purchases p
WHERE p.status = 'received'

UNION ALL

SELECT
  ('purchase.cancelled.' || p.id::text) AS event_id,
  COALESCE(p.updated_at, p.created_at) AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'cancelled'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase cancelled',
    NULLIF(p.invoice_number, '')
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id
  ) AS metadata
FROM purchases p
WHERE p.status = 'cancelled'

UNION ALL

-- ---------------------------------------------------------------------------
-- Production sessions + immutable batches
-- ---------------------------------------------------------------------------
SELECT
  ('production_session.started.' || ps.id::text) AS event_id,
  COALESCE(ps.started_at, ps.created_at) AS occurred_at,
  'production_session'::text AS entity_type,
  ps.id AS entity_id,
  'started'::text AS action,
  NULL::uuid AS user_id,
  concat(
    'Production session #',
    ps.session_number::text,
    ' started'
  ) AS summary,
  jsonb_build_object(
    'status', ps.status,
    'session_number', ps.session_number,
    'production_plan_id', ps.production_plan_id,
    'operator_name', ps.operator_name
  ) AS metadata
FROM production_sessions ps

UNION ALL

SELECT
  ('production_session.completed.' || ps.id::text) AS event_id,
  ps.completed_at AS occurred_at,
  'production_session'::text AS entity_type,
  ps.id AS entity_id,
  'completed'::text AS action,
  ps.completed_by AS user_id,
  concat(
    'Production session #',
    ps.session_number::text,
    ' completed'
  ) AS summary,
  jsonb_build_object(
    'status', ps.status,
    'session_number', ps.session_number,
    'production_plan_id', ps.production_plan_id,
    'operator_name', ps.operator_name,
    'completed_by', ps.completed_by
  ) AS metadata
FROM production_sessions ps
WHERE ps.completed_at IS NOT NULL

UNION ALL

SELECT
  ('production_batch.produced.' || pb.id::text) AS event_id,
  pb.produced_at AS occurred_at,
  'production_batch'::text AS entity_type,
  pb.id AS entity_id,
  'produced'::text AS action,
  NULL::uuid AS user_id,
  concat(
    'Production batch #',
    pb.batch_number::text,
    ' produced'
  ) AS summary,
  jsonb_build_object(
    'batch_number', pb.batch_number,
    'production_session_id', pb.production_session_id,
    'finished_good_id', pb.finished_good_id,
    'recipe_id', pb.recipe_id,
    'produced_quantity', pb.produced_quantity,
    'unit_cost', pb.unit_cost
  ) AS metadata
FROM production_batches pb

UNION ALL

-- ---------------------------------------------------------------------------
-- Sales document lifecycle
-- ---------------------------------------------------------------------------
SELECT
  ('sale.created.' || s.id::text) AS event_id,
  s.created_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' created') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'customer_id', s.customer_id,
    'sale_date', s.sale_date,
    'total', s.total
  ) AS metadata
FROM sales s

UNION ALL

SELECT
  ('sale.confirmed.' || s.id::text) AS event_id,
  s.confirmed_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'confirmed'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' confirmed') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'customer_id', s.customer_id,
    'total', s.total,
    'confirmed_at', s.confirmed_at
  ) AS metadata
FROM sales s
WHERE s.confirmed_at IS NOT NULL

UNION ALL

SELECT
  ('sale.paid.' || s.id::text) AS event_id,
  s.paid_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'paid'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' paid') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'paid_at', s.paid_at
  ) AS metadata
FROM sales s
WHERE s.paid_at IS NOT NULL

UNION ALL

SELECT
  ('sale.cancelled.' || s.id::text) AS event_id,
  s.cancelled_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'cancelled'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' cancelled') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'cancelled_at', s.cancelled_at
  ) AS metadata
FROM sales s
WHERE s.cancelled_at IS NOT NULL

UNION ALL

-- Immutable sale FIFO consumption layers (Finished Goods ledger)
SELECT
  ('sale_batch_consumption.recorded.' || c.id::text) AS event_id,
  c.created_at AS occurred_at,
  'sale'::text AS entity_type,
  c.source_id AS entity_id,
  'batch_consumed'::text AS action,
  c.created_by AS user_id,
  concat(
    'Sale batch consumption recorded (',
    c.direction,
    ', ',
    c.reason,
    ')'
  ) AS summary,
  jsonb_build_object(
    'consumption_id', c.id,
    'production_batch_id', c.production_batch_id,
    'quantity', c.quantity,
    'unit_cost', c.unit_cost,
    'total_cost', c.total_cost,
    'direction', c.direction,
    'reason', c.reason,
    'source_type', c.source_type,
    'source_id', c.source_id,
    'allocation_mode', c.allocation_mode
  ) AS metadata
FROM finished_goods_batch_consumptions c
WHERE c.source_type = 'sale_line'
  AND c.reason = 'sale'

UNION ALL

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
SELECT
  ('customer.created.' || c.id::text) AS event_id,
  c.created_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' created (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'email', c.email,
    'is_active', c.is_active
  ) AS metadata
FROM customers c

UNION ALL

SELECT
  ('customer.updated.' || c.id::text) AS event_id,
  c.updated_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'updated'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' updated (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'email', c.email,
    'is_active', c.is_active
  ) AS metadata
FROM customers c
WHERE c.updated_at IS DISTINCT FROM c.created_at
  AND c.is_active IS TRUE

UNION ALL

SELECT
  ('customer.deactivated.' || c.id::text) AS event_id,
  c.updated_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'deactivated'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' deactivated (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'is_active', c.is_active
  ) AS metadata
FROM customers c
WHERE c.is_active IS NOT TRUE

UNION ALL

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
SELECT
  ('supplier.created.' || s.id::text) AS event_id,
  s.created_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' created (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'email', s.email,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s

UNION ALL

SELECT
  ('supplier.updated.' || s.id::text) AS event_id,
  s.updated_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'updated'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' updated (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'email', s.email,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s
WHERE s.updated_at IS DISTINCT FROM s.created_at
  AND s.is_active IS TRUE

UNION ALL

SELECT
  ('supplier.deactivated.' || s.id::text) AS event_id,
  s.updated_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'deactivated'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' deactivated (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s
WHERE s.is_active IS NOT TRUE;

COMMENT ON VIEW audit_log IS
  'Read-only audit/event projection over purchases, production, sales, customers, and suppliers. Stable event_id strings; no triggers or mutations.';

GRANT SELECT ON audit_log TO authenticated;
