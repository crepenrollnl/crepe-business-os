/**
 * Production Batch — immutable finished-goods production event (DEV-015).
 *
 * Created only by Production Execution on session completion.
 * Sales never updates these rows. remaining_quantity is never stored.
 *
 * Specs: docs/BATCH_CONSUMPTION.md, docs/ARCHITECTURE_FREEZE_V1.md
 */

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
