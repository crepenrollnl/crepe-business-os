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

/**
 * Matches Postgres's DELETE-blocked-by-reference wording only ("update or
 * delete on table ... violates foreign key constraint ... on table X"),
 * deliberately distinct from an INSERT/UPDATE pointing at a missing parent
 * row ("insert or update on table ... is not present in table X"), which
 * also carries SQLSTATE 23503 but is a different failure to explain to a
 * user. The captured group is the table still holding the reference.
 */
const DELETE_BLOCKED_BY_REFERENCE_PATTERN =
  /update or delete on table "[^"]+" violates foreign key constraint "[^"]*" on table "([^"]+)"/i;

export function isDeleteBlockedByReference(error: unknown): boolean {
  const message = readErrorMessage(error);
  return message !== null && DELETE_BLOCKED_BY_REFERENCE_PATTERN.test(message);
}

export function extractReferencingTable(error: unknown): string | null {
  const message = readErrorMessage(error);
  if (message === null) {
    return null;
  }

  const match = DELETE_BLOCKED_BY_REFERENCE_PATTERN.exec(message);
  return match ? match[1] : null;
}

export interface DeletionBlockedMessages {
  /** Shown when the referencing table isn't listed in `byTable`, or the message couldn't be parsed. */
  fallback: string;
  /** Friendly phrase per referencing table name, e.g. `{ purchase_items: "..." }`. */
  byTable?: Record<string, string>;
}

/**
 * Builds a `ServiceErrorMapper` for delete operations blocked by another
 * row still referencing this one, so a raw Postgres FK message never
 * reaches the UI. Returns `null` for anything else, so it composes with a
 * service's other domain mappers inside `toUserError`'s `map` option.
 */
export function mapDeletionBlockedByReference(
  messages: DeletionBlockedMessages,
): ServiceErrorMapper {
  return (error) => {
    if (!isDeleteBlockedByReference(error)) {
      return null;
    }

    const table = extractReferencingTable(error);
    return (table && messages.byTable?.[table]) ?? messages.fallback;
  };
}
