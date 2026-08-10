import { formatDate, formatDateTime } from "@/lib/date";
import type { ProductionPlanListItem } from "@/features/production/types/production";
import {
  EXECUTABLE_PLAN_STATUS,
  EXECUTABLE_PLAN_STATUS_LABEL,
} from "../types/production-execution";

export function formatExecutablePlanStatus(
  status: ProductionPlanListItem["status"],
): string {
  if (status === EXECUTABLE_PLAN_STATUS) {
    return EXECUTABLE_PLAN_STATUS_LABEL;
  }

  return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

export function getExecutablePlanStatusBadgeClass(
  status: ProductionPlanListItem["status"],
): string {
  if (status === EXECUTABLE_PLAN_STATUS) {
    return "bg-green-100 text-green-700";
  }

  return "bg-zinc-100 text-zinc-700";
}

export function formatExecutionDate(value: string | undefined | null): string {
  return formatDate(value);
}

export function formatExecutionDateTime(
  value: string | undefined | null,
): string {
  return formatDateTime(value);
}

/** Prefer shopping-list generation time; fall back to plan update/create. */
export function getLastCalculatedAt(
  plan: Pick<
    ProductionPlanListItem,
    "shopping_list_generated_at" | "updated_at" | "created_at"
  >,
): string {
  return (
    plan.shopping_list_generated_at ??
    plan.updated_at ??
    plan.created_at
  );
}

export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}
