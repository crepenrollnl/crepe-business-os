/**
 * Re-export Accounting-owned Production posting rules (DEV-094).
 *
 * Rule resolution lives in Accounting. Production must not own posting rules.
 */

export {
  PRODUCTION_COMPLETED_POSTING_RULE_ID,
  createProductionCompletedPostingRule,
} from "@/features/accounting/rules/production-completed-posting-rule";

export {
  PRODUCTION_ADJUSTED_POSTING_RULE_ID,
  createProductionAdjustedPostingRule,
} from "@/features/accounting/rules/production-adjusted-posting-rule";
