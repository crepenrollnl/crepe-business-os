/**
 * Service-level coverage for salesProductReportService.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { salesProductReportService } from "./sales-product-report-service";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("salesProductReportService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps RPC rows without recalculating money", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        {
          product_id: PRODUCT_A,
          product_name: "Chicken Crepe",
          quantity: "2.000",
          revenue: "20.00",
          cogs: "2.01",
          gross_profit: "17.99",
          gross_margin_percent: "89.95",
        },
      ],
      error: null,
    });

    const result = await salesProductReportService.listForPeriod({
      from: "2026-08-29T09:23:00.000Z",
      to: "2026-08-29T13:30:00.000Z",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        product_id: PRODUCT_A,
        product_name: "Chicken Crepe",
        quantity: 2,
        revenue: 20,
        cogs: 2.01,
        gross_profit: 17.99,
        gross_margin_percent: 89.95,
      },
    ]);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_sales_by_product", {
      p_from: "2026-08-29T09:23:00.000Z",
      p_to: "2026-08-29T13:30:00.000Z",
    });
  });

  it("maps a missing get_sales_by_product function", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_sales_by_product in the schema cache",
        code: "PGRST202",
      },
    });

    const result = await salesProductReportService.listForPeriod({
      from: "2026-08-29T09:23:00.000Z",
      to: "2026-08-29T13:30:00.000Z",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Sales by product is not available yet. Apply the sales by product database script and try again.",
    );
  });

  it("keeps margin null when revenue is zero", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        {
          product_id: PRODUCT_A,
          product_name: "Sample",
          quantity: 1,
          revenue: 0,
          cogs: 1.5,
          gross_profit: -1.5,
          gross_margin_percent: null,
        },
      ],
      error: null,
    });

    const result = await salesProductReportService.listForPeriod({
      from: "2026-08-29T00:00:00.000Z",
      to: "2026-08-29T23:59:59.000Z",
    });

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.gross_margin_percent).toBeNull();
  });
});
