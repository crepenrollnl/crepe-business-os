/**
 * Standard service response contract for all feature services.
 * Keep database error details inside services; expose user-safe strings only.
 *
 * Prefer `ok` / `fail` helpers for new code. Existing services may continue
 * returning object literals — both shapes are identical.
 */

export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export function ok<T>(data: T): ServiceResult<T> {
  return { data, error: null };
}

export function fail(error: string): ServiceResult<never> {
  return { data: null, error };
}

export function isOk<T>(
  result: ServiceResult<T>,
): result is { data: T; error: null } {
  return result.error === null;
}

export function isFail<T>(
  result: ServiceResult<T>,
): result is { data: null; error: string } {
  return result.error !== null;
}
