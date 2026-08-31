/**
 * Sales COGS service coverage (DEV-108).
 *
 * Assembles frozen valuation from Finished Goods consumptions only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "../types/sale";
import type { FinishedGoodsSaleConsumptionRow } from "@/features/finished-goods/types/finished-good";

const { getSaleMock, listConsumptionsMock, supabaseFromMock } = vi.hoisted(
  () => ({
    getSaleMock: vi.fn(),
    listConsumptionsMock: vi.fn(),
    supabaseFromMock: vi.fn(),
  }),
);

vi.mock("./sales-read-service", () => ({
  salesReadService: {
    getSale: getSaleMock,
  },
}));

vi.mock(
  "@/features/finished-goods/services/finished-goods-read-service",
  () => ({
    finishedGoodsReadService: {
      listConsumptionsForSaleLines: listConsumptionsMock,
    },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { from: supabaseFromMock },
}));

import { saleCogsService } from "./sale-cogs-service";

type StockMovementRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost: number;
  reference_id: string;
  ingredients: { name: string } | null;
};

/**
 * Minimal thenable query-builder stub for supabase.from("stock_movements"),
 * matching the pattern in inventory-service.test.ts / production-batch-
 * service.test.ts. sale-cogs-service only ever queries stock_movements
 * through this one mock, so a single shared builder is enough.
 */
function makeStockMovementsBuilder(rows: StockMovementRow[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.then = (
    resolve: (value: { data: StockMovementRow[]; error: null }) => unknown,
  ) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return builder;
}

const SALE_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const BATCH_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sale(status: SaleDetail["status"] = "confirmed"): SaleDetail {
  return {
    sale_id: SALE_ID,
    sale_number: "S-100",
    status,
    sale_date: "2026-07-26",
    customer_id: null,
    subtotal: 50,
    tax_total: 0,
    total: 50,
    confirmed_at: status === "draft" ? null : "2026-07-26T12:00:00.000Z",
    paid_at: status === "paid" ? "2026-07-26T13:00:00.000Z" : null,
    cancelled_at: null,
    discount_type: null,
    discount_value: null,
    discount_amount: null,
    lines: [
      {
        line_id: LINE_ID,
        product_id: "33333333-3333-4333-8333-333333333333",
        quantity: 9,
        unit_price: 5,
        line_total: 45,
      },
    ],
  };
}

function consumption(
  overrides?: Partial<FinishedGoodsSaleConsumptionRow>,
): FinishedGoodsSaleConsumptionRow {
  return {
    consumption_id: "c-1",
    sale_line_id: LINE_ID,
    production_batch_id: BATCH_A,
    batch_number: 1,
    quantity: 5,
    unit_cost: 2,
    total_cost: 10,
    produced_at: "2026-07-01T08:00:00.000Z",
    created_at: "2026-07-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("saleCogsService (DEV-108)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no direct raw-ingredient consumption for this sale. Tests
    // that only care about the finished-goods path never need to touch
    // this mock explicitly.
    supabaseFromMock.mockImplementation(() => makeStockMovementsBuilder([]));
  });

  it("builds single-batch COGS from stored consumptions", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [consumption()],
      error: null,
    });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.total_cogs).toBe(10);
    expect(result.data?.layers[0]?.unit_cost).toBe(2);
    expect(result.data?.layers[0]?.quantity).toBe(5);
    expect(result.data?.is_frozen).toBe(true);
    expect(listConsumptionsMock).toHaveBeenCalledWith([LINE_ID]);
  });

  it("builds multi-batch FIFO COGS without recalculating unit costs", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [
        consumption({
          consumption_id: "c-1",
          production_batch_id: BATCH_A,
          batch_number: 1,
          quantity: 5,
          unit_cost: 2,
          total_cost: 10,
        }),
        consumption({
          consumption_id: "c-2",
          production_batch_id: BATCH_B,
          batch_number: 2,
          quantity: 4,
          unit_cost: 3,
          total_cost: 12,
        }),
      ],
      error: null,
    });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.total_cogs).toBe(22);
    expect(result.data?.layers).toHaveLength(2);
    expect(result.data?.layers[1]?.unit_cost).toBe(3);
  });

  it("supports partial FIFO layer quantities", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [
        consumption({
          quantity: 2.5,
          unit_cost: 4,
          total_cost: 10,
        }),
      ],
      error: null,
    });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.layers[0]?.quantity).toBe(2.5);
    expect(result.data?.total_cogs).toBe(10);
  });

  it("rejects draft sales", async () => {
    getSaleMock.mockResolvedValue({ data: sale("draft"), error: null });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/draft/i);
    expect(listConsumptionsMock).not.toHaveBeenCalled();
  });

  it("rejects empty consumption for completed sales", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({ data: [], error: null });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no finished goods consumption/i);
  });

  it("keeps historical COGS immutable across identical reloads", async () => {
    getSaleMock.mockResolvedValue({ data: sale("paid"), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [consumption()],
      error: null,
    });

    const first = await saleCogsService.getSaleCostSummary(SALE_ID);
    const second = await saleCogsService.buildFrozenSaleValuation(SALE_ID);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(
      saleCogsService.assertSaleCogsImmutable({
        previous: first.data!,
        next: second.data!,
      }),
    ).toBeNull();
    expect(first.data?.total_cogs).toBe(second.data?.total_cogs);
  });

  it("does not expose profit fields", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [consumption()],
      error: null,
    });

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.data).not.toHaveProperty("gross_profit");
    expect(result.data).not.toHaveProperty("profit");
  });

  it("builds COGS purely from direct ingredient consumption (sql/089) when the assembly has no finished-goods components", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({ data: [], error: null });
    supabaseFromMock.mockImplementation(() =>
      makeStockMovementsBuilder([
        {
          id: "sm-1",
          ingredient_id: "ingredient-1",
          quantity: 0.05,
          unit_cost: 3,
          reference_id: LINE_ID,
          ingredients: { name: "Cucumber" },
        },
      ]),
    );

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.total_cogs).toBe(0.15);
    expect(result.data?.layers).toHaveLength(1);
    expect(result.data?.layers[0]?.source).toBe("ingredient");
    expect(result.data?.layers[0]?.production_batch_id).toBeNull();
    expect(result.data?.layers[0]?.ingredient_name).toBe("Cucumber");
  });

  it("sums finished-goods and direct-ingredient layers for a mixed assembly", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    listConsumptionsMock.mockResolvedValue({
      data: [consumption({ quantity: 1, unit_cost: 2, total_cost: 2 })],
      error: null,
    });
    supabaseFromMock.mockImplementation(() =>
      makeStockMovementsBuilder([
        {
          id: "sm-1",
          ingredient_id: "ingredient-1",
          quantity: 0.05,
          unit_cost: 3,
          reference_id: LINE_ID,
          ingredients: { name: "Cucumber" },
        },
      ]),
    );

    const result = await saleCogsService.getSaleCostSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.total_cogs).toBe(2.15);
    expect(result.data?.layers).toHaveLength(2);
  });
});
