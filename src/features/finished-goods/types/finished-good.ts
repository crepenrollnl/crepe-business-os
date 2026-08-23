/**
 * Finished Goods — module contracts (DEV-023 / DEV-024 / DEV-104 / DEV-107).
 *
 * Write path: allocate via allocate_finished_goods_fifo (SQL owns FIFO / remaining).
 * Sale consumption: finishedGoodsConsumptionService.consumeForSale (inventory only).
 * Read path: finished_goods_batch_availability view (SQL owns available_quantity).
 * Valuation: frozen unit_cost from Production Batch; remaining value calculated.
 *
 * Specs: docs/FINISHED_GOODS.md, docs/BATCH_CONSUMPTION.md, DEV-020 architecture
 */

export type {
  FinishedGoodsBatchValuation,
  FinishedGoodsValuationSource,
} from "../utils/finished-goods-valuation";

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
 * Stored Finished Goods consumption ledger row for a sale line (DEV-107 / DEV-108).
 * Costs are frozen at allocation — Sales COGS reads these values as-is.
 */
export interface FinishedGoodsSaleConsumptionRow {
  consumption_id: string;
  sale_line_id: string;
  production_batch_id: string;
  batch_number: number | null;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  produced_at: string | null;
  created_at: string;
}

/**
 * Row from finished_goods_batch_availability (DEV-024 / DEV-104).
 * available_quantity / remaining_value are calculated in SQL.
 * unit_cost / total_batch_cost are frozen from the production batch.
 */
export interface FinishedGoodsAvailableBatch {
  production_batch_id: string;
  product_id: string;
  batch_number: number;
  produced_at: string;
  produced_quantity: number;
  /** Calculated remaining — never stored on the batch. */
  available_quantity: number;
  unit_cost: number;
  /** Frozen lot value: produced_quantity × unit_cost. */
  total_batch_cost: number;
  /** Calculated: available_quantity × unit_cost. */
  remaining_value: number;
}

/**
 * Product-level remaining stock for the Finished Goods screen (2A).
 * Quantities and values come from report_finished_goods_summary.
 * yield_unit is joined from recipes — not recalculated in TypeScript.
 */
export interface FinishedGoodsListRow {
  product_id: string;
  product_name: string | null;
  available_quantity: number;
  yield_unit: string | null;
  average_unit_cost: number | null;
  remaining_value: number | null;
  newest_batch_at: string | null;
  production_status: "available" | "out_of_stock";
}
