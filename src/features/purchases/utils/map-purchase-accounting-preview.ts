/**
 * Map stored purchase totals → Accounting Preview view-model.
 *
 * Display mapping only — does not call Tax or Accounting services. Since
 * sql/150 the database posts the purchase journal from these same stored
 * totals (Dr Inventory = subtotal, Dr Recoverable tax = tax_total,
 * Cr Cash / Bank = subtotal + tax_total).
 */

import type { PurchaseWithRelations } from "../types/purchase";
import type {
  PurchaseAccountingPreviewData,
  PurchasePostingStatus,
} from "../types/purchase-accounting-preview";

/**
 * Totals-only preview when a Journal Proposal is not available in session.
 * `postingStatus` "posted" (journal found by its stable business_event_id)
 * marks the preview Posted; anything else keeps it a Draft Proposal.
 */
export function mapPurchaseTotalsToAccountingPreview(
  purchase: Pick<
    PurchaseWithRelations,
    "subtotal" | "tax_total" | "total" | "currency"
  >,
  postingStatus?: PurchasePostingStatus,
): PurchaseAccountingPreviewData {
  return {
    net_amount: purchase.subtotal,
    tax_total: purchase.tax_total,
    grand_total: purchase.total,
    currency: purchase.currency,
    status: postingStatus === "posted" ? "posted" : "draft_proposal",
    has_proposal: false,
    lines: [],
  };
}
