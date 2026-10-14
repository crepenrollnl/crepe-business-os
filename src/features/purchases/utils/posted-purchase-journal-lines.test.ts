/**
 * Posted purchase journal lines rebuilt from stored totals — the same lines
 * the database posts (sql/150).
 */

import { describe, expect, it } from "vitest";
import { postedPurchaseJournalLines } from "./posted-purchase-journal-lines";

describe("postedPurchaseJournalLines (sql/150)", () => {
  it("returns Dr Inventory, Dr Recoverable tax, Cr Cash / Bank", () => {
    expect(
      postedPurchaseJournalLines({ net_amount: 38.47, tax_total: 3.46, currency: "EUR" }),
    ).toEqual([
      { account_role: "Inventory", debit: 38.47, credit: 0, currency: "EUR" },
      { account_role: "Recoverable tax", debit: 3.46, credit: 0, currency: "EUR" },
      { account_role: "Cash / Bank", debit: 0, credit: 41.93, currency: "EUR" },
    ]);
  });

  it("omits the Recoverable tax line when tax is 0", () => {
    expect(
      postedPurchaseJournalLines({ net_amount: 50, tax_total: 0, currency: "EUR" }),
    ).toEqual([
      { account_role: "Inventory", debit: 50, credit: 0, currency: "EUR" },
      { account_role: "Cash / Bank", debit: 0, credit: 50, currency: "EUR" },
    ]);
  });

  it("balances: debits equal the credit", () => {
    const lines = postedPurchaseJournalLines({
      net_amount: 0.1,
      tax_total: 0.2,
      currency: "EUR",
    });
    const debit = lines.reduce((sum, line) => sum + line.debit, 0);
    const credit = lines.reduce((sum, line) => sum + line.credit, 0);

    expect(credit).toBe(0.3);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
  });
});
