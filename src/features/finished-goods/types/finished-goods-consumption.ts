/**
 * Finished Goods Batch Consumption contracts (DEV-107).
 *
 * Inventory movement only: FIFO layers + calculated remaining qty/value.
 * Does not define sale COGS, accounting postings, or tax.
 *
 * Write path remains allocate_finished_goods_fifo (SQL).
 * Remaining is never stored on production_batches.
 */

import type { FinishedGoodsAvailableBatch } from "./finished-good";

/** Request to consume finished goods for a sale line (inventory only). */
export interface ConsumeFinishedGoodsForSaleInput {
  product_id: string;
  quantity: number;
  sale_line_id: string;
  notes?: string | null;
}

/**
 * One FIFO consumption layer from a production batch.
 * unit_cost is the frozen batch cost — never recalculated.
 */
export interface FinishedGoodsConsumptionLayer {
  production_batch_id: string;
  quantity: number;
  /** Frozen Production Batch unit cost. */
  unit_cost: number;
  produced_at: string;
}

/** Calculated remaining after applying consumption layers. */
export interface FinishedGoodsBatchRemaining {
  production_batch_id: string;
  produced_quantity: number;
  remaining_quantity: number;
  /** Frozen — unchanged by consumption. */
  unit_cost: number;
  remaining_value: number;
}

/**
 * Pure FIFO plan: layers to append + projected remaining.
 * Not a ledger write — SQL owns persistence.
 */
export interface FinishedGoodsConsumptionPlan {
  layers: FinishedGoodsConsumptionLayer[];
  remaining_after: FinishedGoodsBatchRemaining[];
}

/** Persisted sale consumption result (inventory movement only). */
export interface ConsumeFinishedGoodsForSaleResult {
  product_id: string;
  sale_line_id: string;
  requested_quantity: number;
  allocated_quantity: number;
  layers: FinishedGoodsConsumptionLayer[];
  /** Post-consumption availability from Finished Goods read model. */
  remaining_batches: FinishedGoodsAvailableBatch[];
}
