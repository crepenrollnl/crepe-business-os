/**
 * Default UI and query limits shared across ERP modules.
 * Prefer these over magic numbers in hooks and tables.
 */

/** Default page size for list tables. */
export const DEFAULT_PAGE_SIZE = 25;

/** Allowed page-size options for table pagination controls. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/** Soft cap when loading reference dropdown data in one request. */
export const DEFAULT_LOOKUP_LIMIT = 500;

/** Debounce for search boxes (milliseconds). */
export const SEARCH_DEBOUNCE_MS = 250;

/** Maximum length for short name fields (ingredients, products, etc.). */
export const MAX_NAME_LENGTH = 120;

/** Maximum length for free-text notes / descriptions. */
export const MAX_NOTES_LENGTH = 2000;
