/**
 * Sales read service (DEV-029).
 *
 * List/detail reads go through sales_list_view and sale_details_view.
 * Documented base-table exceptions:
 *   - listQueuedSales reads sales + sale_lines so the kitchen poll does
 *     not pull the full details-view join.
 *   - getSoldQuantityByProductId reads sale_lines with an inner sales
 *     embed, then groups quantity in JS (no ranking RPC / view yet).
 * Does NOT confirm sales, allocate inventory, calculate totals/COGS/FIFO.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  QueuedSale,
  QueuedSaleLine,
  SaleDetail,
  SaleDetailLine,
  SaleListItem,
  SaleStatus,
} from "../types/sale";
import { SALE_STATUSES } from "../types/sale";
import { isCompletedSaleStatus } from "../utils/is-completed-sale-status";

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

interface QueueSaleRow {
  id: string;
  sale_number: string;
  confirmed_at: string | null;
  total: number | string;
  fulfilled_at: string | null;
  is_paid: boolean;
  kitchen_note: string | null;
}

interface QueueLineRow {
  sale_id: string;
  product_id: string;
  quantity: number | string;
}

interface SoldQuantityLineRow {
  product_id: string | null;
  quantity: number | string | null;
  sales: { status: string } | { status: string }[] | null;
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

function mapQueuedSales(
  headers: QueueSaleRow[],
  lineRows: QueueLineRow[],
): QueuedSale[] {
  const linesBySaleId = new Map<string, QueuedSaleLine[]>();

  for (const row of lineRows) {
    const quantity = toNumber(row.quantity);
    if (!row.sale_id || !row.product_id || Number.isNaN(quantity)) {
      throw new Error("Kitchen queue line is invalid.");
    }

    const lines = linesBySaleId.get(row.sale_id) ?? [];
    lines.push({
      product_id: row.product_id,
      quantity,
    });
    linesBySaleId.set(row.sale_id, lines);
  }

  return headers.map((row) => {
    const total = toNumber(row.total);
    if (!row.id || !row.sale_number || Number.isNaN(total)) {
      throw new Error("Kitchen queue sale is invalid.");
    }

    return {
      sale_id: row.id,
      sale_number: row.sale_number,
      confirmed_at: row.confirmed_at,
      total,
      is_paid: row.is_paid === true,
      kitchen_note: row.kitchen_note ?? null,
      lines: linesBySaleId.get(row.id) ?? [],
    };
  });
}

function embeddedSaleStatus(
  sales: SoldQuantityLineRow["sales"],
): string | null {
  if (!sales) {
    return null;
  }

  if (Array.isArray(sales)) {
    const status = sales[0]?.status;
    return typeof status === "string" ? status : null;
  }

  return typeof sales.status === "string" ? sales.status : null;
}

function mapSoldQuantityByProductId(
  rows: SoldQuantityLineRow[],
): Map<string, number> {
  const qtyByProductId = new Map<string, number>();

  for (const row of rows) {
    const status = embeddedSaleStatus(row.sales);
    if (status === null) {
      throw new Error("Sold quantity response was invalid.");
    }
    if (!isCompletedSaleStatus(status)) {
      continue;
    }

    if (!row.product_id || row.quantity === null) {
      throw new Error("Sold quantity response was invalid.");
    }

    const quantity = toNumber(row.quantity);
    if (Number.isNaN(quantity)) {
      throw new Error("Sold quantity response was invalid.");
    }

    qtyByProductId.set(
      row.product_id,
      (qtyByProductId.get(row.product_id) ?? 0) + quantity,
    );
  }

  return qtyByProductId;
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
   * List confirmed/paid sales whose confirmed_at falls in a shift window.
   * Sales have no shift_id — linkage is the time window only
   * (opened_at … closed_at, or opened_at … now when the shift is still open).
   */
  async listSalesConfirmedInWindow(
    openedAt: string,
    closedAt: string | null,
  ): Promise<ServiceResult<SaleListItem[]>> {
    try {
      const opened = openedAt?.trim() ?? "";
      if (!opened) {
        return fail("Shift opened at is required.");
      }

      const windowEnd = closedAt?.trim()
        ? closedAt.trim()
        : new Date().toISOString();

      const { data, error } = await supabase
        .from(SALES_LIST_VIEW)
        .select(LIST_SELECT)
        .in("status", ["confirmed", "paid"])
        .gte("confirmed_at", opened)
        .lte("confirmed_at", windowEnd)
        .order("confirmed_at", { ascending: false })
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

  /**
   * Kitchen queue: confirmed/paid sales whose fulfilled_at is still NULL.
   * Reads sales + sale_lines (not sale_details_view) so a poll only loads
   * tickets actually in the queue. Display names are joined in the POS hook.
   */
  async listQueuedSales(): Promise<ServiceResult<QueuedSale[]>> {
    try {
      const { data: saleData, error: saleError } = await supabase
        .from("sales")
        .select(
          "id, sale_number, confirmed_at, total, fulfilled_at, is_paid, kitchen_note",
        )
        .in("status", ["confirmed", "paid"])
        .is("fulfilled_at", null)
        .order("confirmed_at", { ascending: true })
        .order("id", { ascending: true });

      if (saleError) {
        return fail(mapReadError(saleError, "Failed to load the kitchen queue"));
      }

      const headers = (saleData as QueueSaleRow[] | null) ?? [];
      if (headers.length === 0) {
        return ok([]);
      }

      const saleIds = headers.map((row) => row.id);

      const { data: lineData, error: lineError } = await supabase
        .from("sale_lines")
        .select("sale_id, product_id, quantity")
        .in("sale_id", saleIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (lineError) {
        return fail(mapReadError(lineError, "Failed to load queue sale lines"));
      }

      try {
        return ok(mapQueuedSales(headers, (lineData as QueueLineRow[] | null) ?? []));
      } catch {
        return fail("Kitchen queue response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load the kitchen queue"));
    }
  },

  /**
   * Sum sale_lines.quantity per product_id for confirmed/paid sales.
   * One select + JS grouping — not a ranking RPC. PostgREST's default
   * 1000-row cap applies; add a GROUP BY RPC if the ledger grows past that.
   */
  async getSoldQuantityByProductId(): Promise<ServiceResult<Map<string, number>>> {
    try {
      const { data, error } = await supabase
        .from("sale_lines")
        .select("product_id, quantity, sales!inner(status)");

      if (error) {
        return fail(mapReadError(error, "Failed to load sold quantities"));
      }

      try {
        return ok(
          mapSoldQuantityByProductId(
            (data as SoldQuantityLineRow[] | null) ?? [],
          ),
        );
      } catch {
        return fail("Sold quantity response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load sold quantities"));
    }
  },
};
