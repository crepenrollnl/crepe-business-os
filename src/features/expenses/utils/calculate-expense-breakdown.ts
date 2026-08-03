import { roundMoney } from "@/lib/money";
import type { ExpenseAmountBreakdown } from "../types/expense";

/**
 * Derive net/VAT from a gross amount + VAT rate (e.g. 0.21 for 21%).
 * net = gross / (1 + rate), vat = gross - net — rounded once, up front, so
 * net + vat always equals gross exactly (matches record_expense's own
 * rounding, sql/083).
 */
export function calculateExpenseBreakdown(
  grossAmount: number,
  vatRate: number,
): ExpenseAmountBreakdown {
  const gross = roundMoney(grossAmount);
  const net = roundMoney(gross / (1 + vatRate));
  const vat = roundMoney(gross - net);

  return { netAmount: net, vatAmount: vat, grossAmount: gross };
}
