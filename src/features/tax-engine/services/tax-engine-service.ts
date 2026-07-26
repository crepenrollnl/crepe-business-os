/**
 * Tax Engine service (DEV-096).
 *
 * Country-agnostic tax calculation entrypoint.
 *
 * Does NOT:
 *   - encode Localization Pack / country / regime behaviour
 *   - persist SQL / RPC
 *   - expose UI / hooks / pages
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  TaxCalculator,
  TaxRequest,
  TaxResult,
} from "@/types/tax-engine";
import { taxErrorMessage } from "../utils/tax-errors";
import { runTaxPipeline } from "../utils/tax-pipeline";
import { createTaxRoundingStrategy } from "../utils/tax-rounding";
import { validateUniqueTaxCodes } from "../utils/tax-validation";

export const taxEngineService = {
  /**
   * Run the generic Tax Calculation Pipeline.
   */
  calculate(
    request: TaxRequest,
    calculator?: TaxCalculator,
  ): ServiceResult<TaxResult> {
    const result = runTaxPipeline(request, calculator);

    if (!result.ok) {
      return fail(taxErrorMessage(result.error));
    }

    return ok(result.data);
  },

  /**
   * Structured pipeline entry for callers that need error codes.
   */
  runPipeline: runTaxPipeline,

  createRoundingStrategy: createTaxRoundingStrategy,

  /**
   * Validate that active definitions do not share tax codes.
   */
  validateDefinitions(
    definitions: TaxRequest["context"]["definitions"],
    occurredAt: string,
  ): ServiceResult<true> {
    const error = validateUniqueTaxCodes(definitions, occurredAt);
    if (error) {
      return fail(taxErrorMessage(error));
    }
    return ok(true);
  },
};
