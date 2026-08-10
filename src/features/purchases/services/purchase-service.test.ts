/**
 * Purchase Service coverage — multi-line stock increment safety.
 *
 * Regression coverage for Plan V1 Phase 1 item 1.3: when a multi-line
 * purchase partially applies increment_ingredient_stock and a later line
 * fails, already-applied lines must be reversed through the same atomic
 * RPC (negated quantity) — never a no-op stand-in whose result is
 * discarded, which would leave stock silently inflated.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavePurchaseInput } from "../types/purchase";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { purchaseService } from "./purchase-service";

const PURCHASE_ID = "11111111-1111-4111-8111-111111111111";
const INGREDIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface ChainResult {
  data: unknown;
  error: unknown;
}

function chainable(result: ChainResult) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = vi.fn(self);
  api.insert = vi.fn(self);
  api.update = vi.fn(self);
  api.delete = vi.fn(self);
  api.eq = vi.fn(self);
  api.neq = vi.fn(self);
  api.order = vi.fn(self);
  api.limit = vi.fn(self);
  api.maybeSingle = vi.fn(async () => result);
  api.single = vi.fn(async () => result);
  api.then = (
    resolve: (value: ChainResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return api;
}

const purchaseRow = {
  id: PURCHASE_ID,
  supplier_id: null,
  status: "received",
  invoice_number: null,
  notes: null,
  subtotal: 20,
  tax_total: 0,
  total: 20,
  currency: "EUR",
  purchased_at: "2026-07-30T12:00:00.000Z",
  transaction_id: null,
  production_plan_id: null,
  created_at: "2026-07-30T12:00:00.000Z",
  updated_at: "2026-07-30T12:00:00.000Z",
};

const purchaseItemRows = [
  {
    id: "item-1",
    purchase_id: PURCHASE_ID,
    ingredient_id: INGREDIENT_A,
    quantity: 10,
    unit_cost: 1,
    line_total: 10,
  },
  {
    id: "item-2",
    purchase_id: PURCHASE_ID,
    ingredient_id: INGREDIENT_B,
    quantity: 10,
    unit_cost: 1,
    line_total: 10,
  },
];

function installMock(stockRpcErrors: Record<string, { message: string } | null>) {
  const updateCalls: Array<{ table: string; payload: unknown }> = [];

  supabaseMock.rpc.mockImplementation(
    async (fn: string, args: Record<string, unknown>) => {
      if (fn === "calculate_purchase_totals") {
        const lines = args.p_lines as Array<{
          ingredient_id: string;
          quantity: number;
          unit_cost: number;
        }>;
        const preparedLines = lines.map((line) => ({
          ingredient_id: line.ingredient_id,
          quantity: line.quantity,
          unit_cost: line.unit_cost,
          line_total: line.quantity * line.unit_cost,
        }));
        const subtotal = preparedLines.reduce(
          (sum, line) => sum + line.line_total,
          0,
        );
        const taxTotal = Number(args.p_tax_total ?? 0);

        return {
          data: {
            lines: preparedLines,
            subtotal,
            tax_total: taxTotal,
            total: subtotal + taxTotal,
          },
          error: null,
        };
      }

      if (fn === "increment_ingredient_stock") {
        const ingredientId = args.p_ingredient_id as string;
        const quantity = args.p_quantity as number;
        const direction = quantity > 0 ? "forward" : "reverse";
        const key = `${ingredientId}:${direction}`;

        return { data: null, error: stockRpcErrors[key] ?? null };
      }

      throw new Error(`Unexpected rpc call: ${fn}`);
    },
  );

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "purchases") {
      return {
        insert: vi.fn(() => chainable({ data: purchaseRow, error: null })),
        update: vi.fn((payload: unknown) => {
          updateCalls.push({ table, payload });
          return chainable({ data: null, error: null });
        }),
        select: vi.fn(() => chainable({ data: [], error: null })),
      };
    }

    if (table === "purchase_items") {
      return {
        delete: vi.fn(() => chainable({ data: null, error: null })),
        insert: vi.fn(() => chainable({ data: purchaseItemRows, error: null })),
      };
    }

    if (table === "suppliers") {
      return { select: vi.fn(() => chainable({ data: [], error: null })) };
    }

    if (table === "ingredients") {
      return { select: vi.fn(() => chainable({ data: [], error: null })) };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return { updateCalls };
}

function buildInput(): SavePurchaseInput {
  return {
    supplier_id: "supplier-1",
    invoice_number: "INV-1",
    purchased_at: "2026-07-30",
    notes: "",
    lines: [
      { ingredient_id: INGREDIENT_A, quantity: 10, unit_cost: 1 },
      { ingredient_id: INGREDIENT_B, quantity: 10, unit_cost: 1 },
    ],
  };
}

describe("purchaseService.receivePurchase — partial stock increment failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reverses already-applied lines via the real RPC (negated quantity), not a no-op", async () => {
    const { updateCalls } = installMock({
      [`${INGREDIENT_B}:forward`]: { message: "deadlock detected" },
    });

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();

    const stockCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) => fn === "increment_ingredient_stock",
    );

    // Line A applied (+10), line B failed (+10 attempted), line A reversed (-10)
    // through the same real RPC — never a discarded stand-in.
    expect(stockCalls).toEqual([
      ["increment_ingredient_stock", { p_ingredient_id: INGREDIENT_A, p_quantity: 10 }],
      ["increment_ingredient_stock", { p_ingredient_id: INGREDIENT_B, p_quantity: 10 }],
      ["increment_ingredient_stock", { p_ingredient_id: INGREDIENT_A, p_quantity: -10 }],
    ]);

    expect(updateCalls).toEqual([
      {
        table: "purchases",
        payload: expect.objectContaining({ status: "draft" }),
      },
    ]);
  });

  it("surfaces a reversal failure in the returned error instead of discarding it", async () => {
    installMock({
      [`${INGREDIENT_B}:forward`]: { message: "deadlock detected" },
      [`${INGREDIENT_A}:reverse`]: { message: "connection reset" },
    });

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.error).toContain("deadlock detected");
    expect(result.error).toContain("connection reset");
    expect(result.error).toContain(INGREDIENT_A);
  });

  it("succeeds cleanly when every line's stock increment succeeds", async () => {
    installMock({});

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe("received");

    const stockCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) => fn === "increment_ingredient_stock",
    );

    expect(stockCalls).toEqual([
      ["increment_ingredient_stock", { p_ingredient_id: INGREDIENT_A, p_quantity: 10 }],
      ["increment_ingredient_stock", { p_ingredient_id: INGREDIENT_B, p_quantity: 10 }],
    ]);
  });
});
