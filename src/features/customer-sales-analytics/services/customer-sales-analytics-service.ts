/**
 * Customer Sales Analytics read service (DEV-061).
 *
 * Reads exclusively via get_customer_sales_analytics and
 * get_customer_sales_analytics_by_customer RPCs.
 * Does NOT mutate data, recalculate metrics, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { CustomerSalesAnalytics } from "../types/customer-sales-analytics";

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

function mapCustomerSalesAnalyticsRow(data: unknown): CustomerSalesAnalytics {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Customer sales analytics row is invalid.");
  }

  const row = data as Record<string, unknown>;
  const customerId = row.customer_id;
  const customerName = row.customer_name;
  const saleCount = toNumber(row.sale_count);
  const totalRevenue = toNumber(row.total_revenue);
  const averageSaleValue = toNumber(row.average_sale_value);
  const lastSaleDate = nullableString(row.last_sale_date);

  if (typeof customerId !== "string" || !UUID_RE.test(customerId)) {
    throw new Error("Customer id is invalid.");
  }

  if (typeof customerName !== "string" || customerName.trim().length === 0) {
    throw new Error("Customer name is invalid.");
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

  if (lastSaleDate === undefined) {
    throw new Error("Last sale date is invalid.");
  }

  return {
    customer_id: customerId,
    customer_name: customerName,
    sale_count: saleCount,
    total_revenue: totalRevenue,
    average_sale_value: averageSaleValue,
    last_sale_date: lastSaleDate,
  };
}

function mapGetCustomerSalesAnalyticsResult(
  data: unknown,
): CustomerSalesAnalytics[] {
  if (!Array.isArray(data)) {
    throw new Error("Customer sales analytics response is invalid.");
  }

  return data.map(mapCustomerSalesAnalyticsRow);
}

function mapCustomerSalesAnalyticsRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("customer id is required")) {
    return "Customer id is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_customer_sales_analytics") ||
      normalized.includes("get_customer_sales_analytics_by_customer") ||
      normalized.includes("customer_sales_analytics")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883") ||
        normalized.includes("42p01")))
  ) {
    return "Customer sales analytics is not available yet. Apply the customer sales analytics database script and try again.";
  }

  return null;
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapCustomerSalesAnalyticsRpcError(message) : null;
    },
  });
}

export const customerSalesAnalyticsService = {
  /**
   * List customer sales analytics rows via get_customer_sales_analytics RPC.
   * Ordered by customer_name ASC in SQL.
   */
  async getCustomerSalesAnalytics(): Promise<
    ServiceResult<CustomerSalesAnalytics[]>
  > {
    try {
      const { data, error } = await supabase.rpc(
        "get_customer_sales_analytics",
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load customer sales analytics"),
        );
      }

      try {
        return ok(mapGetCustomerSalesAnalyticsResult(data));
      } catch {
        return fail("Customer sales analytics response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load customer sales analytics"),
      );
    }
  },

  /**
   * Load one customer sales analytics row via
   * get_customer_sales_analytics_by_customer RPC.
   */
  async getCustomerSalesAnalyticsByCustomer(
    customerId: string,
  ): Promise<ServiceResult<CustomerSalesAnalytics>> {
    try {
      const trimmedId = customerId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Customer id is required.");
      }

      const { data, error } = await supabase.rpc(
        "get_customer_sales_analytics_by_customer",
        {
          p_customer_id: trimmedId,
        },
      );

      if (error) {
        return fail(
          mapReadError(error, "Failed to load customer sales analytics"),
        );
      }

      if (data === null) {
        return fail("Customer sales analytics was not found.");
      }

      try {
        return ok(mapCustomerSalesAnalyticsRow(data));
      } catch {
        return fail("Customer sales analytics response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load customer sales analytics"),
      );
    }
  },
};
