/**
 * Posting Engine error helpers (DEV-088).
 */

import type { PostingError, PostingErrorCode } from "../types/posting-engine";

export function postingError(
  code: PostingErrorCode,
  message: string,
  details?: PostingError["details"],
): PostingError {
  return details === undefined ? { code, message } : { code, message, details };
}

export function postingErrorMessage(error: PostingError): string {
  return error.message;
}
