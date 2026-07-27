/**
 * Dashboard Completion service (DEV-126).
 *
 * Builds the full Dashboard view from Dashboard Read Model only.
 * No duplicated business calculations.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardCompletionModel } from "../types/dashboard-completion";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  assertDashboardCompletionHistoricallyConsistent,
  buildDashboardCompletion,
} from "../utils/dashboard-completion-builder";
import { dashboardService } from "./dashboard-service";

export const dashboardCompletionService = {
  buildDashboardCompletion,
  assertDashboardCompletionHistoricallyConsistent,

  buildFromReadModel(
    readModel: DashboardReadModel,
  ): ServiceResult<DashboardCompletionModel> {
    const built = buildDashboardCompletion(readModel);
    if (built.error || !built.data) {
      return fail(built.error ?? "Failed to build dashboard completion");
    }
    return ok(built.data);
  },

  async getDashboardCompletion(): Promise<
    ServiceResult<DashboardCompletionModel>
  > {
    const readModelResult = await dashboardService.getDashboardReadModel();
    if (readModelResult.error || !readModelResult.data) {
      return fail(
        readModelResult.error ?? "Failed to load dashboard read model",
      );
    }

    return this.buildFromReadModel(readModelResult.data);
  },
};
