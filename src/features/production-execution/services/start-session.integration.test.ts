/**
 * Service-level coverage for startSession (DEV-018).
 * Session creation must go only through start_production_session RPC.
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

vi.mock("./production-batch-service", () => ({
  productionBatchService: {
    listBySessionId: vi.fn(async () => ({ data: [], error: null })),
  },
}));

import { productionSessionService } from "./production-session-service";

const insertMock = vi.fn();

function sessionRow(overrides?: Record<string, unknown>) {
  return {
    id: "session-1",
    session_number: 7,
    production_plan_id: "plan-1",
    status: "in_progress",
    started_at: "2026-07-21T10:00:00.000Z",
    completed_at: null,
    completed_by: null,
    operator_name: null,
    notes: null,
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
    ...overrides,
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

function mockSessionLoad(sessionId = "session-1") {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "production_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: sessionRow({ id: sessionId }),
              error: null,
            }),
          }),
        }),
        insert: insertMock,
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
        insert: insertMock,
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
        insert: insertMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("productionSessionService.startSession (DEV-018)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
  });

  it("calls only start_production_session and loads the returned session", async () => {
    mockSessionLoad("session-1");
    supabaseMock.rpc.mockResolvedValue({
      data: { session_id: "session-1", reused: false },
      error: null,
    });

    const result = await productionSessionService.startSession("plan-1");

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("session-1");
    expect(result.data?.status).toBe("in_progress");
    expect(result.data?.lines).toHaveLength(1);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("start_production_session", {
      p_production_plan_id: "plan-1",
    });
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "start_production_session",
    ]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reuses an existing open session when RPC returns that session_id", async () => {
    mockSessionLoad("session-existing");
    supabaseMock.rpc.mockResolvedValue({
      data: { session_id: "session-existing", reused: true },
      error: null,
    });

    const result = await productionSessionService.startSession("plan-1");

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("session-existing");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("start_production_session", {
      p_production_plan_id: "plan-1",
    });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not insert into production_sessions or production_session_lines", async () => {
    mockSessionLoad();
    supabaseMock.rpc.mockResolvedValue({
      data: { session_id: "session-1", reused: false },
      error: null,
    });

    await productionSessionService.startSession("plan-1");

    const tablesTouched = supabaseMock.from.mock.calls.map((call) => call[0]);
    expect(tablesTouched).not.toContain(undefined);
    expect(insertMock).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith(
      expect.stringMatching(/insert/i),
      expect.anything(),
    );
  });

  it("maps domain errors from the RPC without creating sessions", async () => {
    mockSessionLoad();
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "This production plan is not ready for execution. Only plans with status Ready for Production can start a session.",
      },
    });

    const result = await productionSessionService.startSession("plan-1");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This production plan is not ready for execution. Only plans with status Ready for Production can start a session.",
    );
    expect(insertMock).not.toHaveBeenCalled();
  });
});
