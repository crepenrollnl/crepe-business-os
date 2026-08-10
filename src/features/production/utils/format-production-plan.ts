import { formatDate } from "@/lib/date";
import type { ProductionPlanStatus } from "../types/production";

export function formatProductionPlanStatus(status: ProductionPlanStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "waiting_for_purchases":
      return "Waiting for Purchases";
    case "ready_to_produce":
      return "Ready to Produce";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function getProductionPlanStatusBadgeClass(
  status: ProductionPlanStatus,
): string {
  if (status === "draft") {
    return "bg-zinc-100 text-zinc-700";
  }

  if (status === "ready_to_produce") {
    return "bg-green-100 text-green-700";
  }

  if (status === "completed") {
    return "bg-blue-100 text-blue-700";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  if (status === "waiting_for_purchases") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-zinc-100 text-zinc-700";
}

export function formatProductionPlanDate(value: string | undefined): string {
  return formatDate(value);
}
