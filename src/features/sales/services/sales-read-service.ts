/**
 * Sales read service (DEV-029).
 *
 * Reads only from sales_list_view and sale_details_view.
 * Does NOT confirm sales, allocate inventory, calculate totals/COGS/FIFO,
 * or query base tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SaleDetail,
  SaleDetailLine,
  SaleListItem,
  SaleStatus,
} from "../types/sale";
import { SALE_STATUSES } from "../types/sale";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SALES_LIST_VIEW = "sales_list_view";
const SALE_DETAILS_VIEW = "sale_details_view";

const LIST_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at";

const DETAILS_SELECT =
  "sale_id, sale_number, status, sale_date, customer_id, subtotal, tax_total, total, confirmed_at, paid_at, cancelled_at, line_id, product_id, quantity, unit_price, line_total";

interface SaleListRow {
  sale_id: string;
  sale_number: string;
  status: SaleStatus;
  sale_date: string;
  customer_id: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
}

interface SaleDetailsRow {
  sale_id: string;
  sale_number: string;
  status: SaleStatus;
  sale_date: string;
  customer_id: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  line_id: string | null;
  product_id: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  line_total: number | string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isSaleStatus(value: string): value is SaleStatus {
  return (SALE_STATUSES as readonly string[]).includes(value);
}

function mapListRow(row: SaleListRow): SaleListItem {
  if (!isSaleStatus(row.status)) {
    throw new Error("Sale status is invalid.");
  }

  return {
    sale_id: row.sale_id,
    sale_number: row.sale_number,
    status: row.status,
    sale_date: row.sale_date,
    customer_id: row.customer_id,
    subtotal: toNumber(row.subtotal),
    tax_total: toNumber(row.tax_total),
    total: toNumber(row.total),
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
  };
}

function mapDetailLine(row: SaleDetailsRow): SaleDetailLine | null {
  if (
    row.line_id === null ||
    row.product_id === null ||
    row.quantity === null ||
    row.unit_price === null ||
    row.line_total === null
  ) {
    return null;
  }

  return {
    line_id: row.line_id,
    product_id: row.product_id,
    quantity: toNumber(row.quantity),
    unit_price: toNumber(row.unit_price),
    line_total: toNumber(row.line_total),
  };
}

function mapDetail(rows: SaleDetailsRow[]): SaleDetail {
  const first = rows[0];
  if (!first) {
    throw new Error("Sale was not found.");
  }

  if (!isSaleStatus(first.status)) {
    throw new Error("Sale status is invalid.");
  }

  const lines: SaleDetailLine[] = [];
  for (const row of rows) {
    const line = mapDetailLine(row);
    if (line) {
      lines.push(line);
    }
  }

  return {
    sale_id: first.sale_id,
    sale_number: first.sale_number,
    status: first.status,
    sale_date: first.sale_date,
    customer_id: first.customer_id,
    subtotal: toNumber(first.subtotal),
    tax_total: toNumber(first.tax_total),
    total: toNumber(first.total),
    confirmed_at: first.confirmed_at,
    paid_at: first.paid_at,
    cancelled_at: first.cancelled_at,
    lines,
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
        (normalized.includes("sales_list_view") ||
          normalized.includes("sale_details_view")) &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Sales read model is not available yet. Apply the sales read-model database script and try again.";
      }

      return null;
    },
  });
}

export const salesReadService = {
  /**
   * List sales from sales_list_view.
   */
  async listSales(): Promise<ServiceResult<SaleListItem[]>> {
    try {
      const { data, error } = await supabase
        .from(SALES_LIST_VIEW)
        .select(LIST_SELECT)
        .order("sale_date", { ascending: false })
        .order("sale_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load sales"));
      }

      try {
        return ok(((data as SaleListRow[] | null) ?? []).map(mapListRow));
      } catch {
        return fail("Sales list response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load sales"));
    }
  },

  /**
   * Load one sale header + lines from sale_details_view.
   */
  async getSale(id: string): Promise<ServiceResult<SaleDetail>> {
    try {
      const trimmed = id?.trim() ?? "";
      if (!trimmed || !UUID_RE.test(trimmed)) {
        return fail("Sale id is required.");
      }

      const { data, error } = await supabase
        .from(SALE_DETAILS_VIEW)
        .select(DETAILS_SELECT)
        .eq("sale_id", trimmed)
        .order("line_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load sale"));
      }

      const rows = (data as SaleDetailsRow[] | null) ?? [];
      if (rows.length === 0) {
        return fail("Sale was not found.");
      }

      try {
        return ok(mapDetail(rows));
      } catch {
        return fail("Sale details response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load sale"));
    }
  },
};
