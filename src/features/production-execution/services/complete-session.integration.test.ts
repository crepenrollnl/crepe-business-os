/**
 * Service-level integration coverage for completeSession (PRD-001).
 * Mocks Supabase to prove pre-transaction guards and RPC wiring.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/production/services/production-service", () => ({
  productionService: {
    getProductionPlanById: vi.fn(),
  },
}));

vi.mock("./production-batch-service", () => ({
  productionBatchService: {
    listBySessionId: vi.fn(async () => ({ data: [], error: null })),
  },
}));

import { productionSessionService } from "./production-session-service";

function sessionRow(status: string) {
  return {
    id: "session-1",
    session_number: 7,
    production_plan_id: "plan-1",
    status,
    started_at: "2026-07-21T10:00:00.000Z",
    completed_at: status === "completed" ? "2026-07-21T11:00:00.000Z" : null,
    completed_by: status === "completed" ? "user-1" : null,
    operator_name: null,
    notes: null,
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
  };
}

function lineRow() {
  return {
    id: "line-1",
    production_session_id: "session-1",
    production_plan_product_id: "ppp-1",
    recipe_id: "recipe-1",
    product_name: "Chicken Crepe",
    planned_quantity: 10,
    actual_produced_quantity: null,
    raw_material_scale: null,
    yield_unit: "pcs",
    sort_order: 0,
  };
}

function mockFromForComplete(options: {
  sessionStatus: string;
  flourStock?: number;
}) {
  const flourStock = options.flourStock ?? 100;

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "production_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: sessionRow(options.sessionStatus),
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "production_session_lines") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [lineRow()],
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "production_plans") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "plan-1", plan_number: 1, name: "Plan A" },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === "recipes") {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: "recipe-1",
                name: "Chicken Crepe",
                yield_quantity: 10,
                yield_unit: "pcs",
                is_active: true,
                recipe_role: "component",
              },
            ],
            error: null,
          }),
        }),
      };
    }

    if (table === "recipe_items") {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              {
                recipe_id: "recipe-1",
                ingredient_id: "flour",
                quantity: 2,
                unit: "kg",
              },
            ],
            error: null,
          }),
        }),
      };
    }

    if (table === "recipe_components") {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      };
    }

    if (table === "ingredients") {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: "flour",
                name: "Flour",
                unit: "kg",
                current_stock: flourStock,
                cost_per_unit: 1.5,
              },
            ],
            error: null,
          }),
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("productionSessionService.completeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
  });

  it("successful completion calls RPC with completed_by and actual quantities", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mockFromForComplete({ sessionStatus: "in_progress" });
    supabaseMock.rpc.mockResolvedValue({
      data: {
        session_id: "session-1",
        transaction_id: "txn-1",
        batch_count: 1,
        batch_ids: ["batch-1"],
        total_cost: 1.5,
        completed_at: "2026-07-21T12:00:00.000Z",
        completed_by: "user-1",
      },
      error: null,
    });

    const result = await productionSessionService.completeSession("session-1", {
      notes: "Done",
      lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
    });

    expect(result.error).toBeNull();
    expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_production_session", {
      p_session_id: "session-1",
      p_notes: "Done",
      p_lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
      p_completed_by: "user-1",
    });
    // DEV-017: client must not call the internal stock decrement RPC.
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      "decrement_ingredient_stock",
      expect.anything(),
    );
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "complete_production_session",
    ]);
    expect(logSpy).toHaveBeenCalledWith(
      "ProductionCompleted",
      expect.objectContaining({
        session_id: "session-1",
        batch_ids: ["batch-1"],
        total_cost: 1.5,
      }),
    );
    logSpy.mockRestore();
  });

  it("insufficient inventory returns a domain error and skips RPC", async () => {
    mockFromForComplete({ sessionStatus: "in_progress", flourStock: 0.1 });

    const result = await productionSessionService.completeSession("session-1", {
      notes: null,
      lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
    });

    expect(result.data).toBeNull();
    expect(result.error).toContain("Insufficient stock for \"Flour\"");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("double completion returns a domain error and skips RPC", async () => {
    mockFromForComplete({ sessionStatus: "completed" });

    const result = await productionSessionService.completeSession("session-1", {
      notes: null,
      lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("This production session is already completed.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("RPC failure is surfaced as a domain error (transaction rolled back server-side)", async () => {
    mockFromForComplete({ sessionStatus: "in_progress" });
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Forced failure during production batch creation.",
      },
    });

    const result = await productionSessionService.completeSession("session-1", {
      notes: null,
      lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Forced failure during production batch creation.");
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });
});
