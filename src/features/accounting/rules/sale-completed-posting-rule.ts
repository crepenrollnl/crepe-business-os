/**
 * Sale Completed revenue posting rule (DEV-093).
 *
 * Owned by Accounting. Sales must not resolve rules — it only emits events.
 *
 * Business Event: sale_completed
 * Proposed entry:
 *   Dr Cash | Accounts Receivable
 *   Cr Sales Revenue
 */

import type { PostingAccountRole, PostingRule } from "@/types/accounting";

export const SALE_COMPLETED_REVENUE_POSTING_RULE_ID =
  "posting-rule-sale-completed-revenue-v1";

export type SaleRevenueDebitRole = Extract<
  PostingAccountRole,
  "cash" | "accounts_receivable"
>;

/**
 * Default revenue posting rule for completed sales.
 */
export function createSaleCompletedRevenuePostingRule(
  overrides?: Partial<Omit<PostingRule, "lines">> & {
    lines?: PostingRule["lines"];
    debitRole?: SaleRevenueDebitRole;
  },
): PostingRule {
  const id = overrides?.id ?? SALE_COMPLETED_REVENUE_POSTING_RULE_ID;
  const debitRole: SaleRevenueDebitRole =
    overrides?.debitRole ?? "accounts_receivable";

  const defaultLines: PostingRule["lines"] = [
    {
      id: `${id}-debit-settlement`,
      posting_rule_id: id,
      line_no: 1,
      account_role: debitRole,
      side: "debit",
      amount_field: "net_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description:
        debitRole === "cash" ? "Cash" : "Accounts Receivable",
    },
    {
      id: `${id}-credit-revenue`,
      posting_rule_id: id,
      line_no: 2,
      account_role: "revenue",
      side: "credit",
      amount_field: "net_amount",
      currency_source: "event_transaction",
      tax_behaviour: "none",
      tax_code: null,
      description: "Sales Revenue",
    },
  ];

  const { debitRole: _debitRole, lines: overrideLines, ...rest } =
    overrides ?? {};
  void _debitRole;

  const lines = (overrideLines ?? defaultLines).map((row) => ({
    ...row,
    posting_rule_id: id,
  }));

  return {
    id,
    event_type: "sale_completed",
    version: 1,
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    description: `Sale completed: Dr ${debitRole} / Cr revenue`,
    created_at: "2020-01-01T00:00:00.000Z",
    ...rest,
    lines,
  };
}
