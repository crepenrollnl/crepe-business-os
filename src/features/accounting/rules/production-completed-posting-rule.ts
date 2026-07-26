/**
 * Production Completed posting rule (DEV-094).
 *
 * Owned by Accounting. Production must not resolve rules — it only emits events.
 *
 * Business Event: production_completed
 * Proposed entry:
 *   Dr Finished Goods Inventory
 *   Cr Raw Material Inventory (inventory_asset)
 *
 * Variance accounting is intentionally out of scope — keep rules configurable.
 */

import type { PostingRule } from "@/types/accounting";

export const PRODUCTION_COMPLETED_POSTING_RULE_ID =
  "posting-rule-production-completed-v1";

/**
 * Default capitalization rule for completed production sessions.
 */
export function createProductionCompletedPostingRule(
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
  },
): PostingRule {
  const id = overrides?.id ?? PRODUCTION_COMPLETED_POSTING_RULE_ID;

  const defaultLines: PostingRule["lines"] = [
    {
      id: `${id}-debit-finished-goods`,
      posting_rule_id: id,
      line_no: 1,
      account_role: "finished_goods_inventory",
      side: "debit",
      amount_field: "other_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Finished Goods Inventory",
    },
    {
      id: `${id}-credit-raw-materials`,
      posting_rule_id: id,
      line_no: 2,
      account_role: "inventory_asset",
      side: "credit",
      amount_field: "other_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Raw Material Inventory",
    },
  ];

  const lines = (overrides?.lines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "production_completed",
    version: 1,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description:
      "Production completed: Dr finished_goods_inventory / Cr inventory_asset",
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}
