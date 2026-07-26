import type { CalendarDate, DateTime, EntityId } from "@/types/erp";

import type { ProductionPlanStatus } from "../types/status";

/**
 * Production Plan — planning document only.
 *
 * Never changes inventory, never creates Production Batches,
 * never posts accounting. Mutable while not archived.
 */
export interface ProductionPlan {
  id: EntityId;
  name: string;
  status: ProductionPlanStatus;
  plannedDate: CalendarDate;
  notes: string | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}
