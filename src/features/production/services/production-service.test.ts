/**
 * confirmProductionPlan coverage (V1 critical finding — Production Planning
 * status deadlock, Вариант А).
 *
 * production-service.ts has no other tests (1624+ lines, pre-existing gap
 * logged in Фаза 3) — this file intentionally covers only the new method,
 * not the rest of the service.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionPlanWithRelations } from "../types/production";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { rpc: vi.fn(), from: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { productionService } from "./production-service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";

function plan(
  overrides?: Partial<ProductionPlanWithRelations>,
): ProductionPlanWithRelations {
  return {
    id: PLAN_ID,
    plan_number: 2,
    name: "Test Batch 2",
    status: "ready_to_produce",
    planning_date: "2026-07-31",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-07-31T08:00:00.000Z",
    updated_at: "2026-07-31T08:05:00.000Z",
    products: [],
    ingredients: [],
    shopping_items: [],
    linked_purchase: null,
    purchase_draft_status: "not_created",
    shopping_list_status: "not_generated",
    summary: {
      planned_product_count: 1,
      total_ingredient_lines: 1,
      missing_ingredient_lines: 0,
      shopping_list_status: "not_generated",
      purchase_draft_status: "not_created",
      planning_status: "ready_to_produce",
    },
    ...overrides,
  };
}

describe("productionService.confirmProductionPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms the plan via RPC and reloads it through getProductionPlanById", async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { id: PLAN_ID }, error: null });
    const reloaded = plan();
    const getByIdSpy = vi
      .spyOn(productionService, "getProductionPlanById")
      .mockResolvedValue({ data: reloaded, error: null });

    const result = await productionService.confirmProductionPlan(PLAN_ID);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("confirm_production_plan", {
      p_plan_id: PLAN_ID,
    });
    expect(getByIdSpy).toHaveBeenCalledWith(PLAN_ID);
    expect(result.error).toBeNull();
    expect(result.data).toEqual(reloaded);

    getByIdSpy.mockRestore();
  });

  it("rejects and does not reload when the RPC rejects a non-draft plan", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Only a draft production plan can be confirmed." },
    });
    const getByIdSpy = vi.spyOn(productionService, "getProductionPlanById");

    const result = await productionService.confirmProductionPlan(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("Only a draft production plan can be confirmed.");
    expect(getByIdSpy).not.toHaveBeenCalled();

    getByIdSpy.mockRestore();
  });

  it("surfaces a generic/network RPC error without reloading", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });
    const getByIdSpy = vi.spyOn(productionService, "getProductionPlanById");

    const result = await productionService.confirmProductionPlan(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("connection refused");
    expect(getByIdSpy).not.toHaveBeenCalled();

    getByIdSpy.mockRestore();
  });

  it("maps an unexpected thrown error to a fallback message", async () => {
    supabaseMock.rpc.mockRejectedValue(new Error("boom"));
    const getByIdSpy = vi.spyOn(productionService, "getProductionPlanById");

    const result = await productionService.confirmProductionPlan(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("boom");
    expect(getByIdSpy).not.toHaveBeenCalled();

    getByIdSpy.mockRestore();
  });
});
