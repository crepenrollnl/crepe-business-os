-- Finished Goods Batch Valuation (DEV-104)
-- Run in Supabase SQL editor after sql/012_finished_goods_availability.sql.
--
-- Extends finished_goods_batch_availability with freeze-compliant valuation fields:
--   total_batch_cost  = produced_quantity × unit_cost          (frozen lot value)
--   remaining_value   = available_quantity × unit_cost         (calculated)
--
-- Does NOT:
--   - store remaining_quantity
--   - update production_batches
--   - create a product-level FG stock ledger
--   - recalculate unit_cost after completion

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
  pb.unit_cost,
  round(pb.produced_quantity * pb.unit_cost, 2) AS total_batch_cost,
  round(
    (
      pb.produced_quantity
      - COALESCE(movements.out_quantity, 0)
      + COALESCE(movements.in_quantity, 0)
    ) * pb.unit_cost,
    2
  ) AS remaining_value
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
  'Read-only Finished Goods batch availability + valuation. available_quantity and remaining_value are calculated. unit_cost / total_batch_cost are frozen from the production batch. Never stores remaining_quantity.';

GRANT SELECT ON finished_goods_batch_availability TO authenticated;
