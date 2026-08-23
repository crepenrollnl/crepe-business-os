/**
 * Production Execution service — executable plan queue/detail + session links.
 *
 * Reuses Production Planning persistence via productionService.
 * Production Session writes live in productionSessionService.
 * Does not mutate inventory, create batches, or change purchases.
 */

import { productionService } from "@/features/production/services/production-service";
import { toUserError } from "@/lib/service-errors";
import type { ServiceResult } from "@/types/service";
import { productionSessionService } from "./production-session-service";
import {
  EXECUTABLE_PLAN_STATUS,
  type ExecutableProductionPlan,
  type ProductionExecutionPlanDetail,
} from "../types/production-execution";
import { filterExecutablePlans } from "../utils/is-executable-plan";

export const productionExecutionService = {
  /**
   * Returns Production Plans with status ready_to_produce
   * ("Ready for Production" in this workspace).
   */
  async getExecutablePlans(): Promise<
    ServiceResult<ExecutableProductionPlan[]>
  > {
    try {
      const result = await productionService.getProductionPlans();

      if (result.error || !result.data) {
        return {
          data: null,
          error: result.error ?? "Failed to load production plans",
        };
      }

      return {
        data: filterExecutablePlans(result.data),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load executable production plans"),
      };
    }
  },

  /**
   * Loads a plan for execution review, including open session and all
   * previous production runs. Rejects plans that are not ready for production.
   */
  async getExecutablePlanById(
    id: string,
  ): Promise<ServiceResult<ProductionExecutionPlanDetail>> {
    try {
      const result = await productionService.getProductionPlanById(id);

      if (result.error || !result.data) {
        return {
          data: null,
          error: result.error ?? "Failed to load production plan",
        };
      }

      if (result.data.status !== EXECUTABLE_PLAN_STATUS) {
        return {
          data: null,
          error:
            "This production plan is not ready for execution. Only plans with status Ready for Production can be opened here.",
        };
      }

      const [openSessionResult, sessionsResult] = await Promise.all([
        productionSessionService.getOpenSessionForPlan(id),
        productionSessionService.listSessionsForPlan(id),
      ]);

      if (openSessionResult.error) {
        return {
          data: null,
          error: openSessionResult.error,
        };
      }

      if (sessionsResult.error) {
        return {
          data: null,
          error: sessionsResult.error,
        };
      }

      return {
        data: {
          ...result.data,
          status: EXECUTABLE_PLAN_STATUS,
          open_session: openSessionResult.data,
          sessions: sessionsResult.data ?? [],
        },
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: toUserError(error, "Failed to load production plan"),
      };
    }
  },
};
