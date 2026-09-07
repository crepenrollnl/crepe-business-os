/**
 * Write-off posting rule.
 *
 * Business Event: waste_recognized
 * Proposed entry:
 *   Dr Waste & Spoilage (waste_expense)
 *   Cr Inventory — Ingredients (inventory_asset)
 *     or Inventory — Finished Goods (finished_goods_inventory)
 */

import type { PostingAccountRole, PostingRule } from "@/types/accounting";

export type WriteOffPostingItemType = "ingredient" | "finished_good";

export const WRITE_OFF_POSTING_RULE_ID = "posting-rule-write-off-v1";

export function createWriteOffPostingRule(
  itemType: WriteOffPostingItemType,
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
  },
): PostingRule {
  const id = overrides?.id ?? `${WRITE_OFF_POSTING_RULE_ID}-${itemType}`;
  const creditRole: PostingAccountRole =
    itemType === "finished_good"
      ? "finished_goods_inventory"
      : "inventory_asset";
  const creditDescription =
    itemType === "finished_good"
      ? "Finished Goods Inventory"
      : "Raw Material Inventory";

  const defaultLines: PostingRule["lines"] = [
    {
      id: `${id}-debit-waste`,
      posting_rule_id: id,
      line_no: 1,
      account_role: "waste_expense",
      side: "debit",
      amount_field: "other_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Waste & Spoilage",
    },
    {
      id: `${id}-credit-inventory`,
      posting_rule_id: id,
      line_no: 2,
      account_role: creditRole,
      side: "credit",
      amount_field: "other_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: creditDescription,
    },
  ];

  const lines = (overrides?.lines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "waste_recognized",
    version: 1,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description: `Write-off: Dr waste_expense / Cr ${creditRole}`,
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
    lines,
  };
}
