/**
 * Posting Rules framework contracts (DEV-089).
 *
 * Business-agnostic rule model, validation, and resolution.
 * See docs/ACCOUNTING.md §9.
 */

export type {
  PostingAmountSource,
  PostingCurrencySource,
  PostingRule,
  PostingRuleLine,
  PostingTaxBehaviour,
} from "@/types/accounting";

export type PostingRuleErrorCode =
  | "INVALID_RULE"
  | "INVALID_RULE_LINE"
  | "INVALID_ACCOUNT_ROLE"
  | "INVALID_AMOUNT_SOURCE"
  | "INVALID_CURRENCY_SOURCE"
  | "INVALID_TAX_BEHAVIOUR"
  | "INVALID_EFFECTIVE_DATES"
  | "DUPLICATE_RULE"
  | "OVERLAPPING_RULE"
  | "MISSING_ACCOUNT_BINDING"
  | "MISSING_DEBIT_ROLE"
  | "MISSING_CREDIT_ROLE"
  | "RULE_NOT_FOUND";

export interface PostingRuleError {
  code: PostingRuleErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type PostingRuleValidationResult =
  | { ok: true }
  | { ok: false; errors: PostingRuleError[] };

export type PostingRuleResolveResult =
  | { ok: true; rule: import("@/types/accounting").PostingRule }
  | { ok: false; error: PostingRuleError };
