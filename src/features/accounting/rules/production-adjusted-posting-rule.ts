/**
 * Production Adjusted posting rule (DEV-094).
 *
 * Owned by Accounting. Configurable scaffold for future production adjustments.
 * Variance P&L accounting is NOT implemented yet — this rule only supports
 * cost capitalization adjustments (same account roles as completion).
 *
 * Business Event: production_adjusted
 * Proposed entry (v1, no variance):
 *   Dr Finished Goods Inventory
 *   Cr Raw Material Inventory
 */

import type { PostingRule } from "@/types/accounting";

export const PRODUCTION_ADJUSTED_POSTING_RULE_ID =
  "posting-rule-production-adjusted-v1";

/**
 * Default (non-variance) adjustment rule for production cost corrections.
 * Replace / extend via Posting Rules configuration when variance lands.
 */
export function createProductionAdjustedPostingRule(
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
  },
): PostingRule {
  const id = overrides?.id ?? PRODUCTION_ADJUSTED_POSTING_RULE_ID;

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
      description: "Finished Goods Inventory (adjustment)",
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
      description: "Raw Material Inventory (adjustment)",
    },
  ];

  const lines = (overrides?.lines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "production_adjusted",
    version: 1,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description:
      "Production adjusted: Dr finished_goods_inventory / Cr inventory_asset (no variance yet)",
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}
