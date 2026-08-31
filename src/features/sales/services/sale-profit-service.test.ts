/**
 * Sales Profit service coverage (DEV-110).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SaleDetail } from "../types/sale";
import type { SaleCostSummary } from "../types/sale-cogs";

const { getSaleMock, getSaleCostSummaryMock, supabaseMock } = vi.hoisted(
  () => ({
    getSaleMock: vi.fn(),
    getSaleCostSummaryMock: vi.fn(),
    supabaseMock: { rpc: vi.fn() },
  }),
);

vi.mock("./sales-read-service", () => ({
  salesReadService: {
    getSale: getSaleMock,
  },
}));

vi.mock("./sale-cogs-service", () => ({
  saleCogsService: {
    getSaleCostSummary: getSaleCostSummaryMock,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { saleProfitService } from "./sale-profit-service";

const SALE_ID = "11111111-1111-4111-8111-111111111111";

function sale(
  overrides?: Partial<SaleDetail>,
): SaleDetail {
  return {
    sale_id: SALE_ID,
    sale_number: "S-100",
    status: "confirmed",
    sale_date: "2026-07-26",
    customer_id: null,
    subtotal: 100,
    tax_total: 21,
    total: 121,
    confirmed_at: "2026-07-26T12:00:00.000Z",
    paid_at: null,
    cancelled_at: null,
    discount_type: null,
    discount_value: null,
    discount_amount: null,
    lines: [],
    ...overrides,
  };
}

function cogsSummary(totalCogs: number): SaleCostSummary {
  return {
    sale_id: SALE_ID,
    total_cogs: totalCogs,
    consumed_quantity: 1,
    layers: [],
    line_summaries: [],
    is_frozen: true,
  };
}

describe("saleProfitService (DEV-110)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saleProfitService.clearBuiltSaleProfitRegistry();
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
  });

  it("builds profitable sale from frozen subtotal and COGS", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.net_revenue).toBe(100);
    expect(result.data?.cogs).toBe(40);
    expect(result.data?.gross_profit).toBe(60);
    expect(result.data?.gross_margin_percent).toBe(60);
    expect(result.data?.is_frozen).toBe(true);
    // Uses net revenue only — never sale.total (VAT-inclusive).
    expect(result.data?.net_revenue).not.toBe(121);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "verify_sale_cost_and_profit",
      {
        p_sale_id: SALE_ID,
        p_total_cogs: 40,
        p_net_revenue: 100,
        p_gross_profit: 60,
        p_gross_margin_percent: 60,
      },
    );
  });

  it("rejects and does not show COGS/profit when server-side verification disagrees", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({ data: false, error: null });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/failed server-side verification/i);
  });

  it("rejects when the verification RPC itself errors", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("connection refused");
  });

  it("does not register duplicate-generation when verification fails", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({ data: false, error: null });

    const first = await saleProfitService.buildFrozenSaleProfit(SALE_ID);
    expect(first.data).toBeNull();

    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
    const retry = await saleProfitService.buildFrozenSaleProfit(SALE_ID);

    expect(retry.error).toBeNull();
    expect(retry.data?.gross_profit).toBe(60);
  });

  it("supports zero profit", async () => {
    getSaleMock.mockResolvedValue({
      data: sale({ subtotal: 40, tax_total: 0, total: 40 }),
      error: null,
    });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.gross_profit).toBe(0);
    expect(result.data?.gross_margin_percent).toBe(0);
  });

  it("supports negative profit", async () => {
    getSaleMock.mockResolvedValue({
      data: sale({ subtotal: 20, tax_total: 0, total: 20 }),
      error: null,
    });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(45),
      error: null,
    });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.error).toBeNull();
    expect(result.data?.gross_profit).toBe(-25);
  });

  it("protects against duplicate frozen profit generation", async () => {
    getSaleMock.mockResolvedValue({ data: sale(), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });

    const first = await saleProfitService.buildFrozenSaleProfit(SALE_ID);
    const second = await saleProfitService.buildFrozenSaleProfit(SALE_ID);

    expect(first.error).toBeNull();
    expect(second.data).toBeNull();
    expect(second.error).toMatch(/already been generated/i);
  });

  it("keeps historical profit immutable across identical reloads", async () => {
    getSaleMock.mockResolvedValue({ data: sale({ status: "paid" }), error: null });
    getSaleCostSummaryMock.mockResolvedValue({
      data: cogsSummary(40),
      error: null,
    });

    const first = await saleProfitService.getSaleProfitSummary(SALE_ID);
    const second = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(
      saleProfitService.assertSaleProfitImmutable({
        previous: first.data!,
        next: second.data!,
      }),
    ).toBeNull();
  });

  it("rejects draft sales", async () => {
    getSaleMock.mockResolvedValue({
      data: sale({ status: "draft", confirmed_at: null }),
      error: null,
    });

    const result = await saleProfitService.getSaleProfitSummary(SALE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/draft/i);
    expect(getSaleCostSummaryMock).not.toHaveBeenCalled();
  });
});
