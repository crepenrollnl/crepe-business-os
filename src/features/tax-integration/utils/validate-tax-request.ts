/**
 * Integration-layer TaxRequest validation (DEV-098).
 */

import type { TaxCalculationContext } from "@/types/tax-engine";
import type { TaxCountryPackAdapter } from "../registry/country-pack-registry";
import type { TaxIntegrationError, TaxRequest } from "../types/tax-integration";
import { taxIntegrationError } from "./tax-integration-errors";

function toDateOnly(value: string): string {
  return value.slice(0, 10);
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

export function validateIntegrationTaxRequest(
  request: TaxRequest,
): TaxIntegrationError | null {
  if (!request?.request_id || request.request_id.trim().length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request_id is required.",
    );
  }

  if (!request.company?.company_id?.trim()) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request company.company_id is required.",
    );
  }

  if (!request.country || request.country.trim().length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request country is required.",
    );
  }

  if (!request.document_type || String(request.document_type).trim().length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request document_type is required.",
    );
  }

  if (!request.transaction_date || request.transaction_date.trim().length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request transaction_date is required.",
    );
  }

  if (!request.currency || request.currency.trim().length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request currency is required.",
    );
  }

  if (!Array.isArray(request.lines) || request.lines.length === 0) {
    return taxIntegrationError(
      "INVALID_TAX_REQUEST",
      "Tax request must include at least one line item.",
    );
  }

  for (const line of request.lines) {
    if (!line.line_id?.trim()) {
      return taxIntegrationError(
        "INVALID_TAX_REQUEST",
        "Each tax line requires a line_id.",
      );
    }

    if (!line.tax_category || line.tax_category.trim().length === 0) {
      return taxIntegrationError(
        "MISSING_TAX_CATEGORY",
        "Tax category is required on every line item.",
        { line_id: line.line_id },
      );
    }

    if (!Number.isFinite(line.quantity)) {
      return taxIntegrationError(
        "INVALID_TAX_REQUEST",
        "Tax line quantity must be a finite number.",
        { line_id: line.line_id },
      );
    }

    if (!Number.isFinite(line.unit_price)) {
      return taxIntegrationError(
        "INVALID_TAX_REQUEST",
        "Tax line unit_price must be a finite number.",
        { line_id: line.line_id },
      );
    }

    if (line.discount !== undefined && !Number.isFinite(line.discount)) {
      return taxIntegrationError(
        "INVALID_TAX_REQUEST",
        "Tax line discount must be a finite number when provided.",
        { line_id: line.line_id },
      );
    }
  }

  return null;
}

export function validateAgainstPackAndContext(input: {
  request: TaxRequest;
  adapter: TaxCountryPackAdapter;
  context: TaxCalculationContext;
}): TaxIntegrationError | null {
  const { request, adapter, context } = input;
  const dateOnly = toDateOnly(request.transaction_date);

  const jurisdictionId =
    request.jurisdiction?.trim() || adapter.default_jurisdiction_id;

  if (context.jurisdiction_id !== jurisdictionId) {
    // Context was built for another jurisdiction.
    if (
      request.jurisdiction &&
      request.jurisdiction.trim() !== adapter.default_jurisdiction_id &&
      request.jurisdiction.trim() !== context.jurisdiction_id
    ) {
      return taxIntegrationError(
        "INVALID_JURISDICTION",
        "Tax jurisdiction is not valid for the selected Country Pack.",
        {
          jurisdiction: request.jurisdiction,
          pack_id: adapter.pack_id,
        },
      );
    }
  }

  if (request.jurisdiction?.trim()) {
    const known =
      context.jurisdictions?.some(
        (row) => row.id === request.jurisdiction?.trim() && row.is_active,
      ) ?? request.jurisdiction.trim() === adapter.default_jurisdiction_id;

    if (!known) {
      return taxIntegrationError(
        "INVALID_JURISDICTION",
        "Tax jurisdiction is unknown or inactive for the Country Pack.",
        { jurisdiction: request.jurisdiction },
      );
    }
  }

  const categorySet = new Set(
    (context.categories ?? []).map((row) => row.code).concat(adapter.category_codes),
  );

  for (const line of request.lines) {
    const category = line.tax_category.trim();
    if (!categorySet.has(category)) {
      return taxIntegrationError(
        "MISSING_TAX_CATEGORY",
        "Tax category is not registered in the Country Pack.",
        { line_id: line.line_id, tax_category: category },
      );
    }
  }

  const activeDefinitions = context.definitions.filter((definition) => {
    if (!definition.is_active) {
      return false;
    }
    return isEffective(
      definition.effective_from,
      definition.effective_to,
      dateOnly,
    );
  });

  const codeOwners = new Map<string, string>();
  for (const definition of activeDefinitions) {
    const prior = codeOwners.get(definition.tax_code);
    if (prior && prior !== definition.id) {
      return taxIntegrationError(
        "DUPLICATE_TAX_CODE",
        "Duplicate tax codes detected in the Tax Country Pack context.",
        {
          tax_code: definition.tax_code,
          first_definition_id: prior,
          second_definition_id: definition.id,
        },
      );
    }
    codeOwners.set(definition.tax_code, definition.id);
  }

  for (const line of request.lines) {
    const codes = [
      ...(line.tax_codes ?? []),
      ...(line.tax_code ? [line.tax_code] : []),
    ]
      .map((code) => code.trim())
      .filter(Boolean);

    for (const code of codes) {
      const definition = context.definitions.find((row) => row.tax_code === code);
      if (!definition) {
        return taxIntegrationError(
          "INACTIVE_TAX",
          "Requested tax code is not registered in the Country Pack.",
          { line_id: line.line_id, tax_code: code },
        );
      }
      if (!definition.is_active) {
        return taxIntegrationError(
          "INACTIVE_TAX",
          "Requested tax code refers to an inactive tax definition.",
          {
            line_id: line.line_id,
            tax_code: code,
            tax_definition_id: definition.id,
          },
        );
      }
      if (
        !isEffective(
          definition.effective_from,
          definition.effective_to,
          dateOnly,
        )
      ) {
        return taxIntegrationError(
          "INACTIVE_TAX",
          "Requested tax definition is not effective on the transaction date.",
          {
            line_id: line.line_id,
            tax_code: code,
            tax_definition_id: definition.id,
          },
        );
      }

      const hasRate = context.rates.some(
        (rate) =>
          rate.tax_definition_id === definition.id &&
          rate.is_active &&
          isEffective(rate.effective_from, rate.effective_to, dateOnly),
      );
      if (!hasRate) {
        return taxIntegrationError(
          "MISSING_EFFECTIVE_RATE",
          "No effective tax rate is available for the requested tax definition.",
          {
            line_id: line.line_id,
            tax_code: code,
            tax_definition_id: definition.id,
          },
        );
      }
    }
  }

  return null;
}
