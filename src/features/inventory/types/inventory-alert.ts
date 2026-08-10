/**
 * Inventory Alerts domain contracts (DEV-045).
 *
 * Read path: inventory_alerts SQL view.
 * Alert classification and severity come from SQL — never recalculated in TypeScript.
 */

export const INVENTORY_ALERT_TYPES = [
  "NEGATIVE_STOCK",
  "OUT_OF_STOCK",
  "LOW_STOCK",
] as const;

export type InventoryAlertType = (typeof INVENTORY_ALERT_TYPES)[number];

export const INVENTORY_ALERT_SEVERITIES = [
  "critical",
  "high",
  "medium",
] as const;

export type InventoryAlertSeverity =
  (typeof INVENTORY_ALERT_SEVERITIES)[number];

/**
 * Row from inventory_alerts, mapped to camelCase for the service API.
 */
export interface InventoryAlert {
  alertType: InventoryAlertType;
  ingredientId: string;
  ingredientName: string;
  currentQuantity: number;
  minimumQuantity: number;
  severity: InventoryAlertSeverity;
  createdAt: string;
}

export type { ServiceResult } from "@/types/service";
