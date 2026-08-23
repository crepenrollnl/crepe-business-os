/**
 * listSessionsForPlan coverage — read-only history for a production plan.
 *
 * Prefers production_batches.produced_quantity; falls back to
 * production_session_lines.actual_produced_quantity. Never writes.
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

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const LINE_ID = "33333333-3333-4333-8333-333333333333";

const insertMock = vi.fn();

function thenableChain(result: { data: unknown; error: unknown }) {
  const chain: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
  } = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);

  return chain;
}

function mockTables(
  handlers: Record<string, { data: unknown; error: unknown }>,
) {
  supabaseMock.from.mockImplementation((table: string) => {
    const result = handlers[table];
    if (!result) {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      ...thenableChain(result),
      insert: insertMock,
    };
  });
}

describe("productionSessionService.listSessionsForPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
  });

  it("returns an empty list when the plan has no sessions", async () => {
    mockTables({
      production_sessions: { data: [], error: null },
    });

    const result =
      await productionSessionService.listSessionsForPlan(PLAN_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(supabaseMock.from).toHaveBeenCalledWith("production_sessions");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "production_session_lines",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_batches");
  });

  it("prefers batch produced_quantity over the session-line actual", async () => {
    mockTables({
      production_sessions: {
        data: [
          {
            id: SESSION_ID,
            session_number: 1,
            status: "completed",
            started_at: "2026-08-22T08:00:00.000Z",
            completed_at: "2026-08-22T10:00:00.000Z",
          },
        ],
        error: null,
      },
      production_session_lines: {
        data: [
          {
            id: LINE_ID,
            production_session_id: SESSION_ID,
            recipe_id: "recipe-chicken",
            product_name: "Roasted chicken",
            actual_produced_quantity: 3,
            yield_unit: "kg",
            sort_order: 0,
          },
        ],
        error: null,
      },
      production_batches: {
        data: [
          {
            production_session_line_id: LINE_ID,
            produced_quantity: 7,
          },
        ],
        error: null,
      },
    });

    const result =
      await productionSessionService.listSessionsForPlan(PLAN_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: SESSION_ID,
        session_number: 1,
        status: "completed",
        started_at: "2026-08-22T08:00:00.000Z",
        completed_at: "2026-08-22T10:00:00.000Z",
        lines: [
          {
            recipe_id: "recipe-chicken",
            product_name: "Roasted chicken",
            yield_unit: "kg",
            produced_quantity: 7,
            sort_order: 0,
          },
        ],
      },
    ]);
  });

  it("falls back to actual_produced_quantity when no batch exists", async () => {
    mockTables({
      production_sessions: {
        data: [
          {
            id: SESSION_ID,
            session_number: 1,
            status: "in_progress",
            started_at: "2026-08-22T08:00:00.000Z",
            completed_at: null,
          },
        ],
        error: null,
      },
      production_session_lines: {
        data: [
          {
            id: LINE_ID,
            production_session_id: SESSION_ID,
            recipe_id: "recipe-chicken",
            product_name: "Roasted chicken",
            actual_produced_quantity: 4,
            yield_unit: "kg",
            sort_order: 0,
          },
        ],
        error: null,
      },
      production_batches: { data: [], error: null },
    });

    const result =
      await productionSessionService.listSessionsForPlan(PLAN_ID);

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.lines[0]?.produced_quantity).toBe(4);
  });

  it("propagates a session query error", async () => {
    mockTables({
      production_sessions: {
        data: null,
        error: { message: "permission denied" },
      },
    });

    const result =
      await productionSessionService.listSessionsForPlan(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
