/**
 * Generic Posting Rules framework (DEV-089).
 *
 * Configurable rule model + validation + resolution.
 * No Purchases / Sales / Production / Inventory business rules.
 */

import {
  POSTING_ACCOUNT_ROLES,
  POSTING_AMOUNT_SOURCES,
  POSTING_CURRENCY_SOURCES,
  POSTING_TAX_BEHAVIOURS,
  type AccountRoleBinding,
  type AccountingBusinessEvent,
  type AccountingBusinessEventType,
  type PostingAccountRole,
  type PostingAmountSource,
  type PostingCurrencySource,
  type PostingRule,
  type PostingRuleLine,
  type PostingTaxBehaviour,
} from "@/types/accounting";
import type {
  PostingRuleError,
  PostingRuleResolveResult,
  PostingRuleValidationResult,
} from "../types/posting-rules";

function ruleError(
  code: PostingRuleError["code"],
  message: string,
  details?: PostingRuleError["details"],
): PostingRuleError {
  return details === undefined ? { code, message } : { code, message, details };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isPostingAccountRole(
  value: unknown,
): value is PostingAccountRole {
  return (
    typeof value === "string" &&
    (POSTING_ACCOUNT_ROLES as readonly string[]).includes(value)
  );
}

export function isPostingAmountSource(
  value: unknown,
): value is PostingAmountSource {
  return (
    typeof value === "string" &&
    (POSTING_AMOUNT_SOURCES as readonly string[]).includes(value)
  );
}

export function isPostingCurrencySource(
  value: unknown,
): value is PostingCurrencySource {
  return (
    typeof value === "string" &&
    (POSTING_CURRENCY_SOURCES as readonly string[]).includes(value)
  );
}

export function isPostingTaxBehaviour(
  value: unknown,
): value is PostingTaxBehaviour {
  return (
    typeof value === "string" &&
    (POSTING_TAX_BEHAVIOURS as readonly string[]).includes(value)
  );
}

function effectiveRangesOverlap(
  fromA: string,
  toA: string | null,
  fromB: string,
  toB: string | null,
): boolean {
  const endA = toA ?? "9999-12-31";
  const endB = toB ?? "9999-12-31";
  return fromA <= endB && fromB <= endA;
}

export function isRuleEffectiveOnDate(
  rule: PostingRule,
  eventDate: string,
): boolean {
  if (rule.effective_from > eventDate) {
    return false;
  }
  if (rule.effective_to !== null && rule.effective_to < eventDate) {
    return false;
  }
  return true;
}

export function validatePostingRuleLine(
  line: PostingRuleLine,
  ruleId: string,
): PostingRuleError[] {
  const errors: PostingRuleError[] = [];

  if (!isNonEmptyString(line.id)) {
    errors.push(
      ruleError("INVALID_RULE_LINE", "Posting rule line id is required.", {
        posting_rule_id: ruleId,
      }),
    );
  }

  if (line.posting_rule_id !== ruleId) {
    errors.push(
      ruleError(
        "INVALID_RULE_LINE",
        "Posting rule line posting_rule_id must match parent rule id.",
        {
          posting_rule_id: ruleId,
          line_posting_rule_id: line.posting_rule_id,
        },
      ),
    );
  }

  if (!isFiniteNumber(line.line_no) || line.line_no <= 0) {
    errors.push(
      ruleError(
        "INVALID_RULE_LINE",
        "Posting rule line_no must be a positive number.",
        { posting_rule_id: ruleId, line_no: line.line_no },
      ),
    );
  }

  if (!isPostingAccountRole(line.account_role)) {
    errors.push(
      ruleError(
        "INVALID_ACCOUNT_ROLE",
        `Posting rule line has invalid account role '${String(line.account_role)}'.`,
        {
          posting_rule_id: ruleId,
          account_role: String(line.account_role),
        },
      ),
    );
  }

  if (line.side !== "debit" && line.side !== "credit") {
    errors.push(
      ruleError(
        "INVALID_RULE_LINE",
        "Posting rule line side must be debit or credit.",
        { posting_rule_id: ruleId, side: String(line.side) },
      ),
    );
  }

  if (!isPostingAmountSource(line.amount_field)) {
    errors.push(
      ruleError(
        "INVALID_AMOUNT_SOURCE",
        `Posting rule line has invalid amount source '${String(line.amount_field)}'.`,
        {
          posting_rule_id: ruleId,
          amount_source: String(line.amount_field),
        },
      ),
    );
  }

  if (!isPostingCurrencySource(line.currency_source)) {
    errors.push(
      ruleError(
        "INVALID_CURRENCY_SOURCE",
        `Posting rule line has invalid currency source '${String(line.currency_source)}'.`,
        {
          posting_rule_id: ruleId,
          currency_source: String(line.currency_source),
        },
      ),
    );
  }

  if (!isPostingTaxBehaviour(line.tax_behaviour)) {
    errors.push(
      ruleError(
        "INVALID_TAX_BEHAVIOUR",
        `Posting rule line has invalid tax behaviour '${String(line.tax_behaviour)}'.`,
        {
          posting_rule_id: ruleId,
          tax_behaviour: String(line.tax_behaviour),
        },
      ),
    );
  }

  return errors;
}

/**
 * Validate one posting rule definition (structure, roles, dates, debit/credit).
 */
export function validatePostingRule(
  rule: PostingRule,
): PostingRuleValidationResult {
  const errors: PostingRuleError[] = [];

  if (!isNonEmptyString(rule.id)) {
    errors.push(ruleError("INVALID_RULE", "Posting rule id is required."));
  }

  if (!isNonEmptyString(rule.event_type)) {
    errors.push(
      ruleError("INVALID_RULE", "Posting rule event_type is required.", {
        posting_rule_id: rule.id,
      }),
    );
  }

  if (!isFiniteNumber(rule.version) || rule.version <= 0) {
    errors.push(
      ruleError(
        "INVALID_RULE",
        "Posting rule version must be a positive number.",
        { posting_rule_id: rule.id, version: rule.version },
      ),
    );
  }

  if (!isFiniteNumber(rule.priority)) {
    errors.push(
      ruleError(
        "INVALID_RULE",
        "Posting rule priority must be a finite number.",
        { posting_rule_id: rule.id, priority: rule.priority },
      ),
    );
  }

  if (!isNonEmptyString(rule.effective_from) || !isIsoDateOnly(rule.effective_from)) {
    errors.push(
      ruleError(
        "INVALID_EFFECTIVE_DATES",
        "Posting rule effective_from must be an ISO date (YYYY-MM-DD).",
        { posting_rule_id: rule.id, effective_from: rule.effective_from },
      ),
    );
  }

  if (
    rule.effective_to !== null &&
    (!isNonEmptyString(rule.effective_to) || !isIsoDateOnly(rule.effective_to))
  ) {
    errors.push(
      ruleError(
        "INVALID_EFFECTIVE_DATES",
        "Posting rule effective_to must be null or an ISO date (YYYY-MM-DD).",
        { posting_rule_id: rule.id, effective_to: rule.effective_to },
      ),
    );
  }

  if (
    rule.effective_to !== null &&
    isIsoDateOnly(rule.effective_from) &&
    isIsoDateOnly(rule.effective_to) &&
    rule.effective_from > rule.effective_to
  ) {
    errors.push(
      ruleError(
        "INVALID_EFFECTIVE_DATES",
        "Posting rule effective_from must be on or before effective_to.",
        {
          posting_rule_id: rule.id,
          effective_from: rule.effective_from,
          effective_to: rule.effective_to,
        },
      ),
    );
  }

  if (typeof rule.is_active !== "boolean") {
    errors.push(
      ruleError("INVALID_RULE", "Posting rule is_active must be a boolean.", {
        posting_rule_id: rule.id,
      }),
    );
  }

  if (!Array.isArray(rule.lines) || rule.lines.length === 0) {
    errors.push(
      ruleError(
        "INVALID_RULE",
        "Posting rule must include at least one line.",
        { posting_rule_id: rule.id },
      ),
    );
    return { ok: false, errors };
  }

  const lineNos = new Set<number>();
  let hasDebit = false;
  let hasCredit = false;

  for (const line of rule.lines) {
    errors.push(...validatePostingRuleLine(line, rule.id));

    if (lineNos.has(line.line_no)) {
      errors.push(
        ruleError(
          "INVALID_RULE_LINE",
          "Posting rule line_no values must be unique within a rule.",
          { posting_rule_id: rule.id, line_no: line.line_no },
        ),
      );
    }
    lineNos.add(line.line_no);

    if (line.side === "debit") {
      hasDebit = true;
    }
    if (line.side === "credit") {
      hasCredit = true;
    }
  }

  if (!hasDebit) {
    errors.push(
      ruleError(
        "MISSING_DEBIT_ROLE",
        "Posting rule must include at least one debit account role line.",
        { posting_rule_id: rule.id },
      ),
    );
  }

  if (!hasCredit) {
    errors.push(
      ruleError(
        "MISSING_CREDIT_ROLE",
        "Posting rule must include at least one credit account role line.",
        { posting_rule_id: rule.id },
      ),
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Validate a rule set for duplicates and overlapping active coverage.
 */
export function validatePostingRuleSet(
  rules: readonly PostingRule[],
): PostingRuleValidationResult {
  const errors: PostingRuleError[] = [];

  for (const rule of rules) {
    const single = validatePostingRule(rule);
    if (!single.ok) {
      errors.push(...single.errors);
    }
  }

  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const left = rules[i];
      const right = rules[j];

      if (left.event_type !== right.event_type) {
        continue;
      }

      const overlaps = effectiveRangesOverlap(
        left.effective_from,
        left.effective_to,
        right.effective_from,
        right.effective_to,
      );
      if (!overlaps) {
        continue;
      }

      if (left.version === right.version) {
        errors.push(
          ruleError(
            "DUPLICATE_RULE",
            "Duplicate posting rule version for the same event type and overlapping dates.",
            {
              event_type: left.event_type,
              version: left.version,
              left_rule_id: left.id,
              right_rule_id: right.id,
            },
          ),
        );
      }

      if (
        left.is_active &&
        right.is_active &&
        left.priority === right.priority
      ) {
        errors.push(
          ruleError(
            "OVERLAPPING_RULE",
            "Active posting rules overlap with the same priority for one event type.",
            {
              event_type: left.event_type,
              priority: left.priority,
              left_rule_id: left.id,
              right_rule_id: right.id,
            },
          ),
        );
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Ensure every account role used by the rule has an active binding on the date.
 */
export function validateRuleAccountBindings(
  rule: PostingRule,
  bindings: readonly AccountRoleBinding[],
  asOfDate: string,
): PostingRuleValidationResult {
  const errors: PostingRuleError[] = [];
  const eventDate = toDateOnly(asOfDate);
  const roles = new Set(rule.lines.map((line) => line.account_role));

  for (const role of roles) {
    const matched = bindings.some((binding) => {
      if (!binding.is_active || binding.role !== role) {
        return false;
      }
      if (binding.effective_from > eventDate) {
        return false;
      }
      if (binding.effective_to !== null && binding.effective_to < eventDate) {
        return false;
      }
      return isNonEmptyString(binding.account_id);
    });

    if (!matched) {
      errors.push(
        ruleError(
          "MISSING_ACCOUNT_BINDING",
          `No active account binding for role '${role}'.`,
          { role, event_date: eventDate, posting_rule_id: rule.id },
        ),
      );
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Resolve the posting rule for a business event:
 * Business Event → Active Rules → Effective Date → Highest Priority → Rule
 *
 * Version is the tie-breaker when priorities are equal (should be prevented by
 * validatePostingRuleSet for active overlaps).
 */
export function resolvePostingRule(
  event: Pick<AccountingBusinessEvent, "event_type" | "occurred_at">,
  rules: readonly PostingRule[],
): PostingRuleResolveResult {
  const eventDate = toDateOnly(event.occurred_at);

  const matches = rules.filter((rule) => {
    if (!rule.is_active) {
      return false;
    }
    if (rule.event_type !== event.event_type) {
      return false;
    }
    if (!isRuleEffectiveOnDate(rule, eventDate)) {
      return false;
    }
    return Array.isArray(rule.lines) && rule.lines.length > 0;
  });

  if (matches.length === 0) {
    return {
      ok: false,
      error: ruleError(
        "RULE_NOT_FOUND",
        "No active posting rule matches the business event.",
        {
          event_type: event.event_type,
          event_date: eventDate,
        },
      ),
    };
  }

  matches.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    if (b.version !== a.version) {
      return b.version - a.version;
    }
    return b.effective_from.localeCompare(a.effective_from);
  });

  return { ok: true, rule: matches[0] };
}

export function listActiveRulesForEventType(
  eventType: AccountingBusinessEventType,
  rules: readonly PostingRule[],
  asOfDate: string,
): PostingRule[] {
  const eventDate = toDateOnly(asOfDate);
  return rules.filter(
    (rule) =>
      rule.is_active &&
      rule.event_type === eventType &&
      isRuleEffectiveOnDate(rule, eventDate),
  );
}
