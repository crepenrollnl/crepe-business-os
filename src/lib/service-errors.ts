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
 * Recognizable raw-Postgres/PostgREST wording that must never reach the UI
 * verbatim, even though it carries an otherwise-normal `.message` string.
 * Deliberately message-text patterns, not a `.code` check — modeled on
 * DELETE_BLOCKED_BY_REFERENCE_PATTERN below, which is also message-text
 * only despite the errors it matches carrying a `.code`.
 *
 * A prior attempt gated on SQLSTATE code instead (pass through only
 * `code === 'P0001'`, our own RAISE EXCEPTION default) and broke ~59
 * existing tests: many of our own deliberately human-readable messages
 * (RPC-raised business errors, thrown validation `Error`s) are mocked or
 * thrown with no `.code` at all, so a code-gated allow-list swallowed them
 * too. It also couldn't tell require_role's own deliberate 42501 messages
 * apart from a genuine RLS violation, which is also 42501. Matching on the
 * specific raw wording instead only intercepts the exact patterns the
 * audit named — everything else, including messages with no code,
 * continues to pass through exactly as before.
 */
const RAW_POSTGRES_ERROR_PATTERNS: readonly RegExp[] = [
  /violates row-level security policy/i,
  /violates not-null constraint/i,
  /violates foreign key constraint/i,
  /violates check constraint/i,
  /duplicate key value violates unique constraint/i,
  /permission denied for/i,
];

function isRawPostgresError(message: string): boolean {
  return RAW_POSTGRES_ERROR_PATTERNS.some((pattern) => pattern.test(message));
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

  if (isNetworkMessage(message)) {
    return NETWORK_ERROR_MESSAGE;
  }

  if (isRawPostgresError(message)) {
    console.error("ServiceErrorSuppressed", { fallback, error });
    return fallback;
  }

  return message;
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
