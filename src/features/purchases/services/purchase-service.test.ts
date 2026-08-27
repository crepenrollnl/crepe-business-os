/**
 * Purchase Service coverage — multi-line stock increment safety.
 *
 * Regression coverage for Plan V1 Phase 1 item 1.3: when a multi-line
 * purchase partially applies receive_purchase_line_stock_and_cost and a
 * later line fails, already-applied lines must be reversed through
 * reverse_receive_purchase_line_stock_and_cost (snapshot restore) —
 * never a no-op stand-in whose result is discarded, which would leave
 * stock and cost_per_unit silently inflated.
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
  const itemInserts: unknown[] = [];
  const totalsCalls: unknown[] = [];
  const purchaseInserts: unknown[] = [];

  supabaseMock.rpc.mockImplementation(
    async (fn: string, args: Record<string, unknown>) => {
      if (fn === "calculate_purchase_totals") {
        totalsCalls.push(args);
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

      if (fn === "receive_purchase_line_stock_and_cost") {
        const ingredientId = args.p_ingredient_id as string;
        const key = `${ingredientId}:forward`;
        const error = stockRpcErrors[key] ?? null;

        if (error) {
          return { data: null, error };
        }

        return {
          data: {
            ingredient_id: ingredientId,
            previous_stock: 0,
            previous_cost_per_unit: 0,
            new_stock: args.p_quantity,
            new_cost_per_unit: args.p_net_unit_cost,
            cost_updated: true,
            warning: null,
          },
          error: null,
        };
      }

      if (fn === "reverse_receive_purchase_line_stock_and_cost") {
        const ingredientId = args.p_ingredient_id as string;
        return {
          data: null,
          error: stockRpcErrors[`${ingredientId}:reverse`] ?? null,
        };
      }

      throw new Error(`Unexpected rpc call: ${fn}`);
    },
  );

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "purchases") {
      return {
        insert: vi.fn((payload: unknown) => {
          purchaseInserts.push(payload);
          return chainable({ data: purchaseRow, error: null });
        }),
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
        insert: vi.fn((payload: unknown) => {
          itemInserts.push(payload);
          return chainable({ data: purchaseItemRows, error: null });
        }),
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

  return { updateCalls, itemInserts, totalsCalls, purchaseInserts };
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

  it("reverses already-applied lines via the snapshot RPC, not a no-op", async () => {
    const { updateCalls } = installMock({
      [`${INGREDIENT_B}:forward`]: { message: "deadlock detected" },
    });

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();

    const stockCalls = supabaseMock.rpc.mock.calls.filter(
      ([fn]) =>
        fn === "receive_purchase_line_stock_and_cost" ||
        fn === "reverse_receive_purchase_line_stock_and_cost",
    );

    // Line A applied, line B failed, line A reversed through the snapshot RPC.
    expect(stockCalls).toEqual([
      [
        "receive_purchase_line_stock_and_cost",
        {
          p_ingredient_id: INGREDIENT_A,
          p_quantity: 10,
          p_net_unit_cost: 1,
        },
      ],
      [
        "receive_purchase_line_stock_and_cost",
        {
          p_ingredient_id: INGREDIENT_B,
          p_quantity: 10,
          p_net_unit_cost: 1,
        },
      ],
      [
        "reverse_receive_purchase_line_stock_and_cost",
        {
          p_ingredient_id: INGREDIENT_A,
          p_previous_stock: 0,
          p_previous_cost_per_unit: 0,
        },
      ],
    ]);

    expect(updateCalls).toEqual([
      {
        table: "purchases",
        payload: expect.objectContaining({ status: "draft" }),
      },
    ]);
  });

  it("still receives the purchase when the RPC warns that cost_per_unit was skipped", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    supabaseMock.rpc.mockImplementation(
      async (fn: string, args: Record<string, unknown>) => {
        if (fn === "calculate_purchase_totals") {
          return {
            data: {
              lines: [
                {
                  ingredient_id: INGREDIENT_A,
                  quantity: 10,
                  unit_cost: 0,
                  line_total: 0,
                },
              ],
              subtotal: 0,
              tax_total: 0,
              total: 0,
            },
            error: null,
          };
        }

        if (fn === "receive_purchase_line_stock_and_cost") {
          return {
            data: {
              ingredient_id: args.p_ingredient_id,
              previous_stock: 4,
              previous_cost_per_unit: 9,
              new_stock: 14,
              new_cost_per_unit: 9,
              cost_updated: false,
              warning:
                "Purchase line net unit cost is missing or not positive; stock increased without updating cost_per_unit.",
            },
            error: null,
          };
        }

        throw new Error(`Unexpected rpc call: ${fn}`);
      },
    );

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "purchases") {
        return {
          insert: vi.fn(() =>
            chainable({
              data: { ...purchaseRow, subtotal: 0, total: 0 },
              error: null,
            }),
          ),
          update: vi.fn(() => chainable({ data: null, error: null })),
          select: vi.fn(() => chainable({ data: [], error: null })),
        };
      }

      if (table === "purchase_items") {
        return {
          delete: vi.fn(() => chainable({ data: null, error: null })),
          insert: vi.fn(() =>
            chainable({
              data: [
                {
                  id: "item-1",
                  purchase_id: PURCHASE_ID,
                  ingredient_id: INGREDIENT_A,
                  quantity: 10,
                  unit_cost: 0,
                  line_total: 0,
                },
              ],
              error: null,
            }),
          ),
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

    const result = await purchaseService.receivePurchase({
      supplier_id: "supplier-1",
      invoice_number: "INV-1",
      purchased_at: "2026-07-30",
      notes: "",
      lines: [{ ingredient_id: INGREDIENT_A, quantity: 10, unit_cost: 0 }],
    });

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe("received");
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
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
      ([fn]) => fn === "receive_purchase_line_stock_and_cost",
    );

    expect(stockCalls).toEqual([
      [
        "receive_purchase_line_stock_and_cost",
        {
          p_ingredient_id: INGREDIENT_A,
          p_quantity: 10,
          p_net_unit_cost: 1,
        },
      ],
      [
        "receive_purchase_line_stock_and_cost",
        {
          p_ingredient_id: INGREDIENT_B,
          p_quantity: 10,
          p_net_unit_cost: 1,
        },
      ],
    ]);
  });
});

describe("purchaseService.receivePurchase — variant C tax memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists net unit_cost/line totals and remembers the typed inclusive price", async () => {
    const { itemInserts, totalsCalls, purchaseInserts } = installMock({});

    const result = await purchaseService.receivePurchase({
      supplier_id: "supplier-1",
      invoice_number: "INV-1",
      purchased_at: "2026-07-30",
      notes: "",
      tax_total: 21,
      lines: [
        {
          ingredient_id: INGREDIENT_A,
          quantity: 1,
          unit_cost: 100,
          entered_unit_price: 121,
          price_mode: "inclusive",
          tax_category: "goods",
          tax_regime: "standard_vat",
        },
      ],
    });

    expect(result.error).toBeNull();

    expect(totalsCalls[0]).toMatchObject({
      p_tax_total: 21,
      p_lines: [
        expect.objectContaining({
          ingredient_id: INGREDIENT_A,
          quantity: 1,
          unit_cost: 100,
        }),
      ],
    });

    expect(purchaseInserts[0]).toMatchObject({
      subtotal: 100,
      tax_total: 21,
      total: 121,
      tax_country: null,
      supplier_country: null,
    });

    expect(itemInserts[0]).toEqual([
      expect.objectContaining({
        ingredient_id: INGREDIENT_A,
        quantity: 1,
        unit_cost: 100,
        line_total: 100,
        entered_unit_price: 121,
        price_mode: "inclusive",
        tax_category: "goods",
        tax_regime: "standard_vat",
        discount: null,
      }),
    ]);
  });

  it("persists line discount and header countries when provided", async () => {
    const { itemInserts, totalsCalls, purchaseInserts } = installMock({});

    const result = await purchaseService.receivePurchase({
      supplier_id: "supplier-1",
      invoice_number: "INV-1",
      purchased_at: "2026-07-30",
      notes: "",
      tax_country: "DE",
      supplier_country: "BE",
      tax_total: 21,
      lines: [
        {
          ingredient_id: INGREDIENT_A,
          quantity: 1,
          unit_cost: 100,
          discount: 5,
          entered_unit_price: 121,
          price_mode: "inclusive",
          tax_category: "goods",
          tax_regime: "standard_vat",
        },
      ],
    });

    expect(result.error).toBeNull();

    expect(totalsCalls[0]).toMatchObject({
      p_lines: [
        expect.objectContaining({
          ingredient_id: INGREDIENT_A,
          quantity: 1,
          unit_cost: 100,
          discount: 5,
        }),
      ],
    });

    expect(purchaseInserts[0]).toMatchObject({
      tax_country: "DE",
      supplier_country: "BE",
    });

    expect(itemInserts[0]).toEqual([
      expect.objectContaining({
        ingredient_id: INGREDIENT_A,
        quantity: 1,
        unit_cost: 100,
        discount: 5,
      }),
    ]);
  });
});
