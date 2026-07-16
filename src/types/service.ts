/**
 * Standard service response contract for all feature services.
 * Keep database error details inside services; expose user-safe strings only.
 */
export type ServiceResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };
