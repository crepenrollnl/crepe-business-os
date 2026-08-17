/**
 * Service-level coverage for saveSessionProgress (DEV-019).
 * Save Progress must go only through save_production_session RPC.
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
const updateMock = vi.fn();

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
    notes: "Kitchen notes",
    created_at: "2026-07-21T10:00:00.000Z",
    updated_at: "2026-07-21T10:00:00.000Z",
    ...overrides,
  };
}

function lineRow(overrides?: Record<string, unknown>) {
  return {
    id: "line-1",
    production_session_id: "session-1",
    production_plan_product_id: "ppp-1",
    recipe_id: "recipe-1",
    product_name: "Chicken Crepe",
    planned_quantity: 10,
    actual_produced_quantity: 8,
    raw_material_scale: null,
    yield_unit: "pcs",
    sort_order: 0,
    ...overrides,
  };
}

function mockSessionLoad(options?: {
  sessionId?: string;
  notes?: string | null;
  actual?: number | null;
}) {
  const sessionId = options?.sessionId ?? "session-1";
  const notes = options?.notes ?? "Kitchen notes";
  const actual = options?.actual ?? 8;

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "production_sessions") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: sessionRow({ id: sessionId, notes }),
              error: null,
            }),
          }),
        }),
        insert: insertMock,
        update: updateMock,
      };
    }

    if (table === "production_session_lines") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                lineRow({
                  production_session_id: sessionId,
                  actual_produced_quantity: actual,
                }),
              ],
              error: null,
            }),
          }),
        }),
        insert: insertMock,
        update: updateMock,
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
        update: updateMock,
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("productionSessionService.saveSessionProgress (DEV-019)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
  });

  it("calls only save_production_session and reloads the session", async () => {
    mockSessionLoad({ notes: "Saved notes", actual: 9 });
    supabaseMock.rpc.mockResolvedValue({
      data: { session_id: "session-1" },
      error: null,
    });

    const result = await productionSessionService.saveSessionProgress(
      "session-1",
      {
        notes: "Saved notes",
        lines: [{ line_id: "line-1", actual_produced_quantity: 9, raw_material_scale: null }],
      },
    );

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("session-1");
    expect(result.data?.notes).toBe("Saved notes");
    expect(result.data?.lines[0]?.actual_produced_quantity).toBe(9);

    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("save_production_session", {
      p_session_id: "session-1",
      p_notes: "Saved notes",
      p_lines: [{ line_id: "line-1", actual_produced_quantity: 9, raw_material_scale: null }],
    });
    expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
      "save_production_session",
    ]);
    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does not directly update production_sessions or production_session_lines", async () => {
    mockSessionLoad();
    supabaseMock.rpc.mockResolvedValue({
      data: { session_id: "session-1" },
      error: null,
    });

    await productionSessionService.saveSessionProgress("session-1", {
      notes: null,
      lines: [{ line_id: "line-1", actual_produced_quantity: 0, raw_material_scale: null }],
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("maps immutable-session domain errors without client updates", async () => {
    mockSessionLoad();
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "This production session can no longer be edited.",
      },
    });

    const result = await productionSessionService.saveSessionProgress(
      "session-1",
      {
        notes: "Nope",
        lines: [{ line_id: "line-1", actual_produced_quantity: 5, raw_material_scale: null }],
      },
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This production session can no longer be edited.",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps invalid line errors from the RPC", async () => {
    mockSessionLoad();
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "One or more session lines are invalid.",
      },
    });

    const result = await productionSessionService.saveSessionProgress(
      "session-1",
      {
        notes: null,
        lines: [{ line_id: "missing-line", actual_produced_quantity: 1, raw_material_scale: null }],
      },
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("One or more session lines are invalid.");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects negative quantities before calling the RPC", async () => {
    mockSessionLoad();

    const result = await productionSessionService.saveSessionProgress(
      "session-1",
      {
        notes: null,
        lines: [{ line_id: "line-1", actual_produced_quantity: -1, raw_material_scale: null }],
      },
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Produced quantity cannot be negative.");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
