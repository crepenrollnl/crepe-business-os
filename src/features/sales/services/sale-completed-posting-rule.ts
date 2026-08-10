/**
 * Re-export Accounting-owned Sale Completed posting rules (DEV-093).
 *
 * Rule resolution lives in Accounting. Sales must not own posting rules.
 */

export {
  SALE_COMPLETED_REVENUE_POSTING_RULE_ID,
  createSaleCompletedRevenuePostingRule,
  type SaleRevenueDebitRole,
} from "@/features/accounting/rules/sale-completed-posting-rule";

export {
  COGS_RECOGNIZED_POSTING_RULE_ID,
  createCogsRecognizedPostingRule,
} from "@/features/accounting/rules/cogs-recognized-posting-rule";
