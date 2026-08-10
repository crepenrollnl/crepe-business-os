/**
 * Tax Integration Framework public API (DEV-098).
 *
 * Operational modules must use taxIntegrationService only.
 */

export { taxIntegrationService } from "./services/tax-integration-service";
export { taxCountryPackRegistry } from "./registry/country-pack-registry";
export type { TaxCountryPackAdapter } from "./registry/country-pack-registry";

export type {
  TaxAppliedDefinition,
  TaxCompanyRef,
  TaxDocumentType,
  TaxIntegrationError,
  TaxIntegrationErrorCode,
  TaxIntegrationLineItem,
  TaxIntegrationMode,
  TaxLineResult,
  TaxPartyMetadata,
  TaxRequest,
  TaxResult,
  TaxRoundingInfo,
  TaxValidationWarning,
  TaxValidationWarningCode,
} from "./types";
