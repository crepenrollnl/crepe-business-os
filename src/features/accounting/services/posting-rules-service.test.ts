/**
 * Posting Rules framework coverage (DEV-089).
 *
 * Business-agnostic validation and resolution — no operational module rules.
 */

import { describe, expect, it } from "vitest";
import type {
  AccountRoleBinding,
  PostingRule,
  PostingRuleLine,
} from "@/types/accounting";
import { postingRulesService } from "./posting-rules-service";

function line(
  overrides: Partial<PostingRuleLine> &
    Pick<PostingRuleLine, "id" | "line_no" | "side" | "account_role">,
): PostingRuleLine {
  return {
    posting_rule_id: "rule-1",
    amount_field: "net_amount",
    currency_source: "event_transaction",
    tax_behaviour: "none",
    tax_code: null,
    description: null,
    ...overrides,
  };
}

function rule(overrides?: Partial<PostingRule>): PostingRule {
  const id = overrides?.id ?? "rule-1";
  const baseLines =
    overrides?.lines ??
    ([
      line({
        id: "l1",
        posting_rule_id: id,
        line_no: 1,
        side: "debit",
        account_role: "other",
        amount_field: "net_amount",
      }),
      line({
        id: "l2",
        posting_rule_id: id,
        line_no: 2,
        side: "credit",
        account_role: "bank",
        amount_field: "other_amount",
      }),
    ] satisfies PostingRuleLine[]);

  return {
    id,
    event_type: "expense_recognized",
    version: 1,
    priority: 100,
    effective_from: "2026-01-01",
    effective_to: null,
    is_active: true,
    description: "Generic fixture rule",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
    lines: baseLines.map((row) => ({
      ...row,
      posting_rule_id: id,
    })),
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "b-other",
      role: "other",
      account_id: "acct-other",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "b-bank",
      role: "bank",
      account_id: "acct-bank",
      effective_from: "2026-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
    },
  ];
}

describe("postingRulesService validation (DEV-089)", () => {
  it("accepts a well-formed active rule", () => {
    const result = postingRulesService.validateRule(rule());
    expect(result.ok).toBe(true);
  });

  it("rejects invalid account roles", () => {
    const result = postingRulesService.validateRule(
      rule({
        lines: [
          line({
            id: "l1",
            line_no: 1,
            side: "debit",
            account_role: "not_a_role" as PostingRuleLine["account_role"],
          }),
          line({
            id: "l2",
            line_no: 2,
            side: "credit",
            account_role: "bank",
          }),
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((error) => error.code === "INVALID_ACCOUNT_ROLE")).toBe(
      true,
    );
  });

  it("rejects rules missing debit or credit roles", () => {
    const debitOnly = postingRulesService.validateRule(
      rule({
        lines: [
          line({
            id: "l1",
            line_no: 1,
            side: "debit",
            account_role: "other",
          }),
        ],
      }),
    );
    expect(debitOnly.ok).toBe(false);
    if (!debitOnly.ok) {
      expect(
        debitOnly.errors.some((error) => error.code === "MISSING_CREDIT_ROLE"),
      ).toBe(true);
    }

    const creditOnly = postingRulesService.validateRule(
      rule({
        lines: [
          line({
            id: "l1",
            line_no: 1,
            side: "credit",
            account_role: "bank",
          }),
        ],
      }),
    );
    expect(creditOnly.ok).toBe(false);
    if (!creditOnly.ok) {
      expect(
        creditOnly.errors.some((error) => error.code === "MISSING_DEBIT_ROLE"),
      ).toBe(true);
    }
  });

  it("rejects invalid effective date ranges", () => {
    const result = postingRulesService.validateRule(
      rule({
        effective_from: "2026-06-01",
        effective_to: "2026-01-01",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some((error) => error.code === "INVALID_EFFECTIVE_DATES"),
    ).toBe(true);
  });

  it("detects duplicate versions with overlapping dates", () => {
    const result = postingRulesService.validateRuleSet([
      rule({ id: "a", version: 1, priority: 10 }),
      rule({ id: "b", version: 1, priority: 20 }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.errors.some((error) => error.code === "DUPLICATE_RULE")).toBe(
      true,
    );
  });

  it("detects overlapping active rules with the same priority", () => {
    const result = postingRulesService.validateRuleSet([
      rule({
        id: "a",
        version: 1,
        priority: 50,
        effective_from: "2026-01-01",
        effective_to: "2026-06-30",
      }),
      rule({
        id: "b",
        version: 2,
        priority: 50,
        effective_from: "2026-06-01",
        effective_to: null,
      }),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some((error) => error.code === "OVERLAPPING_RULE"),
    ).toBe(true);
  });

  it("allows overlapping dates when one rule is inactive", () => {
    const result = postingRulesService.validateRuleSet([
      rule({
        id: "a",
        version: 1,
        priority: 50,
        is_active: true,
      }),
      rule({
        id: "b",
        version: 2,
        priority: 50,
        is_active: false,
      }),
    ]);

    expect(result.ok).toBe(true);
  });

  it("detects missing account bindings for rule roles", () => {
    const result = postingRulesService.validateAccountBindings(
      rule(),
      bindings().filter((row) => row.role !== "bank"),
      "2026-07-26",
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(
      result.errors.some((error) => error.code === "MISSING_ACCOUNT_BINDING"),
    ).toBe(true);
  });
});

describe("postingRulesService resolution (DEV-089)", () => {
  it("resolves Active → Effective Date → Highest Priority", () => {
    const resolved = postingRulesService.resolveForEvent(
      {
        event_type: "expense_recognized",
        occurred_at: "2026-07-26T10:00:00.000Z",
      },
      [
        rule({
          id: "low",
          version: 9,
          priority: 10,
          effective_from: "2026-01-01",
        }),
        rule({
          id: "high",
          version: 1,
          priority: 200,
          effective_from: "2026-01-01",
        }),
        rule({
          id: "inactive",
          version: 3,
          priority: 999,
          is_active: false,
        }),
      ],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.rule.id).toBe("high");
    expect(resolved.rule.priority).toBe(200);
  });

  it("ignores rules outside the effective date window", () => {
    const resolved = postingRulesService.resolveForEvent(
      {
        event_type: "expense_recognized",
        occurred_at: "2026-07-26T10:00:00.000Z",
      },
      [
        rule({
          id: "expired",
          priority: 500,
          effective_from: "2026-01-01",
          effective_to: "2026-03-31",
        }),
        rule({
          id: "future",
          priority: 400,
          effective_from: "2026-08-01",
          effective_to: null,
        }),
        rule({
          id: "current",
          priority: 100,
          effective_from: "2026-04-01",
          effective_to: "2026-12-31",
        }),
      ],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.rule.id).toBe("current");
  });

  it("uses version as tie-breaker when priorities match", () => {
    const resolved = postingRulesService.resolveForEvent(
      {
        event_type: "expense_recognized",
        occurred_at: "2026-07-26T10:00:00.000Z",
      },
      [
        rule({ id: "v1", version: 1, priority: 50 }),
        rule({ id: "v2", version: 2, priority: 50 }),
      ],
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      return;
    }
    expect(resolved.rule.id).toBe("v2");
  });

  it("returns RULE_NOT_FOUND when only inactive rules exist", () => {
    const resolved = postingRulesService.resolveForEvent(
      {
        event_type: "expense_recognized",
        occurred_at: "2026-07-26T10:00:00.000Z",
      },
      [rule({ is_active: false, priority: 1000 })],
    );

    expect(resolved.ok).toBe(false);
    if (resolved.ok) {
      return;
    }
    expect(resolved.error.code).toBe("RULE_NOT_FOUND");
  });

  it("lists only active effective rules for an event type", () => {
    const active = postingRulesService.listActiveForEventType(
      "expense_recognized",
      [
        rule({ id: "a", is_active: true }),
        rule({ id: "b", is_active: false }),
        rule({
          id: "c",
          event_type: "payment_received",
          is_active: true,
        }),
      ],
      "2026-07-26",
    );

    expect(active.map((row) => row.id)).toEqual(["a"]);
  });
});
