/**
 * Finished Goods — module contracts (DEV-023 / DEV-024).
 *
 * Write path: allocate via allocate_finished_goods_fifo (SQL owns FIFO / remaining).
 * Read path: finished_goods_batch_availability view (SQL owns available_quantity).
 *
 * Specs: docs/FINISHED_GOODS.md, docs/BATCH_CONSUMPTION.md, DEV-020 architecture
 */

/** Outflow reasons accepted by allocate_finished_goods_fifo. */
export const FINISHED_GOODS_ALLOCATION_REASONS = [
  "sale",
  "internal_use",
  "waste",
  "spoilage",
  "stock_count",
  "manual_adjustment",
  "recipe_consumption",
] as const;

export type FinishedGoodsAllocationReason =
  (typeof FINISHED_GOODS_ALLOCATION_REASONS)[number];

export const FINISHED_GOODS_SOURCE_TYPES = [
  "sale_line",
  "pos_line",
  "order_line",
  "waste_ticket",
  "stock_count_line",
  "adjustment",
  "production_session_line",
] as const;

export type FinishedGoodsSourceType =
  (typeof FINISHED_GOODS_SOURCE_TYPES)[number];

export interface AllocateFinishedGoodsInput {
  product_id: string;
  quantity: number;
  reason: FinishedGoodsAllocationReason;
  source_type: FinishedGoodsSourceType;
  source_id: string;
  notes?: string | null;
}

export interface FinishedGoodsAllocationLayer {
  consumption_id: string;
  production_batch_id: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  produced_at: string;
}

export interface FinishedGoodsAllocation {
  product_id: string;
  requested_quantity: number;
  allocated_quantity: number;
  total_cost: number;
  reason: string;
  source_type: string;
  source_id: string;
  allocations: FinishedGoodsAllocationLayer[];
}

/** Immutable batch snapshot — remaining is never included. */
export interface FinishedGoodsBatchReadModel {
  id: string;
  batch_number: number;
  finished_good_id: string;
  produced_quantity: number;
  unit_cost: number;
  produced_at: string;
  created_at: string;
}

export interface AllocateFinishedGoodsResult {
  allocation: FinishedGoodsAllocation;
  /** Reloaded batches for the product after allocation (no remaining calc). */
  batches: FinishedGoodsBatchReadModel[];
}

/**
 * Row from finished_goods_batch_availability (DEV-024).
 * available_quantity is calculated in SQL — never recomputed in TypeScript.
 */
export interface FinishedGoodsAvailableBatch {
  production_batch_id: string;
  product_id: string;
  batch_number: number;
  produced_at: string;
  produced_quantity: number;
  available_quantity: number;
  unit_cost: number;
}
