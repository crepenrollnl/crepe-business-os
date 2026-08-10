/**
 * Purchase Accounting Preview view-model (DEV-101).
 *
 * Display-only. Built from an existing PurchaseJournalProposal or
 * persisted purchase totals — never from Tax/Accounting recalculation in UI.
 */

export type PurchaseAccountingPreviewStatus = "draft_proposal";

export interface PurchaseAccountingPreviewLine {
  account_role: string;
  debit: number;
  credit: number;
  currency: string;
}

export interface PurchaseAccountingPreviewData {
  net_amount: number;
  tax_total: number;
  grand_total: number;
  currency: string;
  status: PurchaseAccountingPreviewStatus;
  /** True when journal lines come from an existing Journal Proposal. */
  has_proposal: boolean;
  lines: readonly PurchaseAccountingPreviewLine[];
}
