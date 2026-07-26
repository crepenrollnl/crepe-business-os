-- Finished Goods Batch Availability Read Model (DEV-024)
-- Run in Supabase SQL editor after sql/010_finished_goods_batch_consumptions.sql
-- (and sql/011_allocate_finished_goods_fifo.sql if already applied).
--
-- Read-only view of per-batch finished-goods availability.
-- Remaining / available quantity is CALCULATED only:
--   available_quantity = produced_quantity − Σ(out) + Σ(in)
--
-- Does NOT:
--   - store remaining_quantity
--   - update production_batches
--   - modify ledger schema
--   - create triggers
--   - implement FIFO / Sales / write RPCs

CREATE OR REPLACE VIEW finished_goods_batch_availability AS
SELECT
  pb.id AS production_batch_id,
  pb.finished_good_id AS product_id,
  pb.batch_number,
  pb.produced_at,
  pb.produced_quantity,
  (
    pb.produced_quantity
    - COALESCE(movements.out_quantity, 0)
    + COALESCE(movements.in_quantity, 0)
  ) AS available_quantity,
  pb.unit_cost
FROM production_batches pb
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0)
      AS out_quantity,
    COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
      AS in_quantity
  FROM finished_goods_batch_consumptions c
  WHERE c.production_batch_id = pb.id
) movements ON true;

COMMENT ON VIEW finished_goods_batch_availability IS
  'Read-only Finished Goods batch availability. available_quantity = produced − Σ(out) + Σ(in). Never stored.';

GRANT SELECT ON finished_goods_batch_availability TO authenticated;
