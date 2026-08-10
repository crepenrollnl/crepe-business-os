import type { ProductionSessionStatus } from "../types/production-session";
import { OPEN_PRODUCTION_SESSION_STATUSES } from "../types/production-session";

const SESSION_STATUS_LABELS: Record<ProductionSessionStatus, string> = {
  ready: "Ready",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function formatProductionSessionStatus(
  status: ProductionSessionStatus,
): string {
  return SESSION_STATUS_LABELS[status];
}

export function getProductionSessionStatusBadgeClass(
  status: ProductionSessionStatus,
): string {
  switch (status) {
    case "ready":
      return "bg-sky-100 text-sky-700";
    case "in_progress":
      return "bg-amber-100 text-amber-800";
    case "completed":
      return "bg-green-100 text-green-700";
    case "cancelled":
      return "bg-zinc-100 text-zinc-600";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function isOpenProductionSessionStatus(
  status: ProductionSessionStatus,
): boolean {
  return (OPEN_PRODUCTION_SESSION_STATUSES as readonly string[]).includes(
    status,
  );
}

export function formatDifference(value: number | null): string {
  if (value === null) {
    return "—";
  }

  if (value > 0) {
    return `+${formatSessionQuantity(value)}`;
  }

  return formatSessionQuantity(value);
}

export function formatSessionQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function getDifferenceClass(value: number | null): string {
  if (value === null) {
    return "text-zinc-400";
  }

  if (value < 0) {
    return "text-red-600";
  }

  if (value > 0) {
    return "text-emerald-700";
  }

  return "text-zinc-700";
}
