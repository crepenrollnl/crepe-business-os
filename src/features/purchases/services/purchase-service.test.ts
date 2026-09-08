/**
 * Purchase Service coverage — atomic Receive (sql/116).
 *
 * Regression coverage for the 2026-09-08 system audit's Data integrity &
 * money-correctness Finding 1 (Critical): receivePurchase() previously ran
 * Receive as a client-orchestrated, non-atomic saga — a status check, then
 * a per-line RPC loop, with manual snapshot-based reversal on a later-line
 * failure that could itself fail and leave stock/cost inconsistent.
 *
 * It now delegates the whole status transition + every line's stock/cost
 * update to a single atomic RPC (receive_purchase, sql/116): the database
 * locks the purchase row, re-checks status = draft under that lock, and
 * either applies every line and flips the status, or raises and rolls back
 * the entire transaction. This suite checks the TS wrapper calls that RPC
 * exactly once with the right purchase id, surfaces its error verbatim
 * without performing any manual status reset of its own (there is nothing
 * to reverse — a raised RPC error means Postgres already rolled everything
 * back), and still saves header/line edits as a draft before receiving.
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

const draftPurchaseRow = {
  id: PURCHASE_ID,
  supplier_id: null,
  status: "draft",
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

// The row purchaseService.getPurchaseById re-fetches once the atomic RPC
// has flipped status to "received" — separate from the draft row above,
// since Receive no longer sets "received" on the insert/update payload
// itself (see the "saves ... as a draft" test below).
const receivedPurchaseRow = {
  ...draftPurchaseRow,
  status: "received",
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

function installMock(
  options: {
    receivePurchaseError?: { message: string } | null;
  } = {},
) {
  const { receivePurchaseError = null } = options;
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const itemInserts: unknown[] = [];
  const totalsCalls: unknown[] = [];
  const purchaseInserts: unknown[] = [];
  const receivePurchaseCalls: unknown[] = [];

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

      if (fn === "receive_purchase") {
        receivePurchaseCalls.push(args);

        if (receivePurchaseError) {
          return { data: null, error: receivePurchaseError };
        }

        return {
          data: {
            purchase_id: args.p_purchase_id,
            status: "received",
            lines_received: purchaseItemRows.length,
            received_at: "2026-07-30T12:00:00.000Z",
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
        insert: vi.fn((payload: unknown) => {
          purchaseInserts.push(payload);
          return chainable({ data: draftPurchaseRow, error: null });
        }),
        update: vi.fn((payload: unknown) => {
          updateCalls.push({ table, payload });
          return chainable({ data: null, error: null });
        }),
        select: vi.fn(() =>
          chainable({ data: receivedPurchaseRow, error: null }),
        ),
      };
    }

    if (table === "purchase_items") {
      return {
        delete: vi.fn(() => chainable({ data: null, error: null })),
        insert: vi.fn((payload: unknown) => {
          itemInserts.push(payload);
          return chainable({ data: purchaseItemRows, error: null });
        }),
        select: vi.fn(() => chainable({ data: purchaseItemRows, error: null })),
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

  return {
    updateCalls,
    itemInserts,
    totalsCalls,
    purchaseInserts,
    receivePurchaseCalls,
  };
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

describe("purchaseService.receivePurchase — atomic receive RPC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves the purchase as a draft, then calls receive_purchase exactly once", async () => {
    const { updateCalls, purchaseInserts, receivePurchaseCalls } =
      installMock();

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe("received");

    // Header/lines are still saved first (unchanged behavior) — but as a
    // draft. "received" only ever comes from the atomic RPC, never from a
    // client-set status on the insert payload.
    expect(purchaseInserts[0]).toMatchObject({ status: "draft" });

    expect(receivePurchaseCalls).toEqual([{ p_purchase_id: PURCHASE_ID }]);

    // No manual status reset exists anymore — the DB transaction is
    // all-or-nothing, so there is nothing left for the TS layer to unwind.
    expect(updateCalls).toEqual([]);
  });

  it("surfaces the RPC's zero-cost rejection without touching purchase status manually", async () => {
    const { updateCalls } = installMock({
      receivePurchaseError: {
        message:
          "Cannot receive this purchase. This ingredient has no net unit cost (zero or missing): Flour. Enter a positive unit cost on the purchase line and try again.",
      },
    });

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.data).toBeNull();
    expect(result.error).toMatch(
      /no net unit cost \(zero or missing\): Flour/i,
    );

    // A raised RPC error means Postgres already rolled back the whole
    // receive_purchase transaction — no status update should be attempted.
    expect(updateCalls).toEqual([]);
  });

  it("surfaces the RPC's already-received rejection the same way", async () => {
    const { updateCalls } = installMock({
      receivePurchaseError: {
        message: "This purchase has already been received.",
      },
    });

    const result = await purchaseService.receivePurchase(buildInput());

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/already been received/i);
    expect(updateCalls).toEqual([]);
  });
});

describe("purchaseService.receivePurchase — variant C tax memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists net unit_cost/line totals and remembers the typed inclusive price", async () => {
    const { itemInserts, totalsCalls, purchaseInserts } = installMock();

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
    const { itemInserts, totalsCalls, purchaseInserts } = installMock();

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
