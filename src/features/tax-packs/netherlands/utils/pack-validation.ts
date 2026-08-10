/**
 * Netherlands Tax Pack configuration validation (DEV-097).
 *
 * Pack-side checks only. Does not perform tax calculation.
 */

import {
  NETHERLANDS_TAX_REGIMES,
  type NetherlandsTaxPack,
  type NetherlandsTaxPackValidationError,
  type NetherlandsTaxPackValidationResult,
  type NetherlandsTaxRegime,
} from "../types/netherlands-tax-pack";

function packError(
  code: NetherlandsTaxPackValidationError["code"],
  message: string,
  details?: NetherlandsTaxPackValidationError["details"],
): NetherlandsTaxPackValidationError {
  return details === undefined ? { code, message } : { code, message, details };
}

function isNetherlandsRegime(value: string): value is NetherlandsTaxRegime {
  return (NETHERLANDS_TAX_REGIMES as readonly string[]).includes(value);
}

function datesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? "9999-12-31";
  const bEnd = bTo ?? "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

function matchKey(match: Readonly<Record<string, string>>): string {
  return Object.keys(match)
    .sort()
    .map((key) => `${key}=${match[key]}`)
    .join("|");
}

/**
 * Validate Netherlands pack registration integrity.
 */
export function validateNetherlandsTaxPack(
  pack: NetherlandsTaxPack,
): NetherlandsTaxPackValidationResult {
  if (pack.pack_id !== "netherlands") {
    return {
      ok: false,
      error: packError("INVALID_PACK", "Pack id must be 'netherlands'."),
    };
  }

  for (const regime of pack.regimes) {
    if (!isNetherlandsRegime(regime)) {
      return {
        ok: false,
        error: packError("INVALID_REGIME", "Unknown Netherlands tax regime.", {
          regime,
        }),
      };
    }
  }

  const seenCodes = new Map<string, string>();
  for (const registration of pack.definitions) {
    if (!isNetherlandsRegime(registration.regime)) {
      return {
        ok: false,
        error: packError(
          "INVALID_REGIME",
          "Tax definition registration references an invalid regime.",
          {
            tax_definition_id: registration.definition.id,
            regime: registration.regime,
          },
        ),
      };
    }

    const definition = registration.definition;
    if (definition.effective_to !== null) {
      if (definition.effective_from > definition.effective_to) {
        return {
          ok: false,
          error: packError(
            "INVALID_EFFECTIVE_DATES",
            "Tax definition effective_from must be on or before effective_to.",
            { tax_definition_id: definition.id },
          ),
        };
      }
    }

    if (!definition.is_active) {
      const activeRule = pack.rules.find(
        (rule) =>
          rule.is_active && rule.tax_definition_id === definition.id,
      );
      if (activeRule) {
        return {
          ok: false,
          error: packError(
            "INACTIVE_TAX",
            "Inactive tax definition still has an active tax rule.",
            {
              tax_definition_id: definition.id,
              tax_rule_id: activeRule.id,
            },
          ),
        };
      }
    }

    const code = definition.tax_code.trim();
    const prior = seenCodes.get(code);
    if (prior) {
      return {
        ok: false,
        error: packError(
          "DUPLICATE_TAX_CODE",
          "Duplicate tax_code in Netherlands Tax Pack definitions.",
          {
            tax_code: code,
            first_definition_id: prior,
            second_definition_id: definition.id,
          },
        ),
      };
    }
    seenCodes.set(code, definition.id);
  }

  for (const rate of pack.rates) {
    if (rate.effective_to !== null && rate.effective_from > rate.effective_to) {
      return {
        ok: false,
        error: packError(
          "INVALID_EFFECTIVE_DATES",
          "Tax rate effective_from must be on or before effective_to.",
          { tax_rate_id: rate.id },
        ),
      };
    }
  }

  for (let i = 0; i < pack.rules.length; i += 1) {
    const left = pack.rules[i]!;
    if (!left.is_active) {
      continue;
    }
    if (left.effective_to !== null && left.effective_from > left.effective_to) {
      return {
        ok: false,
        error: packError(
          "INVALID_EFFECTIVE_DATES",
          "Tax rule effective_from must be on or before effective_to.",
          { tax_rule_id: left.id },
        ),
      };
    }

    for (let j = i + 1; j < pack.rules.length; j += 1) {
      const right = pack.rules[j]!;
      if (!right.is_active) {
        continue;
      }
      if (left.jurisdiction_id !== right.jurisdiction_id) {
        continue;
      }
      if (matchKey(left.match) !== matchKey(right.match)) {
        continue;
      }
      if (left.priority !== right.priority) {
        continue;
      }
      if (
        !datesOverlap(
          left.effective_from,
          left.effective_to,
          right.effective_from,
          right.effective_to,
        )
      ) {
        continue;
      }

      return {
        ok: false,
        error: packError(
          "OVERLAPPING_RULES",
          "Overlapping tax rules share match, jurisdiction, priority, and effective dates.",
          {
            first_tax_rule_id: left.id,
            second_tax_rule_id: right.id,
          },
        ),
      };
    }
  }

  return { ok: true };
}
