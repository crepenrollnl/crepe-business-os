/**
 * Supplier Performance read service (DEV-060).
 *
 * Reads exclusively via get_supplier_performance and
 * get_supplier_performance_by_supplier RPCs.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SupplierPerformance } from "../types/supplier-performance";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function mapSupplierPerformanceRow(data: unknown): SupplierPerformance {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Supplier performance row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const supplierId = row.supplier_id;
  const supplierName = row.supplier_name;
  const purchaseCount = toNumber(row.purchase_count);
  const totalSpent = toNumber(row.total_spent);
  const averageOrderValue = toNumber(row.average_order_value);
  const lastPurchaseDate = nullableString(row.last_purchase_date);

  if (typeof supplierId !== "string" || !UUID_RE.test(supplierId)) {
    throw new Error("Supplier id is invalid.");
  }

  if (typeof supplierName !== "string" || supplierName.trim().length === 0) {
    throw new Error("Supplier name is invalid.");
  }

  if (
    purchaseCount === undefined ||
    !Number.isInteger(purchaseCount) ||
    purchaseCount < 0
  ) {
    throw new Error("Purchase count is invalid.");
  }

  if (totalSpent === undefined) {
    throw new Error("Total spent is invalid.");
  }

  if (averageOrderValue === undefined) {
    throw new Error("Average order value is invalid.");
  }

  if (lastPurchaseDate === undefined) {
    throw new Error("Last purchase date is invalid.");
  }

  return {
    supplier_id: supplierId,
    supplier_name: supplierName,
    purchase_count: purchaseCount,
    total_spent: totalSpent,
    average_order_value: averageOrderValue,
    last_purchase_date: lastPurchaseDate,
  };
}

function mapGetSupplierPerformanceResult(
  data: unknown,
): SupplierPerformance[] {
  if (!Array.isArray(data)) {
    throw new Error("Supplier performance response is invalid.");
  }

  return data.map(mapSupplierPerformanceRow);
}

function mapSupplierPerformanceRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("supplier id is required")) {
    return "Supplier id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_supplier_performance") ||
      normalized.includes("get_supplier_performance_by_supplier") ||
      normalized.includes("supplier_performance")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Supplier performance is not available yet. Apply the supplier performance database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapSupplierPerformanceRpcError(message) : null;
    },
  });
}

export const supplierPerformanceService = {
  /**
   * List supplier performance rows via get_supplier_performance RPC.
   * Ordered by supplier_name ASC in SQL.
   */
  async getSupplierPerformance(): Promise<
    ServiceResult<SupplierPerformance[]>
  > {
    try {
      const { data, error } = await supabase.rpc("get_supplier_performance");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load supplier performance"),
        );
      }

      try {
        return ok(mapGetSupplierPerformanceResult(data));
      } catch {
        return fail("Supplier performance response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load supplier performance"),
      );
    }
  },

  /**
   * Load one supplier performance row via
   * get_supplier_performance_by_supplier RPC.
   */
  async getSupplierPerformanceBySupplier(
    supplierId: string,
  ): Promise<ServiceResult<SupplierPerformance>> {
    try {
      const trimmedId = supplierId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Supplier id is required.");
      }

      const { data, error } = await supabase.rpc(
        "get_supplier_performance_by_supplier",
        {
          p_supplier_id: trimmedId,
        },
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load supplier performance"),
        );
      }

      if (data === null) {
        return fail("Supplier performance was not found.");
      }

      try {
        return ok(mapSupplierPerformanceRow(data));
      } catch {
        return fail("Supplier performance response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load supplier performance"),
      );
    }
  },
};
