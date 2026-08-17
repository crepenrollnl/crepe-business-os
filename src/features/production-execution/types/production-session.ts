/**
 * Production Session — execution document contracts (DEV-014 / DEV-015).
 *
 * A session records actual production against a Production Plan.
 * Completing a session atomically consumes raw materials, creates
 * immutable Production Batches, and posts stock movements.
 */

import type { ProductionBatchWithProduct } from "./production-batch";

export const PRODUCTION_SESSION_STATUSES = [
  "ready",
  "in_progress",
  "completed",
  "cancelled",
] as const;

export type ProductionSessionStatus =
  (typeof PRODUCTION_SESSION_STATUSES)[number];

export const OPEN_PRODUCTION_SESSION_STATUSES: readonly ProductionSessionStatus[] =
  ["ready", "in_progress"];

export interface ProductionSession {
  id: string;
  session_number: number;
  production_plan_id: string;
  status: ProductionSessionStatus;
  started_at: string;
  completed_at: string | null;
  /** Auth user id set when the session is completed (PRD-001). */
  completed_by: string | null;
  /** Optional for now — not required to finish a session. */
  operator_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ProductionSessionLine {
  id: string;
  production_session_id: string;
  production_plan_product_id: string | null;
  recipe_id: string;
  product_name: string;
  planned_quantity: number;
  /**
   * null = not yet entered.
   * 0 is allowed. Negative is not allowed.
   * May exceed planned quantity.
   */
  actual_produced_quantity: number | null;
  /**
   * Optional override for raw-material consumption scale (cooking
   * loss/shrinkage). When set, this number (not the produced/yield ratio)
   * scales the recipe's raw ingredient consumption. null = auto-calculate
   * from actual_produced_quantity / recipe.yield_quantity as before.
   */
  raw_material_scale: number | null;
  yield_unit: string;
  sort_order: number;
}

export interface ProductionSessionLineView extends ProductionSessionLine {
  /** actual − planned; null when actual is not entered. */
  difference: number | null;
}

export interface ProductionSessionPlanSummary {
  id: string;
  plan_number: number;
  name: string;
}

/** Session-level production accounting status (DEV-105 / DEV-106). */
export type ProductionAccountingPostingStatus = "posted" | "pending";

export interface ProductionSessionWithRelations extends ProductionSession {
  lines: ProductionSessionLineView[];
  plan: ProductionSessionPlanSummary;
  /** Present after successful completion (DEV-015). */
  batches?: ProductionBatchWithProduct[];
  /**
   * Accounting journal status for production_completed (DEV-106).
   * Read-only display of existing journal_entries — never computed in UI.
   */
  accounting_posting_status?: ProductionAccountingPostingStatus;
}

export interface ProductionSessionLineInput {
  line_id: string;
  /** null means empty / not entered. */
  actual_produced_quantity: number | null;
  /** null means not entered — falls back to automatic scale. */
  raw_material_scale: number | null;
}

export interface SaveProductionSessionInput {
  notes: string | null;
  lines: ProductionSessionLineInput[];
}

export interface CompleteProductionSessionInput {
  notes: string | null;
  lines: ProductionSessionLineInput[];
}
