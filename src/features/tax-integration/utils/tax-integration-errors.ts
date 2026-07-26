/**
 * Tax Integration error helpers (DEV-098).
 */

import type {
  TaxIntegrationError,
  TaxIntegrationErrorCode,
} from "../types/tax-integration";

export function taxIntegrationError(
  code: TaxIntegrationErrorCode,
  message: string,
  details?: TaxIntegrationError["details"],
): TaxIntegrationError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function taxIntegrationErrorMessage(error: TaxIntegrationError): string {
  return error.message;
}
