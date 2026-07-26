/**
 * Service-level coverage for supplierPerformanceService (DEV-060).
 *
 * Reads must go only through get_supplier_performance /
 * get_supplier_performance_by_supplier RPCs.
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

import { supplierPerformanceService } from "./supplier-performance-service";
import type { SupplierPerformance } from "../types/supplier-performance";

const SUPPLIER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUPPLIER_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function performanceRow(overrides?: Record<string, unknown>) {
  return {
    supplier_id: SUPPLIER_ID,
    supplier_name: "Mill Co",
    purchase_count: 4,
    total_spent: "400.00",
    average_order_value: "100.00",
    last_purchase_date: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedPerformance(
  overrides?: Partial<SupplierPerformance>,
): SupplierPerformance {
  return {
    supplier_id: SUPPLIER_ID,
    supplier_name: "Mill Co",
    purchase_count: 4,
    total_spent: 400,
    average_order_value: 100,
    last_purchase_date: "2026-07-25T16:00:00.000Z",
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

describe("supplierPerformanceService.getSupplierPerformance (DEV-060)", () => {
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

  it("retrieves supplier performance list successfully via get_supplier_performance", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        performanceRow({
          supplier_id: SUPPLIER_ID_2,
          supplier_name: "Dairy Farm",
          purchase_count: 2,
          total_spent: "80.00",
          average_order_value: "40.00",
        }),
        performanceRow(),
      ],
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_supplier_performance");
    expectReadOnly("get_supplier_performance");
  });

  it("returns an empty array when no suppliers exist", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies SupplierPerformance[]);
    expectReadOnly("get_supplier_performance");
  });

  it("maps RPC rows to typed SupplierPerformance DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        performanceRow({
          supplier_name: "Fresh Dairy",
          purchase_count: 3,
          total_spent: "150.00",
          average_order_value: "50.00",
          last_purchase_date: "2026-07-24T12:00:00.000Z",
        }),
      ],
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedPerformance({
        supplier_name: "Fresh Dairy",
        purchase_count: 3,
        total_spent: 150,
        average_order_value: 50,
        last_purchase_date: "2026-07-24T12:00:00.000Z",
      }),
    ] satisfies SupplierPerformance[]);
    expectReadOnly("get_supplier_performance");
  });

  it("maps purchase_count, total_spent, and average_order_value without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        performanceRow({
          purchase_count: 10,
          total_spent: "1000.00",
          average_order_value: "77.77",
        }),
      ],
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.error).toBeNull();
    // Values come from the RPC as-is - never recomputed from spend / count.
    expect(result.data?.[0]?.purchase_count).toBe(10);
    expect(result.data?.[0]?.total_spent).toBe(1000);
    expect(result.data?.[0]?.average_order_value).toBe(77.77);
    expectReadOnly("get_supplier_performance");
  });

  it("maps null last_purchase_date without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        performanceRow({
          purchase_count: 0,
          total_spent: "0.00",
          average_order_value: "0.00",
          last_purchase_date: null,
        }),
      ],
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.last_purchase_date).toBeNull();
    expect(result.data?.[0]?.purchase_count).toBe(0);
    expectReadOnly("get_supplier_performance");
  });

  it("maps missing get_supplier_performance function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_supplier_performance",
      },
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Supplier performance is not available yet. Apply the supplier performance database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid list payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { not: "an-array" },
      error: null,
    });

    const result = await supplierPerformanceService.getSupplierPerformance();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Supplier performance response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [performanceRow()],
      error: null,
    });

    await supplierPerformanceService.getSupplierPerformance();

    expectReadOnly("get_supplier_performance");
  });

  it("never queries suppliers or purchases tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [performanceRow()],
      error: null,
    });

    await supplierPerformanceService.getSupplierPerformance();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("supplier_performance");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("suppliers");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchases");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("purchase_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "report_purchase_summary",
    );
    expectNoDirectWrites();
  });
});

describe("supplierPerformanceService.getSupplierPerformanceBySupplier (DEV-060)", () => {
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

  it("retrieves a single supplier performance successfully via get_supplier_performance_by_supplier", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: performanceRow({
        purchase_count: 5,
        total_spent: "250.00",
        average_order_value: "50.00",
      }),
      error: null,
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        SUPPLIER_ID,
      );

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedPerformance({
        purchase_count: 5,
        total_spent: 250,
        average_order_value: 50,
      }) satisfies SupplierPerformance,
    );
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_supplier_performance_by_supplier",
      {
        p_supplier_id: SUPPLIER_ID,
      },
    );
    expectReadOnly("get_supplier_performance_by_supplier");
  });

  it("maps purchase_count, total_spent, and average_order_value for one supplier without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: performanceRow({
        purchase_count: 8,
        total_spent: "800.00",
        average_order_value: "66.66",
      }),
      error: null,
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        `  ${SUPPLIER_ID}  `,
      );

    expect(result.error).toBeNull();
    expect(result.data?.purchase_count).toBe(8);
    expect(result.data?.total_spent).toBe(800);
    expect(result.data?.average_order_value).toBe(66.66);
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "get_supplier_performance_by_supplier",
      {
        p_supplier_id: SUPPLIER_ID,
      },
    );
    expectReadOnly("get_supplier_performance_by_supplier");
  });

  it("rejects invalid supplier id without calling the RPC", async () => {
    const blank =
      await supplierPerformanceService.getSupplierPerformanceBySupplier("   ");
    expect(blank.data).toBeNull();
    expect(blank.error).toBe("Supplier id is required.");

    const invalid =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        "not-a-uuid",
      );
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Supplier id is required.");

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing supplier as not found", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        SUPPLIER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Supplier performance was not found.");
    expectNoDirectWrites();
  });

  it("maps missing get_supplier_performance_by_supplier function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.get_supplier_performance_by_supplier",
      },
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        SUPPLIER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Supplier performance is not available yet. Apply the supplier performance database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing supplier_performance relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "supplier_performance" does not exist',
        code: "42P01",
      },
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        SUPPLIER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Supplier performance is not available yet. Apply the supplier performance database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid single-supplier payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: performanceRow({ supplier_id: "not-a-uuid" }),
      error: null,
    });

    const result =
      await supplierPerformanceService.getSupplierPerformanceBySupplier(
        SUPPLIER_ID,
      );

    expect(result.data).toBeNull();
    expect(result.error).toBe("Supplier performance response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: performanceRow(),
      error: null,
    });

    await supplierPerformanceService.getSupplierPerformanceBySupplier(
      SUPPLIER_ID,
    );

    expectReadOnly("get_supplier_performance_by_supplier");
  });
});
