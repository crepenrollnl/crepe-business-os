/**
 * Production Execution service coverage (Фаза 3 gap #2 of 3).
 *
 * production-execution-service.ts had zero tests before this file, despite
 * being used by two hooks (use-production-execution.ts,
 * use-production-execution-plan-detail.ts — confirmed by grep, matching
 * the original Фаза 3 audit).
 *
 * The file's own docstring is accurate (unlike production-batch-service.ts,
 * whose docstring turned out to describe SQL-side behavior, not itself):
 * this is a thin orchestration layer over productionService (plan
 * persistence) and productionSessionService (session links) — it does not
 * mutate inventory, create batches, or touch Supabase directly. Tests below
 * mock both dependency services and cover: the ready_to_produce filter,
 * the "not ready for execution" rejection, error propagation from each of
 * the three underlying calls, and the merged plan-detail shape.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProductionPlanListItem,
  ProductionPlanWithRelations,
} from "@/features/production/types/production";

const { productionServiceMock, productionSessionServiceMock } = vi.hoisted(
  () => ({
    productionServiceMock: {
      getProductionPlans: vi.fn(),
      getProductionPlanById: vi.fn(),
    },
    productionSessionServiceMock: {
      getOpenSessionForPlan: vi.fn(),
      listSessionsForPlan: vi.fn(),
    },
  }),
);

vi.mock("@/features/production/services/production-service", () => ({
  productionService: productionServiceMock,
}));

vi.mock("./production-session-service", () => ({
  productionSessionService: productionSessionServiceMock,
}));

import { productionExecutionService } from "./production-execution-service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function planListItem(
  overrides?: Partial<ProductionPlanListItem>,
): ProductionPlanListItem {
  return {
    id: PLAN_ID,
    plan_number: 1,
    name: "Test Batch",
    status: "ready_to_produce",
    planning_date: "2026-08-01",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-08-01T08:00:00.000Z",
    product_count: 1,
    missing_ingredient_lines: 0,
    shopping_list_status: "generated",
    purchase_draft_status: "not_created",
    linked_purchase: null,
    ...overrides,
  };
}

function planWithRelations(
  overrides?: Partial<ProductionPlanWithRelations>,
): ProductionPlanWithRelations {
  return {
    id: PLAN_ID,
    plan_number: 1,
    name: "Test Batch",
    status: "ready_to_produce",
    planning_date: "2026-08-01",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-08-01T08:00:00.000Z",
    products: [],
    ingredients: [],
    shopping_items: [],
    linked_purchase: null,
    purchase_draft_status: "not_created",
    shopping_list_status: "generated",
    summary: {
      planned_product_count: 1,
      total_ingredient_lines: 1,
      missing_ingredient_lines: 0,
      shopping_list_status: "generated",
      purchase_draft_status: "not_created",
      planning_status: "ready_to_produce",
    },
    ...overrides,
  };
}

describe("productionExecutionService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getExecutablePlans", () => {
    it("keeps only ready_to_produce plans", async () => {
      productionServiceMock.getProductionPlans.mockResolvedValue({
        data: [
          planListItem({ id: "a", status: "draft" }),
          planListItem({ id: "b", status: "ready_to_produce" }),
          planListItem({ id: "c", status: "completed" }),
          planListItem({ id: "d", status: "ready_to_produce" }),
        ],
        error: null,
      });

      const result = await productionExecutionService.getExecutablePlans();

      expect(result.error).toBeNull();
      expect(result.data?.map((plan) => plan.id)).toEqual(["b", "d"]);
    });

    it("returns an empty list (not an error) when no plan is ready", async () => {
      productionServiceMock.getProductionPlans.mockResolvedValue({
        data: [planListItem({ status: "draft" })],
        error: null,
      });

      const result = await productionExecutionService.getExecutablePlans();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    });

    it("propagates the error when loading production plans fails", async () => {
      productionServiceMock.getProductionPlans.mockResolvedValue({
        data: null,
        error: "Failed to load production plans from the database",
      });

      const result = await productionExecutionService.getExecutablePlans();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Failed to load production plans from the database",
      );
    });

    it("falls back to a generic message when data is null without an explicit error", async () => {
      productionServiceMock.getProductionPlans.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await productionExecutionService.getExecutablePlans();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Failed to load production plans");
    });

    it("maps a thrown exception to a fallback message", async () => {
      productionServiceMock.getProductionPlans.mockRejectedValue(
        new Error("boom"),
      );

      const result = await productionExecutionService.getExecutablePlans();

      expect(result.data).toBeNull();
      expect(result.error).toBe("boom");
    });
  });

  describe("getExecutablePlanById", () => {
    it("merges the plan with its open and completed session links", async () => {
      productionServiceMock.getProductionPlanById.mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      productionSessionServiceMock.getOpenSessionForPlan.mockResolvedValue({
        data: {
          id: SESSION_ID,
          session_number: 3,
          status: "in_progress",
          started_at: "2026-08-01T09:00:00.000Z",
        },
        error: null,
      });
      productionSessionServiceMock.listSessionsForPlan.mockResolvedValue(
        {
          data: [],
          error: null,
        },
      );

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.error).toBeNull();
      expect(result.data?.status).toBe("ready_to_produce");
      expect(result.data?.open_session).toEqual({
        id: SESSION_ID,
        session_number: 3,
        status: "in_progress",
        started_at: "2026-08-01T09:00:00.000Z",
      });
      expect(result.data?.sessions).toEqual([]);
      expect(
        productionSessionServiceMock.getOpenSessionForPlan,
      ).toHaveBeenCalledWith(PLAN_ID);
      expect(
        productionSessionServiceMock.listSessionsForPlan,
      ).toHaveBeenCalledWith(PLAN_ID);
    });

    it("rejects a plan that is not ready_to_produce without querying sessions", async () => {
      productionServiceMock.getProductionPlanById.mockResolvedValue({
        data: planWithRelations({ status: "draft" }),
        error: null,
      });

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This production plan is not ready for execution. Only plans with status Ready for Production can be opened here.",
      );
      expect(
        productionSessionServiceMock.getOpenSessionForPlan,
      ).not.toHaveBeenCalled();
      expect(
        productionSessionServiceMock.listSessionsForPlan,
      ).not.toHaveBeenCalled();
    });

    it("propagates the error when loading the plan fails", async () => {
      productionServiceMock.getProductionPlanById.mockResolvedValue({
        data: null,
        error: "Plan not found",
      });

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("Plan not found");
    });

    it("propagates the error when loading the open session fails", async () => {
      productionServiceMock.getProductionPlanById.mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      productionSessionServiceMock.getOpenSessionForPlan.mockResolvedValue({
        data: null,
        error: "Failed to load production session",
      });
      productionSessionServiceMock.listSessionsForPlan.mockResolvedValue(
        { data: [], error: null },
      );

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("Failed to load production session");
    });

    it("propagates the error when loading plan sessions fails", async () => {
      productionServiceMock.getProductionPlanById.mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      productionSessionServiceMock.getOpenSessionForPlan.mockResolvedValue({
        data: null,
        error: null,
      });
      productionSessionServiceMock.listSessionsForPlan.mockResolvedValue(
        { data: null, error: "Failed to load production sessions" },
      );

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("Failed to load production sessions");
    });

    it("maps a thrown exception to a fallback message", async () => {
      productionServiceMock.getProductionPlanById.mockRejectedValue(
        new Error("connection lost"),
      );

      const result =
        await productionExecutionService.getExecutablePlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("connection lost");
    });
  });
});
