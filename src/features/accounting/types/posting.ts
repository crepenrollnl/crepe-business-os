/**
 * Posting Engine and Posting Rules contracts (DEV-088 / DEV-089).
 * See docs/ACCOUNTING.md §8–§9.
 */

export type {
  AccountRoleBinding,
  PostingAccountRole,
  PostingAmountField,
  PostingAmountSource,
  PostingCurrencySource,
  PostingRule,
  PostingRuleLine,
  PostingTaxBehaviour,
} from "@/types/accounting";

export type {
  PostingContext,
  PostingError,
  PostingErrorCode,
  PostingPipelineResult,
  PostingResult,
} from "./posting-engine";

export type {
  PostingRuleError,
  PostingRuleErrorCode,
  PostingRuleResolveResult,
  PostingRuleValidationResult,
} from "./posting-rules";
