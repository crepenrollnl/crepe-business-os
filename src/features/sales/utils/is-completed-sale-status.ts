import type { SaleStatus } from "../types/sale";

export type CompletedSaleStatus = Extract<SaleStatus, "confirmed" | "paid">;

/**
 * Completed sales are confirmed or paid. Draft and cancelled are not.
 * Single source of truth — do not re-implement this check in other modules.
 */
export function isCompletedSaleStatus(
  status: string,
): status is CompletedSaleStatus {
  return status === "confirmed" || status === "paid";
}
