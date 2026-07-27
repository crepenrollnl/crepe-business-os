/**
 * Dashboard KPI Cards service (DEV-123).
 *
 * Projects display cards from Dashboard Read Model only.
 * Does not recalculate revenue, profit, or inventory metrics.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import type { DashboardKpiCardsModel } from "../types/dashboard-kpi-cards";
import {
  buildDashboardKpiCards,
  buildDashboardKpiCardsFromReadModel,
} from "../utils/dashboard-kpi-cards-builder";
import { dashboardService } from "./dashboard-service";

export const dashboardKpiCardsService = {
  buildDashboardKpiCards,
  buildDashboardKpiCardsFromReadModel,

  /**
   * Project KPI cards from an already-loaded read model.
   */
  buildFromReadModel(
    readModel: DashboardReadModel,
  ): ServiceResult<DashboardKpiCardsModel> {
    const built = buildDashboardKpiCardsFromReadModel(readModel);
    if (built.error) {
      return fail(built.error);
    }
    return ok(built.data);
  },

  /**
   * Convenience: load Dashboard Read Model, then project KPI cards.
   */
  async getDashboardKpiCards(): Promise<ServiceResult<DashboardKpiCardsModel>> {
    const readModelResult = await dashboardService.getDashboardReadModel();
    if (readModelResult.error || !readModelResult.data) {
      return fail(
        readModelResult.error ?? "Failed to load dashboard read model",
      );
    }

    return this.buildFromReadModel(readModelResult.data);
  },
};
