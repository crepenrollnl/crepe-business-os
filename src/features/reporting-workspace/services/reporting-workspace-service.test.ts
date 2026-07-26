/**
 * Service-level coverage for reportingWorkspaceService (DEV-075).
 *
 * Reads must go only through get_reporting_workspace RPC.
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

import { reportingWorkspaceService } from "./reporting-workspace-service";
import type { ReportingWorkspace } from "../types/reporting-workspace";
import type {
  DashboardNavigationCatalog,
  DashboardNavigationItem,
} from "@/features/dashboard-navigation/types/dashboard-navigation";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function navigationItem(overrides?: Record<string, unknown>) {
  return {
    dashboard_key: "executive",
    display_name: "Executive Dashboard",
    category: "overview",
    description: "Highest-level company health, growth, and operating signals.",
    sort_order: 10,
    icon_identifier: "executive",
    availability: "available",
    ...overrides,
  };
}

function mappedNavigation(
  overrides?: Partial<DashboardNavigationItem>,
): DashboardNavigationItem {
  return {
    dashboard_key: "executive",
    display_name: "Executive Dashboard",
    category: "overview",
    description: "Highest-level company health, growth, and operating signals.",
    sort_order: 10,
    icon_identifier: "executive",
    availability: "available",
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

function emptyDashboardPayload() {
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

function overviewRow(overrides?: Record<string, unknown>) {
  return {
    generated_at: "2026-07-25T16:00:00.000Z",
    sections: [
      {
        section_name: "executive",
        title: "Executive Dashboard",
        source_view: "executive_dashboard",
        source_rpc: "get_executive_dashboard",
      },
    ],
    executive: executivePayload(),
    kpi: {
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
    },
    company: emptyDashboardPayload(),
    inventory: {
      total_ingredients: 0,
      low_stock_count: 0,
      out_of_stock_count: 0,
      total_inventory_value: 0,
      last_purchase_date: null,
      last_production_date: null,
    },
    production: {
      total_batches: 0,
      completed_batches: 0,
      failed_batches: 0,
      total_finished_goods: 0,
      last_production_date: null,
      average_batch_duration: null,
    },
    audit: {
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
    },
    user_activity: {
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
    },
    alerts: {
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
    },
    ...overrides,
  };
}

function workspaceRow(overrides?: Record<string, unknown>) {
  return {
    workspace_title: "Reporting Workspace",
    reporting_version: "1.0",
    available_dashboards: [navigationItem()],
    navigation_catalog: [
      navigationItem(),
      navigationItem({
        dashboard_key: "alerts",
        display_name: "Alerts Dashboard",
        category: "operations",
        description:
          "Operational alerts across stock, production, and system readiness.",
        sort_order: 60,
        icon_identifier: "alerts",
      }),
    ],
    reporting_overview: overviewRow(),
    generated_at: "2026-07-25T16:00:00.000Z",
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

describe("reportingWorkspaceService.getReportingWorkspace (DEV-075)", () => {
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

  it("retrieves reporting workspace successfully via get_reporting_workspace", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow(),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.workspace_title).toBe("Reporting Workspace");
    expect(result.data?.navigation_catalog).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_reporting_workspace");
    expectReadOnly("get_reporting_workspace");
  });

  it("maps empty/default workspace with empty catalogs and null overview", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        available_dashboards: [],
        navigation_catalog: [],
        reporting_overview: null,
        generated_at: null,
      }),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      workspace_title: "Reporting Workspace",
      reporting_version: "1.0",
      available_dashboards: [],
      navigation_catalog: [],
      reporting_overview: null,
      generated_at: null,
    } satisfies ReportingWorkspace);
    expectReadOnly("get_reporting_workspace");
  });

  it("maps RPC payload to typed ReportingWorkspace DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow(),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.workspace_title).toBe("Reporting Workspace");
    expect(result.data?.reporting_version).toBe("1.0");
    expect(result.data?.available_dashboards).toEqual([
      mappedNavigation(),
    ] satisfies DashboardNavigationCatalog);
    expect(result.data?.generated_at).toBe("2026-07-25T16:00:00.000Z");
    expect(result.data?.reporting_overview?.sections).toHaveLength(1);
    expectReadOnly("get_reporting_workspace");
  });

  it("maps nested DashboardNavigationCatalog from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        navigation_catalog: [
          navigationItem({
            dashboard_key: "audit",
            display_name: "Audit Dashboard",
            category: "governance",
            description: "Audit activity volume, failures, and domain event mix.",
            sort_order: "70",
            icon_identifier: "audit",
            availability: "available",
          }),
          navigationItem({
            dashboard_key: "user_activity",
            display_name: "User Activity Dashboard",
            category: "governance",
            description: "Attributed user activity and usage concentration.",
            sort_order: 80,
            icon_identifier: "user-activity",
            availability: "unavailable",
          }),
        ],
      }),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.navigation_catalog).toEqual([
      mappedNavigation({
        dashboard_key: "audit",
        display_name: "Audit Dashboard",
        category: "governance",
        description: "Audit activity volume, failures, and domain event mix.",
        sort_order: 70,
        icon_identifier: "audit",
        availability: "available",
      }),
      mappedNavigation({
        dashboard_key: "user_activity",
        display_name: "User Activity Dashboard",
        category: "governance",
        description: "Attributed user activity and usage concentration.",
        sort_order: 80,
        icon_identifier: "user-activity",
        availability: "unavailable",
      }),
    ] satisfies DashboardNavigationCatalog);
    expectReadOnly("get_reporting_workspace");
  });

  it("maps nested ReportingOverview from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        reporting_overview: overviewRow({
          executive: executivePayload({
            company_health: "critical",
            inventory_value: 999.99,
            sales_growth: -3.25,
          }),
        }),
      }),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.reporting_overview).toMatchObject({
      generated_at: "2026-07-25T16:00:00.000Z",
      sections: [
        {
          section_name: "executive",
          title: "Executive Dashboard",
          source_view: "executive_dashboard",
          source_rpc: "get_executive_dashboard",
        },
      ],
      executive: {
        company_health: "critical",
        inventory_value: 999.99,
        sales_growth: -3.25,
      },
    } satisfies Partial<ReportingOverview>);
    expectReadOnly("get_reporting_workspace");
  });

  it("maps reporting_version from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        reporting_version: "1.0",
      }),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.reporting_version).toBe("1.0");
    expectReadOnly("get_reporting_workspace");
  });

  it("maps generated_at from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        generated_at: "2026-07-25T18:45:00.000Z",
      }),
      error: null,
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.error).toBeNull();
    expect(result.data?.generated_at).toBe("2026-07-25T18:45:00.000Z");
    expectReadOnly("get_reporting_workspace");
  });

  it("rejects invalid workspace payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const invalidShape =
      await reportingWorkspaceService.getReportingWorkspace();
    expect(invalidShape.data).toBeNull();
    expect(invalidShape.error).toBe(
      "Reporting workspace response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        workspace_title: "",
      }),
      error: null,
    });

    const invalidTitle =
      await reportingWorkspaceService.getReportingWorkspace();
    expect(invalidTitle.data).toBeNull();
    expect(invalidTitle.error).toBe(
      "Reporting workspace response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        navigation_catalog: "not-an-array",
      }),
      error: null,
    });

    const invalidCatalog =
      await reportingWorkspaceService.getReportingWorkspace();
    expect(invalidCatalog.data).toBeNull();
    expect(invalidCatalog.error).toBe(
      "Reporting workspace response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow({
        reporting_overview: overviewRow({
          sections: "bad",
        }),
      }),
      error: null,
    });

    const invalidOverview =
      await reportingWorkspaceService.getReportingWorkspace();
    expect(invalidOverview.data).toBeNull();
    expect(invalidOverview.error).toBe(
      "Reporting workspace response was invalid.",
    );

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_reporting_workspace function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_reporting_workspace",
      },
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting workspace is not available yet. Apply the reporting workspace database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing reporting_workspace relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "reporting_workspace" does not exist',
      },
    });

    const result = await reportingWorkspaceService.getReportingWorkspace();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting workspace is not available yet. Apply the reporting workspace database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow(),
      error: null,
    });

    await reportingWorkspaceService.getReportingWorkspace();

    expectReadOnly("get_reporting_workspace");
  });

  it("never queries reporting workspace source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: workspaceRow(),
      error: null,
    });

    await reportingWorkspaceService.getReportingWorkspace();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_workspace");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_home");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("dashboard_navigation");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_api");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "reporting_api_sections",
    );
    expectNoDirectWrites();
  });
});
