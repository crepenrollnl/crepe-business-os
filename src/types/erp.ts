/**
 * Shared ERP primitive types.
 *
 * Prefer these aliases in new module contracts so identity, time, quantity,
 * and money stay consistent across the platform.
 *
 * Domain modules may still use plain `string` / `number` where existing
 * interfaces already do — avoid mass renames of live modules.
 */

/** UUID primary key (or future opaque id). */
export type EntityId = string;

/** ISO-8601 timestamp string (database / API wire format). */
export type DateTime = string;

/** Calendar date as `YYYY-MM-DD` when time-of-day is not stored. */
export type CalendarDate = string;

/** Non-monetary measurable amount (stock, yield, recipe line qty). */
export type Quantity = number;

/**
 * Unit of measure label (e.g. kg, L, portion).
 * Prefer `InventoryUnit` / `YieldUnit` catalogs from `@/constants/units`
 * when constraining form or validation input.
 */
export type Unit = string;

/**
 * Monetary amount in major currency units (e.g. euros).
 * Round with `roundMoney` from `@/lib/money` before persistence.
 */
export type Money = number;

/** ISO 4217 currency code (e.g. EUR). */
export type CurrencyCode = string;

/** Shared list / table sort direction. */
export type SortDirection = "asc" | "desc";

/**
 * Generic document lifecycle used by transaction-oriented documents.
 * Module-specific statuses (purchase received, sale completed, etc.) stay
 * in feature types — use those when the domain needs a narrower set.
 */
export type DocumentLifecycleStatus =
  | "draft"
  | "posted"
  | "cancelled"
  | "voided";

/**
 * Generic activation status for master-data records.
 */
export type ActivationStatus = "active" | "inactive" | "archived";

/**
 * Stock availability signals used by Inventory / Finished Goods UIs.
 */
export type StockAvailabilityStatus = "ok" | "low" | "out";
