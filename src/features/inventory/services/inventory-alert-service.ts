/**
 * Inventory Alerts read service (DEV-045).
 *
 * Reads exclusively from inventory_alerts.
 * Does NOT mutate stock, recalculate alerts, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  InventoryAlert,
  InventoryAlertSeverity,
  InventoryAlertType,
} from "../types/inventory-alert";
import {
  INVENTORY_ALERT_SEVERITIES,
  INVENTORY_ALERT_TYPES,
} from "../types/inventory-alert";

const INVENTORY_ALERTS_VIEW = "inventory_alerts";

const ALERTS_SELECT =
  "alert_type, ingredient_id, ingredient_name, current_quantity, minimum_quantity, severity, created_at";

interface InventoryAlertSqlRow {
  alert_type: string;
  ingredient_id: string;
  ingredient_name: string;
  current_quantity: number | string;
  minimum_quantity: number | string;
  severity: string;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isAlertType(value: string): value is InventoryAlertType {
  return (INVENTORY_ALERT_TYPES as readonly string[]).includes(value);
}

function isAlertSeverity(value: string): value is InventoryAlertSeverity {
  return (INVENTORY_ALERT_SEVERITIES as readonly string[]).includes(value);
}

function mapAlertRow(row: InventoryAlertSqlRow): InventoryAlert {
  if (!isAlertType(row.alert_type)) {
    throw new Error("Inventory alert type is invalid.");
  }

  if (!isAlertSeverity(row.severity)) {
    throw new Error("Inventory alert severity is invalid.");
  }

  return {
    alertType: row.alert_type,
    ingredientId: row.ingredient_id,
    ingredientName: row.ingredient_name,
    currentQuantity: toNumber(row.current_quantity),
    minimumQuantity: toNumber(row.minimum_quantity),
    severity: row.severity,
    createdAt: row.created_at,
  };
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        normalized.includes("inventory_alerts") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Inventory alerts are not available yet. Apply the inventory alerts database script and try again.";
      }

      return null;
    },
  });
}

export const inventoryAlertService = {
  /**
   * List inventory alert rows from inventory_alerts.
   */
  async getInventoryAlerts(): Promise<ServiceResult<InventoryAlert[]>> {
    try {
      const { data, error } = await supabase
        .from(INVENTORY_ALERTS_VIEW)
        .select(ALERTS_SELECT)
        .order("severity", { ascending: true })
        .order("ingredient_name", { ascending: true })
        .order("ingredient_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load inventory alerts"));
      }

      try {
        return ok(
          ((data as InventoryAlertSqlRow[] | null) ?? []).map(mapAlertRow),
        );
      } catch {
        return fail("Inventory alerts response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load inventory alerts"));
    }
  },
};
