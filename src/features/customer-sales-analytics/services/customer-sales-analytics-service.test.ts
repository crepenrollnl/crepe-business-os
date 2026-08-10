/**
 * Service-level coverage for customerSalesAnalyticsService (DEV-061).
 *
 * Reads must go only through get_customer_sales_analytics /
 * get_customer_sales_analytics_by_customer RPCs.
 * The service must not query tables directly, recalculate metrics, cache,
 * or write data.
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

import { customerSalesAnalyticsService } from "./customer-sales-analytics-service";
import type { CustomerSalesAnalytics } from "../types/customer-sales-analytics";

const CUSTOMER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CUSTOMER_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function analyticsRow(overrides?: Record<string, unknown>) {
  return {
    customer_id: CUSTOMER_ID,
    customer_name: "Cafe Central",
    sale_count: 4,
    total_revenue: "400.00",
    average_sale_value: "100.00",
    last_sale_date: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedAnalytics(
  overrides?: Partial<CustomerSalesAnalytics>,
): CustomerSalesAnalytics {
  return {
    customer_id: CUSTOMER_ID,
    customer_name: "Cafe Central",
    sale_count: 4,
    total_revenue: 400,
    average_sale_value: 100,
    last_sale_date: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

function expectReadOnly(rpcName: string) {
  expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
    rpcName,
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("customerSalesAnalyticsService.getCustomerSalesAnalytics (DEV-061)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves customer sales analytics list successfully via get_customer_sales_analytics", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        analyticsRow({
          customer_id: CUSTOMER_ID_2,
          customer_name: "Market Stall",
          sale_count: 2,
          total_revenue: "80.00",
          average_sale_value: "40.00",
        }),
        analyticsRow(),
      ],
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_customer_sales_analytics",
    );
    expectReadOnly("get_customer_sales_analytics");
  });

  it("returns an empty array when no customers exist", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies CustomerSalesAnalytics[]);
    expectReadOnly("get_customer_sales_analytics");
  });

  it("maps RPC rows to typed CustomerSalesAnalytics DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        analyticsRow({
          customer_name: "Office Catering",
          sale_count: 3,
          total_revenue: "150.00",
          average_sale_value: "50.00",
          last_sale_date: "2026-07-24T12:00:00.000Z",
        }),
      ],
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedAnalytics({
        customer_name: "Office Catering",
        sale_count: 3,
        total_revenue: 150,
        average_sale_value: 50,
        last_sale_date: "2026-07-24T12:00:00.000Z",
      }),
    ] satisfies CustomerSalesAnalytics[]);
    expectReadOnly("get_customer_sales_analytics");
  });

  it("maps sale_count, total_revenue, and average_sale_value without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        analyticsRow({
          sale_count: 10,
          total_revenue: "1000.00",
          average_sale_value: "77.77",
        }),
      ],
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from revenue / count.
    expect(result.data?.[0]?.sale_count).toBe(10);
    expect(result.data?.[0]?.total_revenue).toBe(1000);
    expect(result.data?.[0]?.average_sale_value).toBe(77.77);
    expectReadOnly("get_customer_sales_analytics");
  });

  it("maps null last_sale_date without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        analyticsRow({
          sale_count: 0,
          total_revenue: "0.00",
          average_sale_value: "0.00",
          last_sale_date: null,
        }),
      ],
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.last_sale_date).toBeNull();
    expect(result.data?.[0]?.sale_count).toBe(0);
    expectReadOnly("get_customer_sales_analytics");
  });

  it("maps missing get_customer_sales_analytics function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_customer_sales_analytics",
      },
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Customer sales analytics is not available yet. Apply the customer sales analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Customer sales analytics response was invalid.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [analyticsRow()],
      error: null,
    });

    await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expectReadOnly("get_customer_sales_analytics");
  });

  it("never queries customers or sales tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [analyticsRow()],
      error: null,
    });

    await customerSalesAnalyticsService.getCustomerSalesAnalytics();

    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "customer_sales_analytics",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("customers");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sales");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("sale_lines");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("report_sales_summary");
    expectNoDirectWrites();
  });
});

describe("customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer (DEV-061)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  it("retrieves a single customer analytics successfully via get_customer_sales_analytics_by_customer", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: analyticsRow({
        sale_count: 5,
        total_revenue: "250.00",
        average_sale_value: "50.00",
      }),
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        CUSTOMER_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedAnalytics({
        sale_count: 5,
        total_revenue: 250,
        average_sale_value: 50,
      }) satisfies CustomerSalesAnalytics,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_customer_sales_analytics_by_customer",
      {
        p_customer_id: CUSTOMER_ID,
      },
    );
    expectReadOnly("get_customer_sales_analytics_by_customer");
  });

  it("maps sale_count, total_revenue, and average_sale_value for one customer without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: analyticsRow({
        sale_count: 8,
        total_revenue: "800.00",
        average_sale_value: "66.66",
      }),
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        `  ${CUSTOMER_ID}  `,
      );

    expect(result.error).toBeNull();
    expect(result.data?.sale_count).toBe(8);
    expect(result.data?.total_revenue).toBe(800);
    expect(result.data?.average_sale_value).toBe(66.66);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_customer_sales_analytics_by_customer",
      {
        p_customer_id: CUSTOMER_ID,
      },
    );
    expectReadOnly("get_customer_sales_analytics_by_customer");
  });

  it("rejects invalid customer id without calling the RPC", async () => {
    const blank =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        "   ",
      );
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Customer id is required.");

    const invalid =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        "not-a-uuid",
      );
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Customer id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing customer as not found", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        CUSTOMER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Customer sales analytics was not found.");
    expectNoDirectWrites();
  });

  it("maps missing get_customer_sales_analytics_by_customer function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_customer_sales_analytics_by_customer",
      },
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        CUSTOMER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Customer sales analytics is not available yet. Apply the customer sales analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing customer_sales_analytics relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "customer_sales_analytics" does not exist',
        code: "42P01",
      },
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        CUSTOMER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Customer sales analytics is not available yet. Apply the customer sales analytics database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid single-customer payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: analyticsRow({ customer_id: "not-a-uuid" }),
      error: null,
    });

    const result =
      await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
        CUSTOMER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Customer sales analytics response was invalid.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: analyticsRow(),
      error: null,
    });

    await customerSalesAnalyticsService.getCustomerSalesAnalyticsByCustomer(
      CUSTOMER_ID,
    );

    expectReadOnly("get_customer_sales_analytics_by_customer");
  });
});
