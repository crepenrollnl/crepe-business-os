import type { ProductionPlanStatus } from "../types/production";

/**
 * Empty filter means the planning list default: open plans only.
 * Choosing Completed or Cancelled in the dropdown still shows that status.
 */
export function isProductionPlanVisible(
  status: ProductionPlanStatus,
  statusFilter: ProductionPlanStatus | "",
): boolean {
  if (statusFilter.length > 0) {
    return status === statusFilter;
  }

  return status !== "completed" && status !== "cancelled";
}
