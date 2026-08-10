/**
 * Sales Trend Analytics read service (DEV-063).
 *
 * Reads exclusively via get_sales_trends and get_sales_trend_summary RPCs.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SalesTrendAnalytics,
  SalesTrendPeriodType,
  SalesTrendSummary,
} from "../types/sales-trend-analytics";

const PERIOD_TYPES = new Set<SalesTrendPeriodType>([
  "daily",
  "weekly",
  "monthly",
]);

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

function parsePeriodType(value: unknown): SalesTrendPeriodType | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "daily" ||
    normalized === "weekly" ||
    normalized === "monthly"
  ) {
    return normalized;
  }
  return undefined;
}

function mapSalesTrendAnalyticsRow(data: unknown): SalesTrendAnalytics {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Sales trend analytics row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const periodStart = row.period_start;
  const periodType = parsePeriodType(row.period_type);
  const saleCount = toNumber(row.sale_count);
  const totalRevenue = toNumber(row.total_revenue);
  const averageSaleValue = toNumber(row.average_sale_value);

  if (typeof periodStart !== "string") {
    throw new Error("Period start is invalid.");
  }

  if (periodType === undefined) {
    throw new Error("Period type is invalid.");
  }

  if (
    saleCount === undefined ||
    !Number.isInteger(saleCount) ||
    saleCount < 0
  ) {
    throw new Error("Sale count is invalid.");
  }

  if (totalRevenue === undefined) {
    throw new Error("Total revenue is invalid.");
  }

  if (averageSaleValue === undefined) {
    throw new Error("Average sale value is invalid.");
  }

  return {
    period_start: periodStart,
    period_type: periodType,
    sale_count: saleCount,
    total_revenue: totalRevenue,
    average_sale_value: averageSaleValue,
  };
}

function mapSalesTrendsResult(data: unknown): SalesTrendAnalytics[] {
  if (!Array.isArray(data)) {
    throw new Error("Sales trends response is invalid.");
  }

  return data.map(mapSalesTrendAnalyticsRow);
}

function mapSalesTrendSummary(data: unknown): SalesTrendSummary {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Sales trend summary response is invalid.");
  }

  const row = data as Record<string, unknown>;
  const saleCount = toNumber(row.sale_count);
  const totalRevenue = toNumber(row.total_revenue);
  const averageSaleValue = toNumber(row.average_sale_value);
  const firstSaleAt = nullableString(row.first_sale_at);
  const lastSaleAt = nullableString(row.last_sale_at);

  if (
    saleCount === undefined ||
    !Number.isInteger(saleCount) ||
    saleCount < 0
  ) {
    throw new Error("Sale count is invalid.");
  }

  if (totalRevenue === undefined) {
    throw new Error("Total revenue is invalid.");
  }

  if (averageSaleValue === undefined) {
    throw new Error("Average sale value is invalid.");
  }

  if (firstSaleAt === undefined) {
    throw new Error("First sale at is invalid.");
  }

  if (lastSaleAt === undefined) {
    throw new Error("Last sale at is invalid.");
  }

  return {
    sale_count: saleCount,
    total_revenue: totalRevenue,
    average_sale_value: averageSaleValue,
    first_sale_at: firstSaleAt,
    last_sale_at: lastSaleAt,
  };
}

function mapSalesTrendAnalyticsRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("period type must be daily, weekly, or monthly")) {
    return "Period type must be daily, weekly, or monthly.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_sales_trends") ||
      normalized.includes("get_sales_trend_summary") ||
      normalized.includes("sales_trend_analytics")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Sales trend analytics is not available yet. Apply the sales trend analytics database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapSalesTrendAnalyticsRpcError(message) : null;
    },
  });
}

export const salesTrendAnalyticsService = {
  /**
   * List sales trend rows for one period type via get_sales_trends RPC.
   * Ordered by period_start DESC in SQL.
   */
  async getSalesTrends(
    periodType: SalesTrendPeriodType | string,
  ): Promise<ServiceResult<SalesTrendAnalytics[]>> {
    try {
      const normalized = parsePeriodType(periodType);
      if (normalized === undefined || !PERIOD_TYPES.has(normalized)) {
        return fail("Period type must be daily, weekly, or monthly.");
      }

      const { data, error } = await supabase.rpc("get_sales_trends", {
        p_period_type: normalized,
      });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load sales trend analytics"),
        );
      }

      try {
        return ok(mapSalesTrendsResult(data));
      } catch {
        return fail("Sales trend analytics response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load sales trend analytics"),
      );
    }
  },

  /**
   * Load overall sales trend summary via get_sales_trend_summary RPC.
   */
  async getSalesTrendSummary(): Promise<ServiceResult<SalesTrendSummary>> {
    try {
      const { data, error } = await supabase.rpc("get_sales_trend_summary");

      if (error) {
        return fail(
          mapReadError(error, "Failed to load sales trend summary"),
        );
      }

      if (data === null) {
        return fail("Sales trend summary was not found.");
      }

      try {
        return ok(mapSalesTrendSummary(data));
      } catch {
        return fail("Sales trend summary response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load sales trend summary"));
    }
  },
};
