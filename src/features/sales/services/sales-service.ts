/**
 * Sales service (DEV-027 / DEV-034 / DEV-035).
 *
 * Orchestrates create_draft_sale, sale-line RPCs, and confirm_sale only.
 * Kitchen-queue flags: markSaleQueued / markSaleFulfilled are the only
 * client UPDATEs on sales — they touch fulfilled_at, never money or stock.
 * markSalePaid goes through set_sale_paid_flag and updates is_paid only.
 * Does NOT implement FIFO, COGS math, remaining quantity, ledger writes,
 * Finished Goods updates, or commercial total/tax calculation in TypeScript.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SaleAccountingContext,
  SaleJournalPostings,
} from "../types/sale-accounting";
import type {
  AddSaleLineInput,
  ConfirmSaleResult,
  CreateAndConfirmSaleInput,
  CreateDraftSaleInput,
  CreateDraftSaleResult,
  DeleteSaleLineInput,
  Sale,
  SaleDetail,
  SaleDetailLine,
  SaleLine,
  SaleStatus,
  SaleWithLines,
  UpdateSaleLineInput,
} from "../types/sale";
import { SALE_STATUSES } from "../types/sale";
import { saleAccountingService } from "./sale-accounting-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SALE_SELECT =
  "id, sale_number, customer_id, status, sale_date, confirmed_at, paid_at, cancelled_at, fulfilled_at, is_paid, subtotal, tax_total, total, notes, kitchen_note, created_at, updated_at";

const SALE_LINE_SELECT =
  "id, sale_id, product_id, quantity, unit_price, line_total, created_at";

interface SaleRow {
  id: string;
  sale_number: string;
  customer_id: string | null;
  status: SaleStatus;
  sale_date: string;
  confirmed_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  fulfilled_at: string | null;
  is_paid: boolean;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  notes: string | null;
  kitchen_note: string | null;
  created_at: string;
  updated_at?: string;
}

interface SaleLineRow {
  id: string;
  sale_id: string;
  product_id: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isSaleStatus(value: string): value is SaleStatus {
  return (SALE_STATUSES as readonly string[]).includes(value);
}

function validateConfirmSaleInput(saleId: string): string | null {
  if (!saleId || !UUID_RE.test(saleId.trim())) {
    return "Sale id is required.";
  }

  return null;
}

function validateCreateDraftSaleInput(
  input: CreateDraftSaleInput,
): string | null {
  const customerId = input.customer_id?.trim() ?? "";

  if (customerId.length > 0 && !UUID_RE.test(customerId)) {
    return "Customer id is invalid.";
  }

  return null;
}

function mapCreateDraftSaleRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("sales_sale_number_key") ||
    (normalized.includes("duplicate") && normalized.includes("sale_number"))
  ) {
    return "Could not generate a unique sale number. Try again.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("create_draft_sale") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Creating draft sales is not available yet. Apply the create-draft-sale database script and try again.";
  }

  return null;
}

function mapCreateDraftSaleError(error: unknown, fallback: string): string {
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
      return message ? mapCreateDraftSaleRpcError(message) : null;
    },
  });
}

function mapCreateDraftSaleRpcResult(
  data: unknown,
): CreateDraftSaleResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const saleId = row.sale_id;

  if (typeof saleId !== "string" || !UUID_RE.test(saleId)) {
    return null;
  }

  return { saleId };
}

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

function validateAddSaleLineInput(input: AddSaleLineInput): string | null {
  if (!input.sale_id || !UUID_RE.test(input.sale_id.trim())) {
    return "Sale id is required.";
  }

  if (!input.product_id || !UUID_RE.test(input.product_id.trim())) {
    return "Product id is required.";
  }

  if (
    input.quantity === null ||
    input.quantity === undefined ||
    Number.isNaN(Number(input.quantity)) ||
    Number(input.quantity) <= 0
  ) {
    return "Enter a quantity greater than zero.";
  }

  if (
    input.unit_price === null ||
    input.unit_price === undefined ||
    Number.isNaN(Number(input.unit_price)) ||
    Number(input.unit_price) < 0
  ) {
    return "Enter a unit price of zero or greater.";
  }

  return null;
}

function validateUpdateSaleLineInput(
  input: UpdateSaleLineInput,
): string | null {
  if (!input.sale_line_id || !UUID_RE.test(input.sale_line_id.trim())) {
    return "Sale line id is required.";
  }

  if (
    input.quantity === null ||
    input.quantity === undefined ||
    Number.isNaN(Number(input.quantity)) ||
    Number(input.quantity) <= 0
  ) {
    return "Enter a quantity greater than zero.";
  }

  return null;
}

function validateDeleteSaleLineInput(
  input: DeleteSaleLineInput,
): string | null {
  if (!input.sale_line_id || !UUID_RE.test(input.sale_line_id.trim())) {
    return "Sale line id is required.";
  }

  return null;
}

function mapSaleLineRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("sale id is required")) {
    return "Sale id is required.";
  }

  if (normalized.includes("sale line id is required")) {
    return "Sale line id is required.";
  }

  if (normalized.includes("product id is required")) {
    return "Product id is required.";
  }

  if (normalized.includes("quantity must be greater than zero")) {
    return "Enter a quantity greater than zero.";
  }

  if (normalized.includes("unit price must be zero or greater")) {
    return "Enter a unit price of zero or greater.";
  }

  if (normalized.includes("sale line was not found")) {
    return "Sale line was not found.";
  }

  if (normalized.includes("sale was not found")) {
    return "Sale was not found.";
  }

  if (normalized.includes("only draft sales can be modified")) {
    return "Only draft sales can be modified.";
  }

  if (normalized.includes("product was not found")) {
    return "Product was not found.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("add_sale_line") ||
      normalized.includes("update_sale_line") ||
      normalized.includes("delete_sale_line")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Sale line management is not available yet. Apply the sale-line-management database script and try again.";
  }

  return null;
}

function mapSaleLineError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapSaleLineRpcError(message) : null;
    },
  });
}

function mapSaleDocumentLine(row: unknown): SaleDetailLine | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }

  const line = row as Record<string, unknown>;
  const lineId = line.line_id;
  const productId = line.product_id;
  const quantity = line.quantity;
  const unitPrice = line.unit_price;
  const lineTotal = line.line_total;

  if (
    typeof lineId !== "string" ||
    typeof productId !== "string" ||
    (typeof quantity !== "number" && typeof quantity !== "string") ||
    (typeof unitPrice !== "number" && typeof unitPrice !== "string") ||
    (typeof lineTotal !== "number" && typeof lineTotal !== "string")
  ) {
    return null;
  }

  const parsedQuantity = toNumber(quantity);
  const parsedUnitPrice = toNumber(unitPrice);
  const parsedLineTotal = toNumber(lineTotal);

  if (
    Number.isNaN(parsedQuantity) ||
    Number.isNaN(parsedUnitPrice) ||
    Number.isNaN(parsedLineTotal)
  ) {
    return null;
  }

  return {
    line_id: lineId,
    product_id: productId,
    quantity: parsedQuantity,
    unit_price: parsedUnitPrice,
    line_total: parsedLineTotal,
  };
}

/**
 * Map add/update/delete_sale_line RPC payload.
 * Totals and line amounts come from SQL — never recalculated here.
 */
function mapSaleDocumentRpcResult(data: unknown): SaleDetail | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const saleId = row.sale_id;
  const saleNumber = row.sale_number;
  const status = row.status;
  const saleDate = row.sale_date;
  const customerId = row.customer_id;
  const subtotal = row.subtotal;
  const taxTotal = row.tax_total;
  const total = row.total;
  const confirmedAt = row.confirmed_at;
  const paidAt = row.paid_at;
  const cancelledAt = row.cancelled_at;
  const linesRaw = row.lines;

  if (
    typeof saleId !== "string" ||
    typeof saleNumber !== "string" ||
    typeof status !== "string" ||
    !isSaleStatus(status) ||
    typeof saleDate !== "string" ||
    (customerId !== null && typeof customerId !== "string") ||
    (typeof subtotal !== "number" && typeof subtotal !== "string") ||
    (typeof taxTotal !== "number" && typeof taxTotal !== "string") ||
    (typeof total !== "number" && typeof total !== "string") ||
    (confirmedAt !== null && typeof confirmedAt !== "string") ||
    (paidAt !== null && typeof paidAt !== "string") ||
    (cancelledAt !== null && typeof cancelledAt !== "string") ||
    !Array.isArray(linesRaw)
  ) {
    return null;
  }

  const parsedSubtotal = toNumber(subtotal);
  const parsedTaxTotal = toNumber(taxTotal);
  const parsedTotal = toNumber(total);

  if (
    Number.isNaN(parsedSubtotal) ||
    Number.isNaN(parsedTaxTotal) ||
    Number.isNaN(parsedTotal)
  ) {
    return null;
  }

  const lines: SaleDetailLine[] = [];
  for (const lineRow of linesRaw) {
    const line = mapSaleDocumentLine(lineRow);
    if (!line) {
      return null;
    }
    lines.push(line);
  }

  return {
    sale_id: saleId,
    sale_number: saleNumber,
    status,
    sale_date: String(saleDate),
    customer_id: customerId,
    subtotal: parsedSubtotal,
    tax_total: parsedTaxTotal,
    total: parsedTotal,
    confirmed_at: confirmedAt,
    paid_at: paidAt,
    cancelled_at: cancelledAt,
    lines,
  };
}

function mapConfirmSaleRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("sale id is required")) {
    return "Sale id is required.";
  }

  if (normalized.includes("sale was not found")) {
    return "Sale was not found.";
  }

  if (normalized.includes("only draft sales can be confirmed")) {
    return "Only draft sales can be confirmed.";
  }

  if (normalized.includes("has no lines to confirm")) {
    return "Add at least one line before confirming this sale.";
  }

  if (normalized.includes("product was not found")) {
    return "Product was not found.";
  }

  // Assembly line fulfillment failure (sql/085): confirm_sale wraps ANY
  // error raised while allocating a component — not just a real stock
  // shortage — in this "failed to allocate component ... while
  // assembling ..." prefix, with the real underlying reason (SQLERRM)
  // appended after the colon. Matching the prefix alone and unconditionally
  // returning the "not enough stock" message discarded that real reason
  // for every other failure this wraps (e.g. a database constraint
  // violation) — confirmed this session when a rounding bug in
  // finished_goods_batch_consumptions_total_cost_chk surfaced here as a
  // misleading "not enough stock" message and cost real debugging time.
  // Only translate to the friendly stock-shortage message when the
  // underlying reason actually says so; otherwise surface it.
  const assemblyComponentMatch = message.match(
    /failed to allocate component "([^"]+)" while assembling "([^"]+)":\s*(.*)$/i,
  );

  if (assemblyComponentMatch) {
    const [, componentName, dishName, underlyingReason] = assemblyComponentMatch;
    const normalizedReason = underlyingReason.toLowerCase();

    if (
      normalizedReason.includes("insufficient") &&
      normalizedReason.includes("stock")
    ) {
      return `Not enough "${componentName}" in stock to assemble "${dishName}".`;
    }

    return `Failed to allocate "${componentName}" while assembling "${dishName}": ${underlyingReason.trim()}`;
  }

  if (normalized.includes("insufficient finished goods stock")) {
    return "Not enough finished goods in stock.";
  }

  if (
    normalized.includes("already been allocated") ||
    normalized.includes("finished_goods_batch_consumptions_source_batch_uidx") ||
    (normalized.includes("duplicate") &&
      normalized.includes("finished_goods_batch_consumptions"))
  ) {
    return "This sale was already allocated.";
  }

  if (
    normalized.includes("remaining is negative") ||
    normalized.includes("would make batch remaining negative") ||
    normalized.includes("ledger integrity error")
  ) {
    return "Finished goods data is inconsistent. Contact support.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("confirm_sale") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Confirming sales is not available yet. Apply the confirm-sale database script and try again.";
  }

  return null;
}

function mapConfirmSaleError(error: unknown, fallback: string): string {
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
      return message ? mapConfirmSaleRpcError(message) : null;
    },
  });
}

function mapConfirmSaleRpcResult(
  data: unknown,
): { sale_id: string; total_cogs: number } | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const saleId = row.sale_id;
  const totalCogs = row.total_cogs;

  if (
    typeof saleId !== "string" ||
    (typeof totalCogs !== "number" && typeof totalCogs !== "string")
  ) {
    return null;
  }

  const parsedCogs = toNumber(totalCogs);
  if (Number.isNaN(parsedCogs)) {
    return null;
  }

  return {
    sale_id: saleId,
    total_cogs: parsedCogs,
  };
}

function mapSale(row: SaleRow): Sale {
  if (!isSaleStatus(row.status)) {
    throw new Error("Sale status is invalid.");
  }

  return {
    id: row.id,
    sale_number: row.sale_number,
    customer_id: row.customer_id,
    status: row.status,
    sale_date: row.sale_date,
    confirmed_at: row.confirmed_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
    fulfilled_at: row.fulfilled_at ?? null,
    is_paid: row.is_paid === true,
    subtotal: toNumber(row.subtotal),
    tax_total: toNumber(row.tax_total),
    total: toNumber(row.total),
    notes: row.notes,
    kitchen_note: row.kitchen_note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapSaleLine(row: SaleLineRow): SaleLine {
  return {
    id: row.id,
    sale_id: row.sale_id,
    product_id: row.product_id,
    quantity: toNumber(row.quantity),
    unit_price: toNumber(row.unit_price),
    line_total: toNumber(row.line_total),
    created_at: row.created_at,
  };
}

/**
 * Reload sale header + lines for the UI after confirmation.
 * Does not query Finished Goods availability or calculate COGS.
 */
async function reloadConfirmedSale(
  saleId: string,
): Promise<ServiceResult<SaleWithLines>> {
  const { data: saleData, error: saleError } = await supabase
    .from("sales")
    .select(SALE_SELECT)
    .eq("id", saleId)
    .maybeSingle();

  if (saleError) {
    return fail(toUserError(saleError, "Failed to reload confirmed sale"));
  }

  if (!saleData) {
    return fail("Sale was not found.");
  }

  const { data: lineData, error: lineError } = await supabase
    .from("sale_lines")
    .select(SALE_LINE_SELECT)
    .eq("sale_id", saleId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (lineError) {
    return fail(toUserError(lineError, "Failed to reload sale lines"));
  }

  try {
    const sale = mapSale(saleData as SaleRow);
    const lines = ((lineData as SaleLineRow[] | null) ?? []).map(mapSaleLine);

    return ok({
      ...sale,
      lines,
    });
  } catch {
    return fail("Confirmed sale response was invalid.");
  }
}

export const salesService = {
  /**
   * Create a draft sale header via create_draft_sale RPC.
   * SQL owns insert + sale_number. No lines, inventory, FIFO, or totals.
   */
  async createDraftSale(
    input: CreateDraftSaleInput = {},
  ): Promise<ServiceResult<CreateDraftSaleResult>> {
    try {
      const validationError = validateCreateDraftSaleInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to create a sale.");
      }

      const customerId = input.customer_id?.trim() || null;
      const notes = input.notes?.trim() ? input.notes.trim() : null;

      const { data, error } = await supabase.rpc("create_draft_sale", {
        p_customer_id: customerId,
        p_notes: notes,
      });

      if (error) {
        return fail(
          mapCreateDraftSaleError(error, "Failed to create draft sale."),
        );
      }

      const rpcResult = mapCreateDraftSaleRpcResult(data);
      if (!rpcResult) {
        return fail("Draft sale created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(
        mapCreateDraftSaleError(error, "Failed to create draft sale."),
      );
    }
  },

  /**
   * Add a line to a draft sale via add_sale_line RPC.
   * SQL owns insert + commercial totals. Returns the updated sale document.
   */
  async addSaleLine(
    input: AddSaleLineInput,
  ): Promise<ServiceResult<SaleDetail>> {
    try {
      const validationError = validateAddSaleLineInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to update a sale.");
      }

      const { data, error } = await supabase.rpc("add_sale_line", {
        p_sale_id: input.sale_id.trim(),
        p_product_id: input.product_id.trim(),
        p_quantity: Number(input.quantity),
        p_unit_price: Number(input.unit_price),
      });

      if (error) {
        return fail(mapSaleLineError(error, "Failed to add sale line."));
      }

      const sale = mapSaleDocumentRpcResult(data);
      if (!sale) {
        return fail("Sale line added but the response was invalid.");
      }

      return ok(sale);
    } catch (error) {
      return fail(mapSaleLineError(error, "Failed to add sale line."));
    }
  },

  /**
   * Update draft sale line quantity via update_sale_line RPC.
   * SQL owns quantity + commercial totals. Returns the updated sale document.
   */
  async updateSaleLine(
    input: UpdateSaleLineInput,
  ): Promise<ServiceResult<SaleDetail>> {
    try {
      const validationError = validateUpdateSaleLineInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to update a sale.");
      }

      const { data, error } = await supabase.rpc("update_sale_line", {
        p_sale_line_id: input.sale_line_id.trim(),
        p_quantity: Number(input.quantity),
      });

      if (error) {
        return fail(mapSaleLineError(error, "Failed to update sale line."));
      }

      const sale = mapSaleDocumentRpcResult(data);
      if (!sale) {
        return fail("Sale line updated but the response was invalid.");
      }

      return ok(sale);
    } catch (error) {
      return fail(mapSaleLineError(error, "Failed to update sale line."));
    }
  },

  /**
   * Delete a draft sale line via delete_sale_line RPC.
   * SQL owns delete + commercial totals. Returns the updated sale document.
   */
  async deleteSaleLine(
    input: DeleteSaleLineInput,
  ): Promise<ServiceResult<SaleDetail>> {
    try {
      const validationError = validateDeleteSaleLineInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to update a sale.");
      }

      const { data, error } = await supabase.rpc("delete_sale_line", {
        p_sale_line_id: input.sale_line_id.trim(),
      });

      if (error) {
        return fail(mapSaleLineError(error, "Failed to delete sale line."));
      }

      const sale = mapSaleDocumentRpcResult(data);
      if (!sale) {
        return fail("Sale line deleted but the response was invalid.");
      }

      return ok(sale);
    } catch (error) {
      return fail(mapSaleLineError(error, "Failed to delete sale line."));
    }
  },

  /**
   * Confirm a draft sale via confirm_sale RPC, then reload the sale read model.
   * SQL owns status transition and per-line FIFO Finished Goods consumption
   * (finished_goods_batch_consumptions). Remaining qty/value are calculated
   * from the ledger — never stored on production_batches (DEV-107).
   * Atomic multi-line confirm stays in SQL; do not call TS consumeForSale here.
   */
  async confirmSale(saleId: string): Promise<ServiceResult<ConfirmSaleResult>> {
    try {
      const validationError = validateConfirmSaleInput(saleId);
      if (validationError) {
        return fail(validationError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to confirm a sale.");
      }

      const { data, error } = await supabase.rpc("confirm_sale", {
        p_sale_id: saleId.trim(),
      });

      if (error) {
        return fail(mapConfirmSaleError(error, "Failed to confirm sale."));
      }

      const rpcResult = mapConfirmSaleRpcResult(data);
      if (!rpcResult) {
        return fail("Sale confirmed but the response was invalid.");
      }

      const saleResult = await reloadConfirmedSale(rpcResult.sale_id);
      if (saleResult.error || !saleResult.data) {
        return fail(saleResult.error ?? "Failed to reload confirmed sale");
      }

      return ok({
        sale: saleResult.data,
        total_cogs: rpcResult.total_cogs,
      });
    } catch (error) {
      return fail(mapConfirmSaleError(error, "Failed to confirm sale."));
    }
  },

  /**
   * Confirm a sale then post Accounting journals (DEV-109).
   *
   * Uses frozen confirm_sale COGS + sale commercial totals — never recalculates.
   * Existing confirmSale (hooks/UI) remains unchanged.
   *
   * confirmSale has already succeeded and is durable by the time posting is
   * attempted — a posting failure must never look like the whole operation
   * failed (that would silently discard a real confirmed sale from the
   * caller's point of view). So this only ever returns fail(...) when
   * confirmSale itself fails; once that succeeds, the result is always
   * ok(...), with posting/postingError reporting whether the accounting
   * entry was actually created.
   */
  async confirmSaleAndPostJournals(
    saleId: string,
    accounting: SaleAccountingContext,
  ): Promise<
    ServiceResult<{
      sale: SaleWithLines;
      total_cogs: number;
      posting: SaleJournalPostings | null;
      postingError: string | null;
    }>
  > {
    const confirmed = await this.confirmSale(saleId);
    if (confirmed.error || !confirmed.data) {
      return fail(confirmed.error ?? "Failed to confirm sale.");
    }

    const posting = await saleAccountingService.postJournalsForSaleCompleted(
      confirmed.data,
      accounting,
    );

    if (posting.error || !posting.data) {
      return ok({
        sale: confirmed.data.sale,
        total_cogs: confirmed.data.total_cogs,
        posting: null,
        postingError:
          posting.error ?? "Sale confirmed but accounting posting failed.",
      });
    }

    return ok({
      sale: confirmed.data.sale,
      total_cogs: confirmed.data.total_cogs,
      posting: posting.data,
      postingError: null,
    });
  },

  /**
   * One-tap sale (DEV-112 / sql/086_quick_sale.sql): create + add every
   * cart line + confirm in a single RPC call, instead of separate
   * createDraftSale / addSaleLine / confirmSale round trips. Reuses the
   * same result mapping and sale-reload logic as confirmSale — the RPC
   * itself calls confirm_sale internally and returns its exact
   * {sale_id, total_cogs} shape.
   */
  async createAndConfirmSale(
    input: CreateAndConfirmSaleInput,
  ): Promise<ServiceResult<ConfirmSaleResult>> {
    try {
      if (input.lines.length === 0) {
        return fail("Add at least one item before confirming this sale.");
      }

      const customerId = input.customer_id?.trim() ?? "";
      if (customerId.length > 0 && !UUID_RE.test(customerId)) {
        return fail("Customer id is invalid.");
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to confirm a sale.");
      }

      const kitchenNote = input.kitchen_note?.trim()
        ? input.kitchen_note.trim()
        : null;

      const { data, error } = await supabase.rpc("create_and_confirm_sale", {
        p_customer_id: customerId.length > 0 ? customerId : null,
        p_lines: input.lines,
        p_kitchen_note: kitchenNote,
      });

      if (error) {
        return fail(mapConfirmSaleError(error, "Failed to complete quick sale."));
      }

      const rpcResult = mapConfirmSaleRpcResult(data);
      if (!rpcResult) {
        return fail("Sale confirmed but the response was invalid.");
      }

      const saleResult = await reloadConfirmedSale(rpcResult.sale_id);
      if (saleResult.error || !saleResult.data) {
        return fail(saleResult.error ?? "Failed to reload confirmed sale");
      }

      return ok({
        sale: saleResult.data,
        total_cogs: rpcResult.total_cogs,
      });
    } catch (error) {
      return fail(mapConfirmSaleError(error, "Failed to complete quick sale."));
    }
  },

  /**
   * Quick sale + Accounting journals, same posting-failure-is-non-fatal
   * contract as confirmSaleAndPostJournals: once createAndConfirmSale
   * succeeds the sale is durable, so this only fails before that point.
   */
  async createAndConfirmSaleAndPostJournals(
    input: CreateAndConfirmSaleInput,
    accounting: SaleAccountingContext,
  ): Promise<
    ServiceResult<{
      sale: SaleWithLines;
      total_cogs: number;
      posting: SaleJournalPostings | null;
      postingError: string | null;
    }>
  > {
    const confirmed = await this.createAndConfirmSale(input);
    if (confirmed.error || !confirmed.data) {
      return fail(confirmed.error ?? "Failed to complete quick sale.");
    }

    const posting = await saleAccountingService.postJournalsForSaleCompleted(
      confirmed.data,
      accounting,
    );

    if (posting.error || !posting.data) {
      return ok({
        sale: confirmed.data.sale,
        total_cogs: confirmed.data.total_cogs,
        posting: null,
        postingError:
          posting.error ?? "Sale confirmed but accounting posting failed.",
      });
    }

    return ok({
      sale: confirmed.data.sale,
      total_cogs: confirmed.data.total_cogs,
      posting: posting.data,
      postingError: null,
    });
  },

  /**
   * Put a just-confirmed sale into the kitchen queue by clearing the
   * default-ready stamp the draft→confirmed trigger wrote. Call only when
   * the seller ticked "Send to queue". Does not touch confirm_sale.
   */
  async markSaleQueued(saleId: string): Promise<ServiceResult<{ id: string }>> {
    const validationError = validateConfirmSaleInput(saleId);
    if (validationError) {
      return fail(validationError);
    }

    const trimmed = saleId.trim();

    try {
      const { error } = await supabase
        .from("sales")
        .update({ fulfilled_at: null })
        .eq("id", trimmed)
        .not("fulfilled_at", "is", null);

      if (error) {
        return fail(toUserError(error, "Failed to send sale to the queue."));
      }

      return ok({ id: trimmed });
    } catch (error) {
      return fail(toUserError(error, "Failed to send sale to the queue."));
    }
  },

  /**
   * Mark a queued sale as ready (cook pressed Done). Does not touch
   * confirm_sale, stock, or journals.
   */
  async markSaleFulfilled(
    saleId: string,
  ): Promise<ServiceResult<{ id: string }>> {
    const validationError = validateConfirmSaleInput(saleId);
    if (validationError) {
      return fail(validationError);
    }

    const trimmed = saleId.trim();

    try {
      const { error } = await supabase
        .from("sales")
        .update({ fulfilled_at: new Date().toISOString() })
        .eq("id", trimmed)
        .is("fulfilled_at", null);

      if (error) {
        return fail(toUserError(error, "Failed to mark sale as ready."));
      }

      return ok({ id: trimmed });
    } catch (error) {
      return fail(toUserError(error, "Failed to mark sale as ready."));
    }
  },

  /**
   * Kitchen-queue payment flag. Calls set_sale_paid_flag so the client
   * never UPDATEs sales.is_paid through the wide RLS policy. Does not
   * touch status, paid_at, fulfilled_at, confirm_sale, stock, or journals.
   */
  async markSalePaid(saleId: string): Promise<ServiceResult<{ id: string }>> {
    const validationError = validateConfirmSaleInput(saleId);
    if (validationError) {
      return fail(validationError);
    }

    const trimmed = saleId.trim();

    try {
      const { error } = await supabase.rpc("set_sale_paid_flag", {
        p_sale_id: trimmed,
        p_is_paid: true,
      });

      if (error) {
        return fail(toUserError(error, "Failed to mark sale as paid."));
      }

      return ok({ id: trimmed });
    } catch (error) {
      return fail(toUserError(error, "Failed to mark sale as paid."));
    }
  },
};
