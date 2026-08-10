/**
 * Tax Engine request / context / result validation (DEV-096).
 */

import type {
  TaxCalculationContext,
  TaxDefinition,
  TaxError,
  TaxRequest,
  TaxResult,
} from "@/types/tax-engine";
import { taxError } from "./tax-errors";

function toDateOnly(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

function isActiveOnDate(
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

/**
 * Detect duplicate tax_code among active definitions effective on the context date.
 */
export function validateUniqueTaxCodes(
  definitions: readonly TaxDefinition[],
  occurredAt: string,
): TaxError | null {
  const dateOnly = toDateOnly(occurredAt);
  const seen = new Map<string, string>();

  for (const definition of definitions) {
    if (!definition.is_active) {
      continue;
    }
    if (
      !isActiveOnDate(
        definition.effective_from,
        definition.effective_to,
        dateOnly,
      )
    ) {
      continue;
    }

    const code = definition.tax_code.trim();
    if (code.length === 0) {
      return taxError("DUPLICATE_TAX_CODE", "Tax definition has an empty tax_code.", {
        tax_definition_id: definition.id,
      });
    }

    const prior = seen.get(code);
    if (prior) {
      return taxError(
        "DUPLICATE_TAX_CODE",
        "Duplicate tax_code among active tax definitions.",
        {
          tax_code: code,
          first_definition_id: prior,
          second_definition_id: definition.id,
        },
      );
    }
    seen.set(code, definition.id);
  }

  return null;
}

export function validateTaxRequest(request: TaxRequest): TaxError | null {
  if (!request?.request_id || request.request_id.trim().length === 0) {
    return taxError("INVALID_REQUEST", "Tax request_id is required.");
  }

  if (!Array.isArray(request.lines) || request.lines.length === 0) {
    return taxError("INVALID_REQUEST", "Tax request must include at least one line.");
  }

  for (const line of request.lines) {
    if (!line.line_id || line.line_id.trim().length === 0) {
      return taxError("INVALID_REQUEST", "Each tax line requires a line_id.");
    }
    if (!Number.isFinite(line.amount)) {
      return taxError("INVALID_AMOUNT", "Tax line amount must be a finite number.", {
        line_id: line.line_id,
      });
    }
    if (!Number.isFinite(line.quantity) || line.quantity < 0) {
      return taxError(
        "INVALID_AMOUNT",
        "Tax line quantity must be a finite number greater than or equal to zero.",
        { line_id: line.line_id },
      );
    }
    if (line.price_mode !== "exclusive" && line.price_mode !== "inclusive") {
      return taxError("INVALID_REQUEST", "Tax line price_mode is invalid.", {
        line_id: line.line_id,
      });
    }
  }

  return null;
}

export function validateTaxContext(
  context: TaxCalculationContext,
): TaxError | null {
  if (!context?.occurred_at || context.occurred_at.trim().length === 0) {
    return taxError("INVALID_CONTEXT", "Tax context occurred_at is required.");
  }

  if (!context.currency || context.currency.trim().length === 0) {
    return taxError("INVALID_CONTEXT", "Tax context currency is required.");
  }

  if (!context.jurisdiction_id || context.jurisdiction_id.trim().length === 0) {
    return taxError("INVALID_CONTEXT", "Tax context jurisdiction_id is required.");
  }

  if (!context.rounding || typeof context.rounding.round !== "function") {
    return taxError("INVALID_CONTEXT", "Tax context rounding strategy is required.");
  }

  if (!Array.isArray(context.definitions) || !Array.isArray(context.types)) {
    return taxError(
      "INVALID_CONTEXT",
      "Tax context definitions and types must be arrays.",
    );
  }

  if (!Array.isArray(context.rates) || !Array.isArray(context.rules)) {
    return taxError(
      "INVALID_CONTEXT",
      "Tax context rates and rules must be arrays.",
    );
  }

  const duplicate = validateUniqueTaxCodes(
    context.definitions,
    context.occurred_at,
  );
  if (duplicate) {
    return duplicate;
  }

  return null;
}

/**
 * Final result validation after calculation + rounding.
 */
export function validateTaxResult(result: TaxResult): TaxError | null {
  if (!Number.isFinite(result.net_total) || !Number.isFinite(result.tax_total)) {
    return taxError("VALIDATION_FAILED", "Tax result totals must be finite.");
  }

  if (!Number.isFinite(result.gross_total)) {
    return taxError("VALIDATION_FAILED", "Tax result gross_total must be finite.");
  }

  for (const line of result.breakdown.lines) {
    if (line.tax_amount < 0) {
      return taxError(
        "VALIDATION_FAILED",
        "Tax breakdown amounts must not be negative.",
        { line_id: line.line_id, tax_code: line.tax_code },
      );
    }
  }

  return null;
}
