/**
 * Map stored purchase totals → Accounting Preview view-model.
 *
 * Display mapping only — does not call Tax or Accounting services. Since
 * sql/150 the database posts the purchase journal from these same stored
 * totals (Dr Inventory = subtotal, Dr Recoverable tax = tax_total,
 * Cr Cash / Bank = subtotal + tax_total).
 */

import type { PurchaseWithRelations } from "../types/purchase";
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";

/**
 * Totals-only preview when a Journal Proposal is not available in session.
 */
export function mapPurchaseTotalsToAccountingPreview(
  purchase: Pick<
    PurchaseWithRelations,
    "subtotal" | "tax_total" | "total" | "currency"
  >,
): PurchaseAccountingPreviewData {
  return {
    net_amount: purchase.subtotal,
    tax_total: purchase.tax_total,
    grand_total: purchase.total,
    currency: purchase.currency,
    status: "draft_proposal",
    has_proposal: false,
    lines: [],
  };
}
