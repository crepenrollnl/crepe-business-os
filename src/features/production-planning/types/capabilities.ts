/**
 * Explicit capability boundaries for Production Planning.
 *
 * Planning may calculate, validate, and aggregate.
 * Planning must never mutate stock, create purchases, create batches,
 * or consume inventory. Enforce this in service contracts and call sites.
 */

/** Operations Planning is allowed to perform. */
export type PlanningAllowedCapability =
  | "calculate"
  | "validate"
  | "aggregate";

/**
 * Operations Planning must never perform.
 * Domain services expose no methods that imply these side effects.
 */
export type PlanningForbiddenCapability =
  | "modify_inventory"
  | "create_purchase"
  | "create_production_batch"
  | "consume_stock";

export const PLANNING_ALLOWED_CAPABILITIES = [
  "calculate",
  "validate",
  "aggregate",
] as const satisfies readonly PlanningAllowedCapability[];

export const PLANNING_FORBIDDEN_CAPABILITIES = [
  "modify_inventory",
  "create_purchase",
  "create_production_batch",
  "consume_stock",
] as const satisfies readonly PlanningForbiddenCapability[];
