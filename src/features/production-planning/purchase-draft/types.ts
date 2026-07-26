import type {
  CalendarDate,
  EntityId,
  Money,
  Quantity,
  Unit,
} from "@/types/erp";

import type { ProcurementRecommendationReason } from "../procurement/types";

/**
 * Purchase Draft lifecycle statuses produced by Planning.
 * Current version supports Draft only — Purchases owns later transitions.
 */
export const PURCHASE_DRAFT_STATUSES = ["Draft"] as const;

export type PurchaseDraftStatus = (typeof PURCHASE_DRAFT_STATUSES)[number];

export function isPurchaseDraftStatus(
  value: string,
): value is PurchaseDraftStatus {
  return (PURCHASE_DRAFT_STATUSES as readonly string[]).includes(value);
}

/**
 * One line on a Purchase Draft, derived from a procurement recommendation item.
 * Pricing is intentionally omitted — Purchases owns cost entry.
 */
export interface PurchaseDraftLine {
  ingredientId: EntityId;
  ingredientName: string;
  recommendedPurchaseQuantity: Quantity;
  unit: Unit;
  packageSize?: Quantity;
  packagesToBuy: number;
  recommendationReason: ProcurementRecommendationReason;
}

/**
 * A Purchase Draft prepared for the Purchases module.
 * Pure value object — never persisted by this builder.
 */
export interface PurchaseDraft {
  draftId: EntityId;
  supplierId?: EntityId;
  supplierName?: string;
  plannedDeliveryDate?: CalendarDate;
  notes: string;
  status: PurchaseDraftStatus;
  lines: readonly PurchaseDraftLine[];
}

/**
 * Aggregate counters for a Purchase Draft collection.
 */
export interface PurchaseDraftCollectionSummary {
  totalDrafts: number;
  totalLines: number;
  totalPurchaseQuantity: Quantity;
  /** Future: estimated purchase cost across all drafts. */
  estimatedCost?: Money;
  /** Future: distinct suppliers represented in the collection. */
  supplierCount?: number;
}

/**
 * Collection of Purchase Drafts produced from a Procurement Recommendation.
 * A collection is required because drafts may be split per supplier.
 */
export interface PurchaseDraftCollection {
  drafts: readonly PurchaseDraft[];
  summary: PurchaseDraftCollectionSummary;
}
