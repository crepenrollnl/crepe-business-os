/**
 * Operational Dashboard service (DEV-124).
 *
 * Projects the operational section from Dashboard Read Model only.
 * No direct shift/inventory/sales service calls.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import type { OperationalDashboardModel } from "../types/operational-dashboard";
import {
  buildOperationalDashboard,
  buildOperationalDashboardFromReadModel,
} from "../utils/operational-dashboard-builder";
import { dashboardService } from "./dashboard-service";

export const operationalDashboardService = {
  buildOperationalDashboard,
  buildOperationalDashboardFromReadModel,

  /**
   * Project operational fields from an already-loaded read model.
   */
  buildFromReadModel(
    readModel: DashboardReadModel,
  ): ServiceResult<OperationalDashboardModel> {
    const built = buildOperationalDashboardFromReadModel(readModel);
    if (built.error) {
      return fail(built.error);
    }
    return ok(built.data);
  },

  /**
   * Convenience: load Dashboard Read Model, then project operational fields.
   */
  async getOperationalDashboard(): Promise<
    ServiceResult<OperationalDashboardModel>
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
