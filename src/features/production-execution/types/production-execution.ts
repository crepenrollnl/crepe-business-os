/**
 * Production Execution — module contracts.
 *
 * DEV-013: read-only workspace for plans ready to execute.
 * DEV-014: Production Session records actual produced quantities.
 * PRD-001 / DEV-015: Complete Production atomically consumes raw materials,
 * posts inventory transactions, creates immutable Production Batches, and
 * marks the session COMPLETED.
 *
 * Specs: docs/ARCHITECTURE_FREEZE_V1.md, docs/BATCH_CONSUMPTION.md
 */

import type {
  ProductionPlanIngredient,
  ProductionPlanListItem,
  ProductionPlanProduct,
  ProductionPlanShoppingItem,
  ProductionPlanWithRelations,
} from "@/features/production/types/production";
import type { ServiceResult } from "@/types/service";
import type {
  ProductionPlanSessionHistoryItem,
  ProductionSession,
  ProductionSessionStatus,
  ProductionSessionWithRelations,
} from "./production-session";

/** Live Planning status that makes a plan eligible for execution. */
export const EXECUTABLE_PLAN_STATUS = "ready_to_produce" as const;

/** User-facing label for executable plans in this workspace. */
export const EXECUTABLE_PLAN_STATUS_LABEL = "Ready for Production";

export type ExecutableProductionPlan = ProductionPlanListItem & {
  status: typeof EXECUTABLE_PLAN_STATUS;
};

export type ProductionExecutionPlanDetail = ProductionPlanWithRelations & {
  status: typeof EXECUTABLE_PLAN_STATUS;
  /** Open session for this plan, if one exists. */
  open_session: Pick<
    ProductionSession,
    "id" | "session_number" | "status" | "started_at"
  > | null;
  /** All sessions of this plan (oldest session_number first). */
  sessions: ProductionPlanSessionHistoryItem[];
};

export type ProductionExecutionSortField =
  | "name"
  | "planning_date"
  | "product_count"
  | "status"
  | "last_calculated_at";

export type ProductionExecutionSortDirection = "asc" | "desc";

export type {
  ProductionPlanIngredient,
  ProductionPlanProduct,
  ProductionPlanShoppingItem,
  ProductionPlanSessionHistoryItem,
  ProductionSession,
  ProductionSessionStatus,
  ProductionSessionWithRelations,
  ServiceResult,
};
