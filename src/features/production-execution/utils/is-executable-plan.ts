import type { ProductionPlanListItem } from "@/features/production/types/production";
import {
  EXECUTABLE_PLAN_STATUS,
  type ExecutableProductionPlan,
} from "../types/production-execution";

export function isExecutablePlan(
  plan: ProductionPlanListItem,
): plan is ExecutableProductionPlan {
  return plan.status === EXECUTABLE_PLAN_STATUS;
}

export function filterExecutablePlans(
  plans: ProductionPlanListItem[],
): ExecutableProductionPlan[] {
  return plans.filter(isExecutablePlan);
}
