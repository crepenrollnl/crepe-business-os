/**
 * Posting Rules framework service (DEV-089).
 *
 * Business-agnostic validation and resolution helpers for Posting Rules.
 * No SQL persistence. No operational-module rules.
 */

import type {
  AccountRoleBinding,
  AccountingBusinessEvent,
  PostingRule,
} from "@/types/accounting";
import type {
  PostingRuleResolveResult,
  PostingRuleValidationResult,
} from "../types/posting-rules";
import {
  listActiveRulesForEventType,
  resolvePostingRule,
  validatePostingRule,
  validatePostingRuleSet,
  validateRuleAccountBindings,
} from "../utils/posting-rules";

export const postingRulesService = {
  validateRule(rule: PostingRule): PostingRuleValidationResult {
    return validatePostingRule(rule);
  },

  validateRuleSet(rules: readonly PostingRule[]): PostingRuleValidationResult {
    return validatePostingRuleSet(rules);
  },

  validateAccountBindings(
    rule: PostingRule,
    bindings: readonly AccountRoleBinding[],
    asOfDate: string,
  ): PostingRuleValidationResult {
    return validateRuleAccountBindings(rule, bindings, asOfDate);
  },

  resolveForEvent(
    event: Pick<AccountingBusinessEvent, "event_type" | "occurred_at">,
    rules: readonly PostingRule[],
  ): PostingRuleResolveResult {
    return resolvePostingRule(event, rules);
  },

  listActiveForEventType: listActiveRulesForEventType,
};
