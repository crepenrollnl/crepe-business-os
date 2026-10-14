/**
 * Journal lines of a posted purchase, rebuilt from the stored totals.
 *
 * Display mapping only. Since sql/150 the database posts the purchase journal
 * from these same totals: Dr Inventory = net, Dr Recoverable tax = tax
 * (no line when 0), Cr Cash / Bank = net + tax.
 */

import { roundMoney } from "@/lib/money";
import type {
  PurchaseAccountingPreviewData,
  PurchaseAccountingPreviewLine,
} from "../types/purchase-accounting-preview";

export function postedPurchaseJournalLines(
  preview: Pick<PurchaseAccountingPreviewData, "net_amount" | "tax_total" | "currency">,
): PurchaseAccountingPreviewLine[] {
  const net = roundMoney(preview.net_amount);
  const tax = roundMoney(preview.tax_total);
  const lines: PurchaseAccountingPreviewLine[] = [
    { account_role: "Inventory", debit: net, credit: 0, currency: preview.currency },
  ];

  if (tax !== 0) {
    lines.push({
      account_role: "Recoverable tax",
      debit: tax,
      credit: 0,
      currency: preview.currency,
    });
  }

  lines.push({
    account_role: "Cash / Bank",
    debit: 0,
    credit: roundMoney(net + tax),
    currency: preview.currency,
  });

  return lines;
}
