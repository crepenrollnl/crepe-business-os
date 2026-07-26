/**
 * Posting Engine and Posting Rules contracts (DEV-088).
 * See docs/ACCOUNTING.md §8–§9.
 */

export type {
  AccountRoleBinding,
  PostingAccountRole,
  PostingAmountField,
  PostingRule,
  PostingRuleLine,
} from "@/types/accounting";

export type {
  PostingContext,
  PostingError,
  PostingErrorCode,
  PostingPipelineResult,
  PostingResult,
} from "./posting-engine";
