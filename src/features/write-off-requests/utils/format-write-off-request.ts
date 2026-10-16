import {
  WRITE_OFF_REASON_LABELS,
} from "@/features/write-offs/types/write-off";
import type { WriteOffRequest } from "../types/write-off-request";

export function formatRequestQuantity(value: number, unit: string | null): string {
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/\.?0+$/, "");
  return unit ? `${text} ${unit}` : text;
}

export function requestItemName(request: WriteOffRequest): string {
  return request.item_name ?? "Unknown item";
}

export function requestReasonLabel(request: WriteOffRequest): string {
  return WRITE_OFF_REASON_LABELS[request.reason];
}

/** Approved quantity, only when it differs from what was requested. */
export function correctedQuantity(request: WriteOffRequest): number | null {
  if (
    request.status !== "approved" ||
    request.approved_quantity === null ||
    request.approved_quantity === request.quantity
  ) {
    return null;
  }
  return request.approved_quantity;
}
