/**
 * Sales by Product report service.
 *
 * Reads exclusively via get_sales_by_product (sql/109). Does not persist
 * or recalculate VAT / FIFO in TypeScript.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SalesByProductRow } from "../types/sales-product-report";

function toNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} is invalid.`);
}

function toOptionalNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toNumber(value, label);
}

function mapRow(payload: unknown): SalesByProductRow {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Sales by product row is invalid.");
  }

  const row = payload as Record<string, unknown>;
  const productId = row.product_id;
  if (typeof productId !== "string" || productId.trim().length === 0) {
    throw new Error("Product id is invalid.");
  }

  const productName = row.product_name;
  if (typeof productName !== "string" || productName.trim().length === 0) {
    throw new Error("Product name is invalid.");
  }

  const grossMarginPercent = toOptionalNumber(
    row.gross_margin_percent,
    "Gross margin percent",
  );

  const revenue = toNumber(row.revenue, "Revenue");
  if (revenue === 0 && grossMarginPercent !== null) {
    throw new Error("Gross margin percent is invalid.");
  }
  if (revenue > 0 && grossMarginPercent === null) {
    throw new Error("Gross margin percent is invalid.");
  }

  return {
    product_id: productId,
    product_name: productName,
    quantity: toNumber(row.quantity, "Quantity"),
    revenue,
    cogs: toNumber(row.cogs, "COGS"),
    gross_profit: toNumber(row.gross_profit, "Gross profit"),
    gross_margin_percent: grossMarginPercent,
  };
}

function mapReportError(error: unknown, fallback: string): string {
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
        normalized.includes("get_sales_by_product") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Sales by product is not available yet. Apply the sales by product database script and try again.";
      }

      return null;
    },
  });
}

export const salesProductReportService = {
  async listForPeriod(input: {
    from: string;
    to: string;
  }): Promise<ServiceResult<SalesByProductRow[]>> {
    try {
      const from = input.from.trim();
      const to = input.to.trim();
      if (!from || !to) {
        return fail("Period start and end are required.");
      }

      const { data, error } = await supabase.rpc("get_sales_by_product", {
        p_from: from,
        p_to: to,
      });

      if (error) {
        return fail(mapReportError(error, "Failed to load sales by product"));
      }

      try {
        return ok(((data as unknown[] | null) ?? []).map(mapRow));
      } catch {
        return fail("Sales by product response is invalid.");
      }
    } catch (error) {
      return fail(mapReportError(error, "Failed to load sales by product"));
    }
  },
};
