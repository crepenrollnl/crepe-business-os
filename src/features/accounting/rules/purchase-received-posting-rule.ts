/**
 * Configurable Purchase Received posting rule (DEV-090 / DEV-092 / DEV-100).
 *
 * Owned by Accounting. Operational Purchases must not resolve rules —
 * it only emits purchase_received events with TaxResult money facts.
 *
 * Version 3 (audit finding #3, 2026-09): suppliers are always paid
 * immediately at receive time (cash/card/transfer) — this business never
 * buys on credit. Credits Cash/Bank directly instead of Accounts Payable;
 * there is no accounts-payable settlement flow anywhere in this system.
 *
 * Business Event: purchase_received (Purchase Confirmed / received)
 * Proposed entry:
 *   Dr Inventory (inventory_asset)   ← net_amount
 *   Dr Recoverable VAT (vat_input)   ← tax_amount (skipped when 0)
 *   Cr Cash / Bank (cash)            ← gross_amount
 */

import type { PostingRule } from "@/types/accounting";

export const PURCHASE_RECEIVED_POSTING_RULE_ID =
  "posting-rule-purchase-received-v1";

/**
 * Default posting rule for confirmed / received purchases.
 */
export function createPurchaseReceivedPostingRule(
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
  },
): PostingRule {
  const id = overrides?.id ?? PURCHASE_RECEIVED_POSTING_RULE_ID;

  const defaultLines: PostingRule["lines"] = [
    {
      id: `${id}-debit-inventory`,
      posting_rule_id: id,
      line_no: 1,
      account_role: "inventory_asset",
      side: "debit",
      amount_field: "net_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Inventory",
    },
    {
      id: `${id}-debit-recoverable-tax`,
      posting_rule_id: id,
      line_no: 2,
      account_role: "vat_input",
      side: "debit",
      amount_field: "tax_amount",
      currency_source: "event_transaction",
      tax_behaviour: "pass_through",
      tax_code: null,
      description: "Recoverable tax",
    },
    {
      id: `${id}-credit-cash`,
      posting_rule_id: id,
      line_no: 3,
      account_role: "cash",
      side: "credit",
      amount_field: "gross_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Cash / Bank",
    },
  ];

  const lines = (overrides?.lines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "purchase_received",
    version: 3,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description:
      "Purchase confirmed: Dr Inventory / Dr Recoverable tax / Cr Cash / Bank",
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}
