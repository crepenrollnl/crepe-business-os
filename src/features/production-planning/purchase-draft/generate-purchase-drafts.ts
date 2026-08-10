import type { CalendarDate, EntityId, Quantity } from "@/types/erp";

import type {
  ProcurementRecommendation,
  ProcurementRecommendationItem,
} from "../procurement/types";
import type { PlanValidationIssue } from "../types/validation";
import type {
  PurchaseDraft,
  PurchaseDraftCollection,
  PurchaseDraftCollectionSummary,
  PurchaseDraftLine,
} from "./types";
import { validateProcurementRecommendationForDraft } from "./validate-procurement-recommendation-for-draft";

/** Stable draft id for lines without a supplier. */
const UNASSIGNED_SUPPLIER_DRAFT_ID = "purchase-draft-unassigned";

/**
 * Generator input. All data is passed in — no I/O, no hidden state.
 */
export interface GeneratePurchaseDraftsInput {
  recommendation: ProcurementRecommendation;
  /** Optional notes copied onto every produced draft. */
  notes?: string;
  /** Optional planned delivery date copied onto every produced draft. */
  plannedDeliveryDate?: CalendarDate;
}

/**
 * Generator output. Business validation never throws.
 */
export type GeneratePurchaseDraftsOutput =
  | { ok: true; collection: PurchaseDraftCollection }
  | { ok: false; issues: readonly PlanValidationIssue[] };

interface SupplierDraftGroup {
  key: string;
  supplierId?: EntityId;
  supplierName?: string;
  items: ProcurementRecommendationItem[];
}

function draftIdForSupplier(supplierId: EntityId | undefined): EntityId {
  if (supplierId === undefined || supplierId.length === 0) {
    return UNASSIGNED_SUPPLIER_DRAFT_ID;
  }
  return `purchase-draft-${supplierId}`;
}

function groupKeyForItem(item: ProcurementRecommendationItem): string {
  if (item.supplierId === undefined || item.supplierId.length === 0) {
    return "";
  }
  return item.supplierId;
}

/**
 * Group recommendation items by supplier.
 *
 * - No supplier metadata → one group (single draft)
 * - Supplier metadata present → one group per supplierId
 * - Mixed → one draft per supplier plus one unassigned draft
 *
 * Group order follows first appearance in the recommendation.
 */
function groupItemsBySupplier(
  items: readonly ProcurementRecommendationItem[],
): SupplierDraftGroup[] {
  const groups = new Map<string, SupplierDraftGroup>();
  const orderedKeys: string[] = [];

  for (const item of items) {
    const key = groupKeyForItem(item);
    const existing = groups.get(key);

    if (existing === undefined) {
      orderedKeys.push(key);
      groups.set(key, {
        key,
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        items: [item],
      });
      continue;
    }

    if (existing.supplierName === undefined && item.supplierName !== undefined) {
      existing.supplierName = item.supplierName;
    }
    existing.items.push(item);
  }

  return orderedKeys.map((key) => groups.get(key) as SupplierDraftGroup);
}

function toDraftLine(item: ProcurementRecommendationItem): PurchaseDraftLine {
  return {
    ingredientId: item.ingredientId,
    ingredientName: item.ingredientName,
    recommendedPurchaseQuantity: item.recommendedPurchaseQuantity,
    unit: item.unit,
    packageSize: item.packageSize,
    packagesToBuy: item.packagesToBuy,
    recommendationReason: item.recommendationReason,
  };
}

function buildDraft(
  group: SupplierDraftGroup,
  notes: string,
  plannedDeliveryDate: CalendarDate | undefined,
): PurchaseDraft {
  return {
    draftId: draftIdForSupplier(group.supplierId),
    supplierId: group.supplierId,
    supplierName: group.supplierName,
    plannedDeliveryDate,
    notes,
    status: "Draft",
    lines: group.items.map(toDraftLine),
  };
}

function buildSummary(
  drafts: readonly PurchaseDraft[],
): PurchaseDraftCollectionSummary {
  let totalLines = 0;
  let totalPurchaseQuantity: Quantity = 0;

  for (const draft of drafts) {
    totalLines += draft.lines.length;
    for (const line of draft.lines) {
      totalPurchaseQuantity += line.recommendedPurchaseQuantity;
    }
  }

  return {
    totalDrafts: drafts.length,
    totalLines,
    totalPurchaseQuantity,
  };
}

/**
 * Purchase Draft Builder (DEV-006).
 *
 * Transforms a Procurement Recommendation into Purchase Draft objects
 * ready for the Purchases module to review and save.
 *
 * Rules:
 * - No supplier information → one draft containing all lines
 * - Supplier information present → one draft per supplier
 * - Status is always Draft
 * - No pricing (Purchases owns cost)
 * - Never creates Purchases, mutates inventory, or persists data
 *
 * This is the only approved way to create Purchase Drafts from
 * Procurement Recommendations.
 */
export function generatePurchaseDrafts(
  input: GeneratePurchaseDraftsInput,
): GeneratePurchaseDraftsOutput {
  const validation = validateProcurementRecommendationForDraft(
    input.recommendation,
  );

  if (!validation.ok) {
    return { ok: false, issues: validation.issues };
  }

  const notes = input.notes ?? "";
  const groups = groupItemsBySupplier(input.recommendation.items);
  const drafts = groups.map((group) =>
    buildDraft(group, notes, input.plannedDeliveryDate),
  );

  const collection: PurchaseDraftCollection = {
    drafts,
    summary: buildSummary(drafts),
  };

  return { ok: true, collection };
}
