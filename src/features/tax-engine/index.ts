/**
 * Tax Engine public API (DEV-096).
 *
 * Country-agnostic tax calculation foundation.
 * Localization Packs live outside this package.
 */

export { taxEngineService } from "./services/tax-engine-service";
export { createTaxRoundingStrategy } from "./utils/tax-rounding";
export { runTaxPipeline } from "./utils/tax-pipeline";
export { defaultTaxCalculator } from "./utils/tax-calculation";

export type {
  TaxApplicationMethod,
  TaxBreakdown,
  TaxBreakdownLine,
  TaxCalculationContext,
  TaxCalculator,
  TaxCategory,
  TaxCategoryCode,
  TaxCode,
  TaxDefinition,
  TaxDirection,
  TaxError,
  TaxErrorCode,
  TaxJurisdiction,
  TaxJurisdictionCode,
  TaxLineRequest,
  TaxPipelineResult,
  TaxPriceMode,
  TaxRate,
  TaxRequest,
  TaxResult,
  TaxRoundingMode,
  TaxRoundingStrategy,
  TaxRule,
  TaxType,
  TaxTypeCode,
} from "./types";
