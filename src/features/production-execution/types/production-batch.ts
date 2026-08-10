/**
 * Production Batch — immutable finished-goods production event (DEV-015 / DEV-103).
 *
 * Created only by Production Execution on session completion.
 * Sales never updates these rows. remaining_quantity is never stored.
 * Costs are frozen at completion (unit_cost); total_cost is derived.
 *
 * Specs: docs/BATCH_CONSUMPTION.md, docs/ARCHITECTURE_FREEZE_V1.md
 */

import type { ProductionCostLine } from "../utils/production-cost-calculator";

export interface ProductionBatch {
  id: string;
  batch_number: number;
  production_session_id: string;
  production_session_line_id: string;
  /**
   * Sellable identity. Until Products master exists, equals recipe_id
   * (same convention as Production Planning).
   */
  finished_good_id: string;
  recipe_id: string;
  produced_quantity: number;
  /** Actual production unit cost frozen at creation. */
  unit_cost: number;
  produced_at: string;
  created_at: string;
}

export interface ProductionBatchWithProduct extends ProductionBatch {
  product_name: string;
  yield_unit: string;
  /**
   * Official batch total = produced_quantity × unit_cost (derived, not recalculated).
   */
  total_cost: number;
  /** Ingredient cost breakdown when reconstructable from completion facts. */
  cost_breakdown: readonly ProductionCostLine[];
  /**
   * Finished Goods remaining quantity (calculated). Null when availability
   * is unavailable.
   */
  remaining_quantity: number | null;
  /** Remaining value = remaining_quantity × frozen unit_cost. */
  remaining_value: number | null;
  /**
   * True when frozen unit_cost / total_cost are present for display (DEV-106).
   * False when valuation data is missing.
   */
  has_valuation: boolean;
}

export interface CompleteProductionSessionResult {
  session_id: string;
  transaction_id: string;
  batch_count: number;
  batch_ids: string[];
  total_cost: number;
  completed_at: string;
  completed_by: string | null;
}
