/**
 * Production Dashboard read service (DEV-065).
 *
 * Reads exclusively via get_production_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { ProductionDashboard } from "../types/production-dashboard";

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return toNumber(value);
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function mapProductionDashboard(data: unknown): ProductionDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Production dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const totalBatches = toNumber(row.total_batches);
  const completedBatches = toNumber(row.completed_batches);
  const failedBatches = toNumber(row.failed_batches);
  const totalFinishedGoods = toNumber(row.total_finished_goods);
  const lastProductionDate = nullableString(row.last_production_date);
  const averageBatchDuration = nullableNumber(row.average_batch_duration);

  if (
    totalBatches === undefined ||
    !Number.isInteger(totalBatches) ||
    totalBatches < 0
  ) {
    throw new Error("Total batches is invalid.");
  }

  if (
    completedBatches === undefined ||
    !Number.isInteger(completedBatches) ||
    completedBatches < 0
  ) {
    throw new Error("Completed batches is invalid.");
  }

  if (
    failedBatches === undefined ||
    !Number.isInteger(failedBatches) ||
    failedBatches < 0
  ) {
    throw new Error("Failed batches is invalid.");
  }

  if (totalFinishedGoods === undefined) {
    throw new Error("Total finished goods is invalid.");
  }

  if (lastProductionDate === undefined) {
    throw new Error("Last production date is invalid.");
  }

  if (averageBatchDuration === undefined) {
    throw new Error("Average batch duration is invalid.");
  }

  return {
    total_batches: totalBatches,
    completed_batches: completedBatches,
    failed_batches: failedBatches,
    total_finished_goods: totalFinishedGoods,
    last_production_date: lastProductionDate,
    average_batch_duration: averageBatchDuration,
  };
}

function mapProductionDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_production_dashboard") ||
      normalized.includes("production_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Production dashboard is not available yet. Apply the production dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapProductionDashboardRpcError(message) : null;
    },
  });
}

export const productionDashboardService = {
  /**
   * Load production dashboard summary via get_production_dashboard RPC.
   */
  async getProductionDashboard(): Promise<ServiceResult<ProductionDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_production_dashboard");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load production dashboard"),
        );
      }

      try {
        return ok(mapProductionDashboard(data));
      } catch {
        return fail("Production dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load production dashboard"));
    }
  },
};
