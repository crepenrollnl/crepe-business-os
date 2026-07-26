/**
 * Service-level coverage for reportingApiService (DEV-072).
 *
 * Reads must go only through get_reporting_overview /
 * get_reporting_section RPCs.
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

import { reportingApiService } from "./reporting-api-service";
import type {
  ReportingOverview,
  ReportingSection,
  ReportingSectionCatalogItem,
} from "../types/reporting-api";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function catalogItem(
  overrides?: Partial<ReportingSectionCatalogItem>,
): ReportingSectionCatalogItem {
  return {
    section_name: "executive",
    title: "Executive Dashboard",
    source_view: "executive_dashboard",
    source_rpc: "get_executive_dashboard",
    ...overrides,
  };
}

function executivePayload(overrides?: Record<string, unknown>) {
  return {
    company_health: "ok",
    inventory_value: 100,
    low_stock_count: 1,
    total_sales: 2,
    total_purchases: 3,
    total_batches: 4,
    sales_growth: 5.5,
    last_sale_date: "2026-07-25T16:00:00.000Z",
    last_purchase_date: "2026-07-24T10:00:00.000Z",
    last_production_date: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

function kpiPayload() {
  return {
    gross_revenue: 0,
    total_orders: 0,
    average_order_value: 0,
    inventory_turnover: null,
    recipe_cost_average: null,
    supplier_count: 0,
    customer_count: 0,
    production_efficiency: null,
    low_stock_ratio: null,
    sales_growth: null,
  };
}

function companyPayload() {
  return {
    total_suppliers: 0,
    total_customers: 0,
    total_recipes: 0,
    total_ingredients: 0,
    total_finished_goods: 0,
    total_sales: 0,
    total_purchases: 0,
    total_production_batches: 0,
    last_sale_date: null,
    last_purchase_date: null,
    last_production_date: null,
  };
}

function inventoryPayload() {
  return {
    total_ingredients: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    total_inventory_value: 0,
    last_purchase_date: null,
    last_production_date: null,
  };
}

function productionPayload() {
  return {
    total_batches: 0,
    completed_batches: 0,
    failed_batches: 0,
    total_finished_goods: 0,
    last_production_date: null,
    average_batch_duration: null,
  };
}

function auditPayload() {
  return {
    total_audit_events: 0,
    events_today: 0,
    events_last_7_days: 0,
    failed_operations: 0,
    user_activity_count: 0,
    production_events: 0,
    inventory_events: 0,
    sales_events: 0,
    purchase_events: 0,
    last_audit_event_at: null,
  };
}

function userActivityPayload() {
  return {
    active_users_today: 0,
    active_users_last_7_days: 0,
    total_user_actions: 0,
    production_actions: 0,
    inventory_actions: 0,
    purchase_actions: 0,
    sales_actions: 0,
    last_user_activity_at: null,
    most_active_user: null,
    average_actions_per_user: null,
  };
}

function alertsPayload() {
  return {
    low_stock_alerts: 0,
    out_of_stock_alerts: 0,
    overdue_production: 0,
    failed_batches: 0,
    stale_purchase_prices: 0,
    inactive_suppliers: 0,
    declining_sales: false,
    missing_company_settings: false,
    backup_status: "unknown",
    import_export_failures: 0,
  };
}

function overviewRow(overrides?: Record<string, unknown>) {
  return {
    generated_at: "2026-07-25T16:00:00.000Z",
    sections: [
      catalogItem(),
      catalogItem({
        section_name: "kpi",
        title: "KPI Dashboard",
        source_view: "kpi_dashboard",
        source_rpc: "get_kpi_dashboard",
      }),
      catalogItem({
        section_name: "alerts",
        title: "Alerts Dashboard",
        source_view: "alerts_dashboard",
        source_rpc: "get_alerts_dashboard",
      }),
    ],
    executive: executivePayload(),
    kpi: kpiPayload(),
    company: companyPayload(),
    inventory: inventoryPayload(),
    production: productionPayload(),
    audit: auditPayload(),
    user_activity: userActivityPayload(),
    alerts: alertsPayload(),
    ...overrides,
  };
}

function sectionRow(overrides?: Record<string, unknown>) {
  return {
    section_name: "executive",
    title: "Executive Dashboard",
    source_view: "executive_dashboard",
    source_rpc: "get_executive_dashboard",
    data: executivePayload(),
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

describe("reportingApiService.getReportingOverview (DEV-072)", () => {
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

  it("retrieves reporting overview successfully via get_reporting_overview", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow(),
      error: null,
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.error).toBeNull();
    expect(result.data?.generated_at).toBe("2026-07-25T16:00:00.000Z");
    expect(result.data?.sections).toHaveLength(3);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_reporting_overview");
    expectReadOnly("get_reporting_overview");
  });

  it("maps empty/default overview with empty catalog and zeroed dashboards", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow({
        sections: [],
        executive: executivePayload({
          company_health: "unknown",
          inventory_value: 0,
          low_stock_count: 0,
          total_sales: 0,
          total_purchases: 0,
          total_batches: 0,
          sales_growth: null,
          last_sale_date: null,
          last_purchase_date: null,
          last_production_date: null,
        }),
      }),
      error: null,
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.error).toBeNull();
    expect(result.data?.sections).toEqual([] satisfies ReportingSectionCatalogItem[]);
    expect(result.data?.executive.company_health).toBe("unknown");
    expect(result.data?.executive.sales_growth).toBeNull();
    expect(result.data?.kpi.total_orders).toBe(0);
    expectReadOnly("get_reporting_overview");
  });

  it("maps section catalog entries from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow({
        sections: [
          catalogItem({
            section_name: "user_activity",
            title: "User Activity Dashboard",
            source_view: "user_activity_dashboard",
            source_rpc: "get_user_activity_dashboard",
          }),
          catalogItem({
            section_name: "audit",
            title: "Audit Dashboard",
            source_view: "audit_dashboard",
            source_rpc: "get_audit_dashboard",
          }),
        ],
      }),
      error: null,
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.error).toBeNull();
    expect(result.data?.sections).toEqual([
      {
        section_name: "user_activity",
        title: "User Activity Dashboard",
        source_view: "user_activity_dashboard",
        source_rpc: "get_user_activity_dashboard",
      },
      {
        section_name: "audit",
        title: "Audit Dashboard",
        source_view: "audit_dashboard",
        source_rpc: "get_audit_dashboard",
      },
    ] satisfies ReportingSectionCatalogItem[]);
    expectReadOnly("get_reporting_overview");
  });

  it("maps nested dashboard DTOs from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow({
        executive: executivePayload({
          company_health: "critical",
          inventory_value: 999.99,
          low_stock_count: 7,
          sales_growth: -3.25,
        }),
        alerts: {
          ...alertsPayload(),
          low_stock_alerts: 7,
          declining_sales: true,
          backup_status: "degraded",
        },
      }),
      error: null,
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.error).toBeNull();
    // Nested payloads come from the RPC as-is - never recomputed.
    expect(result.data?.executive.company_health).toBe("critical");
    expect(result.data?.executive.inventory_value).toBe(999.99);
    expect(result.data?.executive.low_stock_count).toBe(7);
    expect(result.data?.executive.sales_growth).toBe(-3.25);
    expect(result.data?.alerts.low_stock_alerts).toBe(7);
    expect(result.data?.alerts.declining_sales).toBe(true);
    expect(result.data?.alerts.backup_status).toBe("degraded");
    expect(result.data).toMatchObject({
      company: companyPayload(),
      inventory: inventoryPayload(),
      production: productionPayload(),
    } satisfies Partial<ReportingOverview>);
    expectReadOnly("get_reporting_overview");
  });

  it("maps missing get_reporting_overview function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_reporting_overview",
      },
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting API is not available yet. Apply the reporting API database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid overview payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await reportingApiService.getReportingOverview();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Reporting overview response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow(),
      error: null,
    });

    await reportingApiService.getReportingOverview();

    expectReadOnly("get_reporting_overview");
  });
});

describe("reportingApiService.getReportingSection (DEV-072)", () => {
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

  it("retrieves a reporting section successfully via get_reporting_section", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: sectionRow(),
      error: null,
    });

    const result = await reportingApiService.getReportingSection("executive");

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      section_name: "executive",
      title: "Executive Dashboard",
      source_view: "executive_dashboard",
      source_rpc: "get_executive_dashboard",
      data: executivePayload(),
    } satisfies ReportingSection);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_reporting_section", {
      p_section_name: "executive",
    });
    expectReadOnly("get_reporting_section");
  });

  it("maps nested section data DTO from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: sectionRow({
        section_name: "kpi",
        title: "KPI Dashboard",
        source_view: "kpi_dashboard",
        source_rpc: "get_kpi_dashboard",
        data: {
          ...kpiPayload(),
          gross_revenue: 5000,
          total_orders: 40,
          average_order_value: 125,
        },
      }),
      error: null,
    });

    const result = await reportingApiService.getReportingSection("KPI");

    expect(result.error).toBeNull();
    expect(result.data?.section_name).toBe("kpi");
    expect(result.data?.data).toEqual({
      ...kpiPayload(),
      gross_revenue: 5000,
      total_orders: 40,
      average_order_value: 125,
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_reporting_section", {
      p_section_name: "kpi",
    });
    expectReadOnly("get_reporting_section");
  });

  it("rejects unknown section names without calling the RPC", async () => {
    const blank = await reportingApiService.getReportingSection("   ");
    expect(blank.data).toBeNull();
    expect(blank.error).toBe(
      "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.",
    );

    const unknown = await reportingApiService.getReportingSection("finance");
    expect(unknown.data).toBeNull();
    expect(unknown.error).toBe(
      "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.",
    );

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_reporting_section function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_reporting_section",
      },
    });

    const result = await reportingApiService.getReportingSection("alerts");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting API is not available yet. Apply the reporting API database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps unknown reporting section errors from the RPC", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.",
      },
    });

    const result = await reportingApiService.getReportingSection("executive");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Unknown reporting section. Use executive, kpi, company, inventory, production, audit, user_activity, or alerts.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid section payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: sectionRow({ data: [] }),
      error: null,
    });

    const result = await reportingApiService.getReportingSection("executive");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Reporting section response was invalid.");
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: sectionRow(),
      error: null,
    });

    await reportingApiService.getReportingSection("company");

    expectReadOnly("get_reporting_section");
  });

  it("never queries reporting API source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: overviewRow(),
      error: null,
    });
    await reportingApiService.getReportingOverview();

    supabaseMock.rpc.mockResolvedValue({
      data: sectionRow(),
      error: null,
    });
    await reportingApiService.getReportingSection("inventory");

    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_api");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_api_sections");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("executive_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("kpi_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("inventory_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("production_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("audit_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "user_activity_dashboard",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("alerts_dashboard");
    expectNoDirectWrites();
  });
});
