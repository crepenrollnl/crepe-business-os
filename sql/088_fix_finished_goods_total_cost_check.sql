-- Fix: finished_goods_batch_consumptions_total_cost_chk itself, not just
-- the insert side (sql/087 alone did not fix this).
-- Run in Supabase SQL editor after sql/087_fix_finished_goods_consumption_rounding.sql.
--
-- sql/087 rounded v_line_total to 4 decimals before insert -- but that
-- changed nothing empirically: total_cost numeric(14,4) already rounds
-- ANY stored value to 4 decimals automatically at the column level, so an
-- explicit round(..., 4) on the way in is redundant with what the column
-- was already doing. The real mismatch was never on the insert side.
--
-- The original constraint (sql/010:81-82):
--   CONSTRAINT finished_goods_batch_consumptions_total_cost_chk
--     CHECK (total_cost = quantity * unit_cost)
-- re-multiplies the ALREADY-STORED quantity numeric(12,3) and unit_cost
-- numeric(12,4) fresh, at up to 7 decimal places, with no rounding of
-- that recomputation -- and compares it against total_cost, which is
-- always rounded to 4 decimals (by the column itself, regardless of what
-- sql/087 does or doesn't do on the way in). Rounding only one side of an
-- equality check can never make it agree with the other side.
--
-- Fix: round the constraint's own recomputation to the same 4 decimals as
-- total_cost's column precision, so both sides of the equality are
-- rounded the same way and agree deterministically. This is now the
-- actual fix; sql/087's explicit round() on insert is no longer strictly
-- required (the column would round it anyway) but is left in place --
-- harmless, and documents intent at the point total_cost is computed.

ALTER TABLE finished_goods_batch_consumptions
  DROP CONSTRAINT finished_goods_batch_consumptions_total_cost_chk;

ALTER TABLE finished_goods_batch_consumptions
  ADD CONSTRAINT finished_goods_batch_consumptions_total_cost_chk
  CHECK (total_cost = round(quantity * unit_cost, 4));
