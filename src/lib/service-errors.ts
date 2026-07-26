/**
 * Shared service error normalization.
 *
 * Every feature service must map database / network failures into
 * user-safe strings via `toUserError` (or a thin domain wrapper around it).
 * Never leak raw stack traces or SQL details to the UI.
 */

export const NETWORK_ERROR_MESSAGE =
  "Network error. Please check your connection and try again.";

export function isNetworkMessage(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("fetch failed")
  );
}

/**
 * Optional domain-specific mapper. Return a string to override the default
 * message, or `null` to fall through to the shared mapping.
 */
export type ServiceErrorMapper = (error: unknown) => string | null;

export interface ToUserErrorOptions {
  map?: ServiceErrorMapper;
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const message = (error as { message: string }).message.trim();
    return message.length > 0 ? message : null;
  }

  return null;
}

/**
 * Normalize an unknown failure into a user-safe error string.
 *
 * @param error - Caught value, Supabase error, or prior string error
 * @param fallback - Used when no usable message can be extracted
 * @param options.map - Optional domain override (e.g. duplicate name)
 */
export function toUserError(
  error: unknown,
  fallback: string,
  options?: ToUserErrorOptions,
): string {
  const mapped = options?.map?.(error) ?? null;
  if (mapped !== null) {
    return mapped;
  }

  const message = readErrorMessage(error);
  if (message === null) {
    return fallback;
  }

  return isNetworkMessage(message) ? NETWORK_ERROR_MESSAGE : message;
}
