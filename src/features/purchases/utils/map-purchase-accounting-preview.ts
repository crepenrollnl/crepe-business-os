/**
 * Map existing purchase / journal proposal data → Accounting Preview view-model.
 *
 * Display mapping only — does not call Tax or Accounting services.
 */

import type { PurchaseWithRelations } from "../types/purchase";
import type { PurchaseJournalProposal } from "../types/purchase-accounting";
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";
import { createPurchaseReceivedPostingRule } from "../services/purchase-received-posting-rule";

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

/**
 * Map a returned (in-memory) Journal Proposal for display.
 * Account roles are labeled from the matched posting rule line numbers.
 */
export function mapPurchaseJournalProposalToPreview(
  proposal: PurchaseJournalProposal,
): PurchaseAccountingPreviewData {
  const rule = createPurchaseReceivedPostingRule();
  const roleByLineNo = new Map(
    rule.lines.map((line) => [line.line_no, line.account_role]),
  );
  const currency = proposal.journalProposal.journal_entry.transaction_currency;

  return {
    net_amount: proposal.tax.subtotal,
    tax_total: proposal.tax.tax_total,
    grand_total: proposal.tax.grand_total,
    currency,
    status: "draft_proposal",
    has_proposal: true,
    lines: proposal.journalProposal.journal_lines.map((line) => ({
      account_role:
        roleByLineNo.get(line.line_no) ?? line.description ?? "unknown",
      debit: line.debit_transaction,
      credit: line.credit_transaction,
      currency,
    })),
  };
}
