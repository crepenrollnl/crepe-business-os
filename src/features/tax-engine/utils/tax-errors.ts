/**
 * Tax Engine error helpers (DEV-096).
 */

import type { TaxError, TaxErrorCode } from "@/types/tax-engine";

export function taxError(
  code: TaxErrorCode,
  message: string,
  details?: TaxError["details"],
): TaxError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function taxErrorMessage(error: TaxError): string {
  return error.message;
}
