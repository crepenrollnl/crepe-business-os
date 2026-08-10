/**
 * Tax Rule Resolution (DEV-096).
 *
 * Active → Effective Date → Jurisdiction → Attribute match → Highest Priority.
 * No Localization Pack / regime logic.
 */

import type {
  TaxDefinition,
  TaxError,
  TaxLineRequest,
  TaxRule,
} from "@/types/tax-engine";
import { taxError } from "./tax-errors";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function isEffective(
  effectiveFrom: string,
  effectiveTo: string | null,
  dateOnly: string,
): boolean {
  if (effectiveFrom > dateOnly) {
    return false;
  }
  if (effectiveTo !== null && effectiveTo < dateOnly) {
    return false;
  }
  return true;
}

function attributesMatch(
  ruleMatch: Readonly<Record<string, string>>,
  lineAttributes: Readonly<Record<string, string>> | undefined,
): boolean {
  const attrs = lineAttributes ?? {};
  for (const [key, expected] of Object.entries(ruleMatch)) {
    if (attrs[key] !== expected) {
      return false;
    }
  }
  return true;
}

export interface ResolvedTaxApplication {
  rule: TaxRule;
  definition: TaxDefinition;
}

/**
 * Resolve applicable tax rules for one request line.
 */
export function resolveTaxRulesForLine(input: {
  line: TaxLineRequest;
  rules: readonly TaxRule[];
  definitionsById: Readonly<Record<string, TaxDefinition>>;
  jurisdictionId: string;
  occurredAt: string;
}): { ok: true; applications: ResolvedTaxApplication[] } | { ok: false; error: TaxError } {
  const { line, rules, definitionsById, jurisdictionId, occurredAt } = input;
  const dateOnly = toDateOnly(occurredAt);
  const requestedCodes = line.tax_codes
    ? new Set(line.tax_codes.map((code) => code.trim()))
    : null;

  const candidates: ResolvedTaxApplication[] = [];

  for (const rule of rules) {
    if (!rule.is_active) {
      continue;
    }
    if (!isEffective(rule.effective_from, rule.effective_to, dateOnly)) {
      continue;
    }
    if (rule.jurisdiction_id !== null && rule.jurisdiction_id !== jurisdictionId) {
      continue;
    }
    if (!attributesMatch(rule.match, line.attributes)) {
      continue;
    }

    const definition = definitionsById[rule.tax_definition_id];
    if (!definition) {
      return {
        ok: false,
        error: taxError(
          "DEFINITION_NOT_FOUND",
          "Tax rule references an unknown tax definition.",
          {
            tax_rule_id: rule.id,
            tax_definition_id: rule.tax_definition_id,
          },
        ),
      };
    }

    if (!definition.is_active) {
      continue;
    }
    if (
      !isEffective(
        definition.effective_from,
        definition.effective_to,
        dateOnly,
      )
    ) {
      continue;
    }

    if (requestedCodes && !requestedCodes.has(definition.tax_code)) {
      continue;
    }

    candidates.push({ rule, definition });
  }

  // When specific tax codes were requested, each must resolve.
  if (requestedCodes && requestedCodes.size > 0) {
    const resolvedCodes = new Set(
      candidates.map((row) => row.definition.tax_code),
    );
    for (const code of requestedCodes) {
      if (!resolvedCodes.has(code)) {
        return {
          ok: false,
          error: taxError(
            "RULE_NOT_FOUND",
            "No active tax rule matched the requested tax code.",
            { line_id: line.line_id, tax_code: code },
          ),
        };
      }
    }
  }

  // Keep highest-priority rule per tax_code.
  const bestByCode = new Map<string, ResolvedTaxApplication>();
  const sorted = [...candidates].sort((a, b) => {
    if (b.rule.priority !== a.rule.priority) {
      return b.rule.priority - a.rule.priority;
    }
    return a.rule.id.localeCompare(b.rule.id);
  });

  for (const candidate of sorted) {
    const code = candidate.definition.tax_code;
    if (!bestByCode.has(code)) {
      bestByCode.set(code, candidate);
    }
  }

  return { ok: true, applications: [...bestByCode.values()] };
}
