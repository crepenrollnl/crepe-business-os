import { DEFAULT_CURRENCY } from "@/constants/config";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import type { ServiceResult } from "@/types/service";
import type {
  CreatePlanningPurchaseDraftInput,
  Purchase,
  PurchaseFormValues,
  PurchaseIngredientOption,
  PurchaseItem,
  PurchaseItemWithRelations,
  PurchaseLineInput,
  PurchaseListItem,
  PurchaseStatus,
  PurchaseSupplier,
  PurchaseWithRelations,
  SavePurchaseInput,
} from "../types/purchase";
import type {
  PurchaseAccountingContext,
  PurchaseJournalPosting,
} from "../types/purchase-accounting";
import type { PurchaseTaxDocument, PurchaseTaxResult } from "../types/purchase-tax";
import {
  DEFAULT_COMPANY_ID,
  DEFAULT_TAX_COUNTRY,
} from "../utils/build-purchase-tax-document";
import { toNetPurchaseLines } from "../utils/to-net-purchase-lines";
import { purchaseAccountingService } from "./purchase-accounting-service";
import { purchaseTaxService } from "./purchase-tax-service";

interface PurchaseRow {
  id: string;
  supplier_id: string | null;
  status: PurchaseStatus;
  invoice_number: string | null;
  notes: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
  currency: string;
  purchased_at: string;
  transaction_id: string | null;
  production_plan_id?: string | null;
  tax_country?: string | null;
  supplier_country?: string | null;
  created_at: string;
  updated_at?: string;
}

interface PurchaseItemRow {
  id: string;
  purchase_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit_cost: number | string;
  line_total: number | string;
  tax_category?: string | null;
  tax_regime?: string | null;
  price_mode?: string | null;
  entered_unit_price?: number | string | null;
  discount?: number | string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableTrimmedString(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableIsoCountry(
  value: string | null | undefined,
): string | null {
  const trimmed = toNullableTrimmedString(value);
  return trimmed ? trimmed.toUpperCase() : null;
}

function mapPurchase(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    supplier_id: row.supplier_id,
    status: row.status,
    invoice_number: row.invoice_number,
    notes: row.notes,
    subtotal: toNumber(row.subtotal),
    tax_total: toNumber(row.tax_total),
    total: toNumber(row.total),
    currency: row.currency,
    purchased_at: row.purchased_at,
    transaction_id: row.transaction_id,
    production_plan_id: row.production_plan_id ?? null,
    tax_country: toNullableTrimmedString(row.tax_country),
    supplier_country: toNullableTrimmedString(row.supplier_country),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPurchaseItem(row: PurchaseItemRow): PurchaseItem {
  const priceMode = row.price_mode?.trim() ?? "";

  return {
    id: row.id,
    purchase_id: row.purchase_id,
    ingredient_id: row.ingredient_id,
    quantity: toNumber(row.quantity),
    unit_cost: toNumber(row.unit_cost),
    line_total: toNumber(row.line_total),
    tax_category: toNullableTrimmedString(row.tax_category),
    tax_regime: toNullableTrimmedString(row.tax_regime),
    price_mode:
      priceMode === "inclusive" || priceMode === "exclusive"
        ? priceMode
        : null,
    entered_unit_price: toNullableNumber(row.entered_unit_price),
    discount: toNullableNumber(row.discount),
  };
}

function normalizePurchasedAt(value: string): string {
  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T12:00:00.000Z`).toISOString();
  }

  return new Date(trimmed).toISOString();
}

function validateLines(lines: PurchaseLineInput[]): string | null {
  if (lines.length === 0) {
    return "Add at least one purchase line";
  }

  for (const line of lines) {
    if (!line.ingredient_id.trim()) {
      return "Each line must have an ingredient";
    }

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return "Quantity must be greater than zero";
    }

    if (!Number.isFinite(line.unit_cost) || line.unit_cost < 0) {
      return "Unit price must be 0 or greater";
    }
  }

  return null;
}

function validatePurchaseInput(
  input: PurchaseFormValues,
  status: PurchaseStatus,
): string | null {
  // Drafts may omit supplier (e.g. generated from Production Planning).
  // Receiving goods always requires a supplier.
  if (status !== "draft" && !input.supplier_id.trim()) {
    return "Supplier is required";
  }

  if (!input.purchased_at.trim()) {
    return "Purchase date is required";
  }

  const purchasedAt = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(input.purchased_at.trim())
      ? `${input.purchased_at.trim()}T12:00:00.000Z`
      : input.purchased_at,
  );

  if (Number.isNaN(purchasedAt.getTime())) {
    return "Purchase date is invalid";
  }

  return validateLines(input.lines);
}

interface PurchaseTotals {
  preparedLines: Array<{
    ingredient_id: string;
    quantity: number;
    unit_cost: number;
    line_total: number;
    tax_category: string | null;
    tax_regime: string | null;
    price_mode: "exclusive" | "inclusive" | null;
    entered_unit_price: number | null;
    discount: number | null;
  }>;
  subtotal: number;
  tax_total: number;
  total: number;
}

/**
 * Calculates line/subtotal/tax/total on the server (calculate_purchase_totals)
 * instead of in JS, so the persisted purchase always matches a server-side
 * calculation rather than whatever a given client build computed.
 */
async function buildTotals(
  lines: PurchaseLineInput[],
  taxTotal = 0,
): Promise<ServiceResult<PurchaseTotals>> {
  const { data, error } = await supabase.rpc("calculate_purchase_totals", {
    p_lines: lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: line.quantity,
      unit_cost: line.unit_cost,
      discount: line.discount ?? 0,
    })),
    p_tax_total: taxTotal,
  });

  if (error || !data) {
    return {
      data: null,
      error: toUserError(error, "Failed to calculate purchase totals"),
    };
  }

  const rows = data.lines as Array<Record<string, number | string>>;

  return {
    data: {
      preparedLines: rows.map((line, index) => {
        const source = lines[index];
        const priceMode = source?.price_mode;

        return {
          ingredient_id: line.ingredient_id as string,
          quantity: toNumber(line.quantity),
          unit_cost: toNumber(line.unit_cost),
          line_total: toNumber(line.line_total),
          tax_category: toNullableTrimmedString(source?.tax_category),
          tax_regime: toNullableTrimmedString(source?.tax_regime),
          price_mode:
            priceMode === "inclusive" || priceMode === "exclusive"
              ? priceMode
              : null,
          entered_unit_price: toNullableNumber(source?.entered_unit_price),
          discount: toNullableNumber(source?.discount),
        };
      }),
      subtotal: toNumber(data.subtotal as number | string),
      tax_total: toNumber(data.tax_total as number | string),
      total: toNumber(data.total as number | string),
    },
    error: null,
  };
}

function toPurchasePayload(
  input: PurchaseFormValues,
  status: PurchaseStatus,
  totals: PurchaseTotals,
) {
  return {
    supplier_id: input.supplier_id.trim().length > 0 ? input.supplier_id : null,
    status,
    invoice_number:
      input.invoice_number.trim().length > 0 ? input.invoice_number.trim() : null,
    notes: input.notes.trim().length > 0 ? input.notes.trim() : null,
    tax_country: toNullableIsoCountry(input.tax_country),
    supplier_country: toNullableIsoCountry(input.supplier_country),
    subtotal: totals.subtotal,
    tax_total: totals.tax_total,
    total: totals.total,
    currency: DEFAULT_CURRENCY,
    purchased_at: normalizePurchasedAt(input.purchased_at),
    updated_at: new Date().toISOString(),
  };
}

async function fetchSuppliers(): Promise<ServiceResult<PurchaseSupplier[]>> {
  try {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name")
      .order("name");

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load suppliers"),
      };
    }

    return { data: data ?? [], error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load suppliers"),
    };
  }
}

async function fetchIngredients(): Promise<
  ServiceResult<PurchaseIngredientOption[]>
> {
  try {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, unit")
      .order("name");

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load ingredients"),
      };
    }

    return { data: data ?? [], error: null };
  } catch (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load ingredients"),
    };
  }
}

async function replacePurchaseItems(
  purchaseId: string,
  lines: PurchaseTotals["preparedLines"],
): Promise<ServiceResult<PurchaseItem[]>> {
  const { error: deleteError } = await supabase
    .from("purchase_items")
    .delete()
    .eq("purchase_id", purchaseId);

  if (deleteError) {
    return {
      data: null,
      error: toUserError(deleteError, "Failed to update purchase lines"),
    };
  }

  const { data, error } = await supabase
    .from("purchase_items")
    .insert(
      lines.map((line) => ({
        purchase_id: purchaseId,
        ingredient_id: line.ingredient_id,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        line_total: line.line_total,
        tax_category: line.tax_category,
        tax_regime: line.tax_regime,
        price_mode: line.price_mode,
        entered_unit_price: line.entered_unit_price,
        discount: line.discount,
      })),
    )
    .select("*");

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to save purchase lines"),
    };
  }

  return {
    data: (data ?? []).map((row) => mapPurchaseItem(row as PurchaseItemRow)),
    error: null,
  };
}

async function getPurchaseStatus(
  id: string,
): Promise<ServiceResult<PurchaseStatus>> {
  const { data, error } = await supabase
    .from("purchases")
    .select("status")
    .eq("id", id)
    .single();

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to load purchase"),
    };
  }

  return { data: data.status as PurchaseStatus, error: null };
}

async function enrichPurchase(
  purchase: Purchase,
  items: PurchaseItem[],
): Promise<ServiceResult<PurchaseWithRelations>> {
  const [suppliersResult, ingredientsResult] = await Promise.all([
    fetchSuppliers(),
    fetchIngredients(),
  ]);

  if (suppliersResult.error) {
    return { data: null, error: suppliersResult.error };
  }

  if (ingredientsResult.error) {
    return { data: null, error: ingredientsResult.error };
  }

  const supplierMap = new Map(
    (suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier]),
  );
  const ingredientMap = new Map(
    (ingredientsResult.data ?? []).map((ingredient) => [
      ingredient.id,
      ingredient,
    ]),
  );

  const enrichedItems: PurchaseItemWithRelations[] = items.map((item) => ({
    ...item,
    ingredient: ingredientMap.get(item.ingredient_id) ?? null,
  }));

  return {
    data: {
      ...purchase,
      supplier: purchase.supplier_id
        ? (supplierMap.get(purchase.supplier_id) ?? null)
        : null,
      items: enrichedItems,
    },
    error: null,
  };
}

async function persistPurchase(
  input: SavePurchaseInput,
  status: PurchaseStatus,
): Promise<ServiceResult<PurchaseWithRelations>> {
  const validationError = validatePurchaseInput(input, status);

  if (validationError) {
    return { data: null, error: validationError };
  }

  const totalsResult = await buildTotals(input.lines, input.tax_total ?? 0);

  if (totalsResult.error || !totalsResult.data) {
    return {
      data: null,
      error: totalsResult.error ?? "Failed to calculate purchase totals",
    };
  }

  const totals = totalsResult.data;
  const payload = toPurchasePayload(input, status, totals);

  if (input.id) {
    const statusResult = await getPurchaseStatus(input.id);

    if (statusResult.error || !statusResult.data) {
      return {
        data: null,
        error: statusResult.error ?? "Failed to load purchase",
      };
    }

    if (statusResult.data !== "draft") {
      return {
        data: null,
        error: "Only draft purchases can be edited",
      };
    }

    const { data, error } = await supabase
      .from("purchases")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();

    if (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to update purchase"),
      };
    }

    const itemsResult = await replacePurchaseItems(input.id, totals.preparedLines);

    if (itemsResult.error || !itemsResult.data) {
      return {
        data: null,
        error: itemsResult.error ?? "Failed to save purchase lines",
      };
    }

    return enrichPurchase(mapPurchase(data as PurchaseRow), itemsResult.data);
  }

  const { data, error } = await supabase
    .from("purchases")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return {
      data: null,
      error: toUserError(error, "Failed to create purchase"),
    };
  }

  const purchase = mapPurchase(data as PurchaseRow);
  const itemsResult = await replacePurchaseItems(
    purchase.id,
    totals.preparedLines,
  );

  if (itemsResult.error || !itemsResult.data) {
    await supabase.from("purchases").delete().eq("id", purchase.id);

    return {
      data: null,
      error: itemsResult.error ?? "Failed to save purchase lines",
    };
  }

  return enrichPurchase(purchase, itemsResult.data);
}

export const purchaseService = {
  async getPurchases(): Promise<ServiceResult<PurchaseListItem[]>> {
    try {
      const [purchasesResult, suppliersResult, itemsResult] = await Promise.all([
        supabase
          .from("purchases")
          .select("*")
          .order("purchased_at", { ascending: false }),
        fetchSuppliers(),
        supabase.from("purchase_items").select("purchase_id"),
      ]);

      if (purchasesResult.error) {
        return {
          data: null,
          error: toUserError(purchasesResult.error, "Failed to load purchases"),
        };
      }

      if (suppliersResult.error) {
        return { data: null, error: suppliersResult.error };
      }

      if (itemsResult.error) {
        return {
          data: null,
          error: toUserError(itemsResult.error, "Failed to load purchase lines"),
        };
      }

      const supplierMap = new Map(
        (suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier]),
      );

      const itemCountMap = new Map<string, number>();

      for (const item of itemsResult.data ?? []) {
        const purchaseId = item.purchase_id as string;
        itemCountMap.set(purchaseId, (itemCountMap.get(purchaseId) ?? 0) + 1);
      }

      const purchases = (purchasesResult.data ?? []).map((row) => {
        const purchase = mapPurchase(row as PurchaseRow);

        return {
          ...purchase,
          supplier: purchase.supplier_id
            ? (supplierMap.get(purchase.supplier_id) ?? null)
            : null,
          item_count: itemCountMap.get(purchase.id) ?? 0,
        };
      });

      return { data: purchases, error: null };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load purchases"),
      };
    }
  },

  async getPurchaseById(
    id: string,
  ): Promise<ServiceResult<PurchaseWithRelations>> {
    try {
      const { data, error } = await supabase
        .from("purchases")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        return {
          data: null,
          error: toUserError(error, "Failed to load purchase"),
        };
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from("purchase_items")
        .select("*")
        .eq("purchase_id", id);

      if (itemsError) {
        return {
          data: null,
          error: toUserError(itemsError, "Failed to load purchase lines"),
        };
      }

      const items = (itemsData ?? []).map((row) =>
        mapPurchaseItem(row as PurchaseItemRow),
      );

      return enrichPurchase(mapPurchase(data as PurchaseRow), items);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load purchase"),
      };
    }
  },

  async getSuppliers(): Promise<ServiceResult<PurchaseSupplier[]>> {
    return fetchSuppliers();
  },

  async getIngredients(): Promise<ServiceResult<PurchaseIngredientOption[]>> {
    return fetchIngredients();
  },

  async saveDraft(
    input: SavePurchaseInput,
  ): Promise<ServiceResult<PurchaseWithRelations>> {
    try {
      return await persistPurchase(input, "draft");
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to save draft purchase"),
      };
    }
  },

  /**
   * Creates a draft purchase from Production Planning shopping list.
   * Supplier and prices stay empty for completion in Purchases.
   * Does not receive goods or change inventory.
   */
  async createDraftFromProductionPlan(
    input: CreatePlanningPurchaseDraftInput,
  ): Promise<ServiceResult<PurchaseWithRelations>> {
    try {
      if (!input.production_plan_id.trim()) {
        return { data: null, error: "Production plan is required" };
      }

      if (input.lines.length === 0) {
        return { data: null, error: "Add at least one purchase line" };
      }

      const { data: existing, error: existingError } = await supabase
        .from("purchases")
        .select("id, status")
        .eq("production_plan_id", input.production_plan_id)
        .neq("status", "cancelled")
        .maybeSingle();

      if (existingError) {
        return {
          data: null,
          error: toUserError(existingError, "Failed to check existing purchase draft"),
        };
      }

      if (existing) {
        return {
          data: null,
          error: "Already transferred.",
        };
      }

      // Same flat default addLine() seeds on every manually-added purchase
      // line (purchase-document-modal.tsx) — not ingredient-specific, just a
      // reasonable starting category so the line isn't left fully blank.
      // unit_cost stays 0 here deliberately: real cost is only known at
      // Receive time, same as before this fix.
      const formLines: PurchaseLineInput[] = input.lines.map((line) => ({
        ingredient_id: line.ingredient_id,
        quantity: line.quantity,
        unit_cost: 0,
        tax_category: "food",
        tax_regime: "reduced_vat",
        price_mode: "inclusive",
      }));

      const lineValidation = validateLines(formLines);

      if (lineValidation) {
        return { data: null, error: lineValidation };
      }

      // Resolve real tax via calculate_purchase_taxes, same as saveDraft
      // (use-purchases.ts resolvePurchaseTax) does for a manually-edited
      // draft — a plan-generated draft must not silently persist with
      // tax_total hardcoded to 0 the way buildTotals's default would.
      const purchasedAt = new Date().toISOString();
      const taxDocument: PurchaseTaxDocument = {
        document_id: null,
        company: {
          company_id: DEFAULT_COMPANY_ID,
          base_currency: DEFAULT_CURRENCY,
        },
        country: DEFAULT_TAX_COUNTRY,
        transaction_date: purchasedAt,
        currency: DEFAULT_CURRENCY,
        // No supplier yet at generation time (assigned later in Purchases).
        // country_code still needs a value for calculate_purchase_taxes to
        // resolve a rule, so it falls back to the tax country here, same as
        // buildPurchaseTaxDocument does for an unassigned supplier.
        supplier: {
          supplier_id: null,
          name: null,
          country_code: DEFAULT_TAX_COUNTRY,
        },
        lines: formLines.map((line, index) => ({
          line_id: `line-${index + 1}`,
          quantity: line.quantity,
          unit_price: line.unit_cost,
          discount: line.discount ?? 0,
          price_mode: line.price_mode === "inclusive" ? "inclusive" : "exclusive",
          tax_category: line.tax_category ?? "",
          tax_regime: line.tax_regime ?? null,
        })),
      };

      const taxResult = await purchaseTaxService.calculatePurchaseTaxes(taxDocument);

      if (taxResult.error || !taxResult.data) {
        return {
          data: null,
          error: taxResult.error ?? "Failed to calculate purchase taxes.",
        };
      }

      const netLinesResult = toNetPurchaseLines(formLines, taxResult.data);

      if (netLinesResult.error || !netLinesResult.data) {
        return {
          data: null,
          error:
            netLinesResult.error ??
            "Failed to convert inclusive prices to net unit cost.",
        };
      }

      const totalsResult = await buildTotals(
        netLinesResult.data,
        taxResult.data.tax_total,
      );

      if (totalsResult.error || !totalsResult.data) {
        return {
          data: null,
          error: totalsResult.error ?? "Failed to calculate purchase totals",
        };
      }

      const totals = totalsResult.data;

      const { data, error } = await supabase
        .from("purchases")
        .insert({
          supplier_id: null,
          status: "draft",
          invoice_number: null,
          notes: input.notes.trim().length > 0 ? input.notes.trim() : null,
          subtotal: totals.subtotal,
          tax_total: totals.tax_total,
          total: totals.total,
          currency: DEFAULT_CURRENCY,
          purchased_at: purchasedAt,
          production_plan_id: input.production_plan_id,
          updated_at: purchasedAt,
        })
        .select("*")
        .single();

      if (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message.toLowerCase()
            : "";

        if (
          message.includes("production_plan_id") ||
          message.includes("purchases_production_plan_id")
        ) {
          return {
            data: null,
            error: "Already transferred.",
          };
        }

        return {
          data: null,
          error: toUserError(error, "Failed to create purchase draft"),
        };
      }

      const purchase = mapPurchase(data as PurchaseRow);
      const itemsResult = await replacePurchaseItems(
        purchase.id,
        totals.preparedLines,
      );

      if (itemsResult.error || !itemsResult.data) {
        await supabase.from("purchases").delete().eq("id", purchase.id);

        return {
          data: null,
          error: itemsResult.error ?? "Failed to save purchase lines",
        };
      }

      return enrichPurchase(purchase, itemsResult.data);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to create purchase draft"),
      };
    }
  },

  async receivePurchase(
    input: SavePurchaseInput,
  ): Promise<ServiceResult<PurchaseWithRelations>> {
    try {
      if (input.id) {
        const statusResult = await getPurchaseStatus(input.id);

        if (statusResult.error || !statusResult.data) {
          return {
            data: null,
            error: statusResult.error ?? "Failed to load purchase",
          };
        }

        if (statusResult.data === "received") {
          return {
            data: null,
            error: "This purchase has already been received",
          };
        }

        if (statusResult.data !== "draft") {
          return {
            data: null,
            error: "Only draft purchases can be received",
          };
        }
      }

      // Save header/line edits as a draft first (unchanged from before).
      // The actual receive — status transition + every line's stock/cost
      // update — happens atomically in one RPC (sql/116): it locks the
      // purchase row, re-checks status = draft under that lock, and either
      // applies every line and flips the status, or raises and rolls back
      // the whole thing. No manual per-line reversal is needed here.
      const saved = await persistPurchase(input, "draft");

      if (saved.error || !saved.data) {
        return saved;
      }

      const { error: receiveError } = await supabase.rpc("receive_purchase", {
        p_purchase_id: saved.data.id,
      });

      if (receiveError) {
        return {
          data: null,
          error: toUserError(receiveError, "Failed to receive purchase"),
        };
      }

      return await purchaseService.getPurchaseById(saved.data.id);
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to receive purchase"),
      };
    }
  },

  /**
   * Receive a purchase, then post the Accounting journal (audit finding #3).
   *
   * Requires a precomputed PurchaseTaxResult (DEV-100).
   * Accounting never recalculates taxes.
   *
   * receivePurchase has already succeeded and is durable by the time
   * posting is attempted — a posting failure must never look like the
   * whole operation failed (that would silently discard a real received
   * purchase from the caller's point of view). So this only ever returns
   * an error when receivePurchase itself fails; once that succeeds, the
   * result is always ok(...), with posting/postingError reporting whether
   * the accounting entry was actually created. Same pattern as
   * completeSessionAndPostJournal (Production) / confirmSaleAndPostJournals
   * (Sales).
   */
  async receivePurchaseAndPostJournal(
    input: SavePurchaseInput,
    accounting: PurchaseAccountingContext,
    tax: PurchaseTaxResult,
  ): Promise<
    ServiceResult<{
      purchase: PurchaseWithRelations;
      posting: PurchaseJournalPosting | null;
      postingError: string | null;
    }>
  > {
    const received = await purchaseService.receivePurchase(input);

    if (received.error || !received.data) {
      return {
        data: null,
        error: received.error ?? "Failed to receive purchase",
      };
    }

    const posting = await purchaseAccountingService.postJournalForPurchaseReceived(
      received.data,
      accounting,
      tax,
    );

    if (posting.error || !posting.data) {
      return {
        data: {
          purchase: received.data,
          posting: null,
          postingError:
            posting.error ?? "Purchase received but accounting posting failed.",
        },
        error: null,
      };
    }

    return {
      data: {
        purchase: received.data,
        posting: posting.data,
        postingError: null,
      },
      error: null,
    };
  },
};
