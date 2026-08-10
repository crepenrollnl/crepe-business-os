/**
 * Production Planning plan lifecycle statuses.
 *
 * Wire values are snake_case (no magic strings at call sites).
 * Labels are for UI / docs only — this domain package has no React UI.
 */

export const PRODUCTION_PLAN_STATUSES = [
  "draft",
  "calculated",
  "ready_for_purchase",
  "ready_for_production",
  "archived",
] as const;

export type ProductionPlanStatus = (typeof PRODUCTION_PLAN_STATUSES)[number];

export const PRODUCTION_PLAN_STATUS_LABELS: Record<
  ProductionPlanStatus,
  string
> = {
  draft: "Draft",
  calculated: "Calculated",
  ready_for_purchase: "Ready for Purchase",
  ready_for_production: "Ready for Production",
  archived: "Archived",
};

export function isProductionPlanStatus(
  value: string,
): value is ProductionPlanStatus {
  return (PRODUCTION_PLAN_STATUSES as readonly string[]).includes(value);
}
