/**
 * COGS Recognized posting rule (DEV-093 / DEV-109).
 *
 * Owned by Accounting. Companion to sale_completed for Sales completion.
 *
 * Business Event: cogs_recognized
 * Proposed entry (frozen COGS from Finished Goods consumptions):
 *   Dr Cost of Goods Sold
 *   Cr Finished Goods Inventory
 */

import type { PostingRule } from "@/types/accounting";

export const COGS_RECOGNIZED_POSTING_RULE_ID =
  "posting-rule-cogs-recognized-v1";

/**
 * Default COGS posting rule for completed sales.
 */
export function createCogsRecognizedPostingRule(
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
  },
): PostingRule {
  const id = overrides?.id ?? COGS_RECOGNIZED_POSTING_RULE_ID;

  const defaultLines: PostingRule["lines"] = [
    {
      id: `${id}-debit-cogs`,
      posting_rule_id: id,
      line_no: 1,
      account_role: "cogs",
      side: "debit",
      amount_field: "cogs_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Cost of Goods Sold",
    },
    {
      id: `${id}-credit-finished-goods`,
      posting_rule_id: id,
      line_no: 2,
      account_role: "finished_goods_inventory",
      side: "credit",
      amount_field: "cogs_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Finished Goods Inventory",
    },
  ];

  const lines = (overrides?.lines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "cogs_recognized",
    version: 2,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description:
      "COGS recognized: Dr cogs / Cr finished_goods_inventory",
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}
