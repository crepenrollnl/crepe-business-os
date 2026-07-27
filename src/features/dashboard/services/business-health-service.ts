/**
 * Business Health service (DEV-125).
 *
 * Composes health from Dashboard Read Model statuses only.
 * No direct shift/inventory/sales service calls.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { BusinessHealthModel } from "../types/business-health";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  buildBusinessHealth,
  buildBusinessHealthFromReadModel,
} from "../utils/business-health-builder";
import { dashboardService } from "./dashboard-service";

export const businessHealthService = {
  buildBusinessHealth,
  buildBusinessHealthFromReadModel,

  buildFromReadModel(
    readModel: DashboardReadModel,
  ): ServiceResult<BusinessHealthModel> {
    const built = buildBusinessHealthFromReadModel(readModel);
    if (built.error) {
      return fail(built.error);
    }
    return ok(built.data);
  },

  async getBusinessHealth(): Promise<ServiceResult<BusinessHealthModel>> {
    const readModelResult = await dashboardService.getDashboardReadModel();
    if (readModelResult.error || !readModelResult.data) {
      return fail(
        readModelResult.error ?? "Failed to load dashboard read model",
      );
    }

    return this.buildFromReadModel(readModelResult.data);
  },
};
