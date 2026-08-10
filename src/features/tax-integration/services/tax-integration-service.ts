/**
 * Tax Integration Service (DEV-098).
 *
 * Sole entrypoint for operational modules to request tax calculations:
 *   calculateTaxes() | previewTaxes() | validateTaxes()
 *
 * Flow:
 *   Operational Module → Tax Integration Service → Tax Engine → Country Pack → Tax Result
 *
 * Operational modules must never access Tax Engine or Country Packs directly.
 *
 * Does NOT:
 *   - expose UI / hooks
 *   - persist SQL / RPC
 *   - change Accounting / Posting / Country Packs / Tax Engine Core
 */

import { taxEngineService } from "@/features/tax-engine";
import { fail, ok, type ServiceResult } from "@/types/service";
import { netherlandsTaxCountryPackAdapter } from "../adapters/netherlands-pack-adapter";
import { taxCountryPackRegistry } from "../registry/country-pack-registry";
import type {
  TaxIntegrationMode,
  TaxRequest,
  TaxResult,
} from "../types/tax-integration";
import { taxIntegrationErrorMessage } from "../utils/tax-integration-errors";
import { mapToEngineTaxRequest } from "../utils/map-tax-request";
import { mapEngineResultToIntegrationResult } from "../utils/map-tax-result";
import {
  validateAgainstPackAndContext,
  validateIntegrationTaxRequest,
} from "../utils/validate-tax-request";

function ensureDefaultPacksRegistered(): void {
  if (!taxCountryPackRegistry.get("NL")) {
    taxCountryPackRegistry.register(netherlandsTaxCountryPackAdapter);
  }
}

function runIntegration(
  request: TaxRequest,
  mode: TaxIntegrationMode,
): ServiceResult<TaxResult> {
  ensureDefaultPacksRegistered();

  const requestError = validateIntegrationTaxRequest(request);
  if (requestError) {
    return fail(taxIntegrationErrorMessage(requestError));
  }

  const adapterResult = taxCountryPackRegistry.resolve(request.country);
  if (adapterResult.error || !adapterResult.data) {
    return fail(
      adapterResult.error ??
        `No Tax Country Pack is registered for country '${request.country}'.`,
    );
  }
  const adapter = adapterResult.data;

  const contextResult = adapter.buildContext({
    occurredAt: request.transaction_date,
    currency: request.currency,
    jurisdictionId: request.jurisdiction,
  });
  if (contextResult.error || !contextResult.data) {
    return fail(
      contextResult.error ?? "Failed to build Tax Country Pack context.",
    );
  }
  const context = contextResult.data;

  const packError = validateAgainstPackAndContext({
    request,
    adapter,
    context,
  });
  if (packError) {
    return fail(taxIntegrationErrorMessage(packError));
  }

  if (mode === "validate") {
    // Validation mode: request + pack integrity only (no engine calculation required).
    return ok({
      request_id: request.request_id,
      mode: "validate",
      country: request.country.trim().toUpperCase(),
      currency: request.currency,
      jurisdiction_id:
        request.jurisdiction?.trim() || adapter.default_jurisdiction_id,
      document_type: String(request.document_type),
      transaction_date: request.transaction_date,
      net_total: 0,
      tax_total: 0,
      gross_total: 0,
      effective_tax_rate: 0,
      breakdown: { lines: [], by_tax_code: {} },
      lines: request.lines.map((line) => ({
        line_id: line.line_id,
        taxable_amount: 0,
        tax_amount: 0,
        net_amount: 0,
        gross_amount: 0,
        taxes: [],
      })),
      applied_tax_definitions: [],
      rounding: {
        mode: context.rounding.mode,
        decimal_places: context.rounding.decimal_places,
      },
      warnings: [],
      is_valid: true,
    });
  }

  const engineRequest = mapToEngineTaxRequest(request, context);
  const engineResult = taxEngineService.calculate(engineRequest);
  if (engineResult.error || !engineResult.data) {
    const message = engineResult.error ?? "Tax Engine calculation failed.";
    if (/no active tax rate/i.test(message)) {
      return fail(message);
    }
    if (/duplicate tax_code/i.test(message)) {
      return fail(message);
    }
    return fail(message);
  }

  return ok(
    mapEngineResultToIntegrationResult({
      request,
      engineResult: engineResult.data,
      context: engineRequest.context,
      mode,
      isValid: true,
    }),
  );
}

export const taxIntegrationService = {
  /**
   * Calculate taxes for an operational document.
   */
  calculateTaxes(request: TaxRequest): ServiceResult<TaxResult> {
    return runIntegration(request, "calculate");
  },

  /**
   * Preview taxes (same pipeline as calculate; result.mode = preview).
   */
  previewTaxes(request: TaxRequest): ServiceResult<TaxResult> {
    return runIntegration(request, "preview");
  },

  /**
   * Validate a tax request against Country Pack configuration.
   * Does not return calculated amounts.
   */
  validateTaxes(request: TaxRequest): ServiceResult<TaxResult> {
    return runIntegration(request, "validate");
  },

  /** Test helper: ensure default packs are registered. */
  ensureRegisteredPacks: ensureDefaultPacksRegistered,
};
