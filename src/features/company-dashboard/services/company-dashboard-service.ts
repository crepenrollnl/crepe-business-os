/**
 * Company Dashboard read service (DEV-066).
 *
 * Reads exclusively via get_company_dashboard RPC.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { CompanyDashboard } from "../types/company-dashboard";

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

function requireNonNegativeInteger(
  value: unknown,
  label: string,
): number {
  const parsed = toNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return parsed;
}

function mapCompanyDashboard(data: unknown): CompanyDashboard {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Company dashboard response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const totalFinishedGoods = toNumber(row.total_finished_goods);
  const lastSaleDate = nullableString(row.last_sale_date);
  const lastPurchaseDate = nullableString(row.last_purchase_date);
  const lastProductionDate = nullableString(row.last_production_date);

  if (totalFinishedGoods === undefined) {
    throw new Error("Total finished goods is invalid.");
  }

  if (lastSaleDate === undefined) {
    throw new Error("Last sale date is invalid.");
  }

  if (lastPurchaseDate === undefined) {
    throw new Error("Last purchase date is invalid.");
  }

  if (lastProductionDate === undefined) {
    throw new Error("Last production date is invalid.");
  }

  return {
    total_suppliers: requireNonNegativeInteger(
      row.total_suppliers,
      "Total suppliers",
    ),
    total_customers: requireNonNegativeInteger(
      row.total_customers,
      "Total customers",
    ),
    total_recipes: requireNonNegativeInteger(
      row.total_recipes,
      "Total recipes",
    ),
    total_ingredients: requireNonNegativeInteger(
      row.total_ingredients,
      "Total ingredients",
    ),
    total_finished_goods: totalFinishedGoods,
    total_sales: requireNonNegativeInteger(row.total_sales, "Total sales"),
    total_purchases: requireNonNegativeInteger(
      row.total_purchases,
      "Total purchases",
    ),
    total_production_batches: requireNonNegativeInteger(
      row.total_production_batches,
      "Total production batches",
    ),
    last_sale_date: lastSaleDate,
    last_purchase_date: lastPurchaseDate,
    last_production_date: lastProductionDate,
  };
}

function mapCompanyDashboardRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_company_dashboard") ||
      normalized.includes("company_dashboard")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Company dashboard is not available yet. Apply the company dashboard database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapCompanyDashboardRpcError(message) : null;
    },
  });
}

export const companyDashboardService = {
  /**
   * Load company dashboard summary via get_company_dashboard RPC.
   */
  async getCompanyDashboard(): Promise<ServiceResult<CompanyDashboard>> {
    try {
      const { data, error } = await supabase.rpc("get_company_dashboard");

      if (error) {
        return fail(mapReadError(error, "Failed to load company dashboard"));
      }

      try {
        return ok(mapCompanyDashboard(data));
      } catch {
        return fail("Company dashboard response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load company dashboard"));
    }
  },
};
