/**
 * Service-level coverage for reportingHomeService (DEV-074).
 *
 * Reads must go only through get_reporting_home RPC.
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

import { reportingHomeService } from "./reporting-home-service";
import type { ReportingHome } from "../types/reporting-home";
import type { DashboardNavigationItem } from "@/features/dashboard-navigation/types/dashboard-navigation";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function dashboardItem(overrides?: Record<string, unknown>) {
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

function mappedDashboard(
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

function homeRow(overrides?: Record<string, unknown>) {
  return {
    available_dashboards: [dashboardItem()],
    reporting_categories: ["governance", "operations", "overview"],
    total_dashboard_count: 8,
    available_section_count: 8,
    last_generated_at: "2026-07-25T16:00:00.000Z",
    application_reporting_version: "1.0",
    ...overrides,
  };
}

function mappedHome(overrides?: Partial<ReportingHome>): ReportingHome {
  return {
    available_dashboards: [mappedDashboard()],
    reporting_categories: ["governance", "operations", "overview"],
    total_dashboard_count: 8,
    available_section_count: 8,
    last_generated_at: "2026-07-25T16:00:00.000Z",
    application_reporting_version: "1.0",
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

describe("reportingHomeService.getReportingHome (DEV-074)", () => {
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

  it("retrieves reporting home successfully via get_reporting_home", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow(),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data?.application_reporting_version).toBe("1.0");
    expect(result.data?.available_dashboards).toHaveLength(1);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_reporting_home");
    expectReadOnly("get_reporting_home");
  });

  it("maps empty/default home with empty catalogs and zero counts", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        available_dashboards: [],
        reporting_categories: [],
        total_dashboard_count: 0,
        available_section_count: 0,
        last_generated_at: null,
        application_reporting_version: "1.0",
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      available_dashboards: [],
      reporting_categories: [],
      total_dashboard_count: 0,
      available_section_count: 0,
      last_generated_at: null,
      application_reporting_version: "1.0",
    } satisfies ReportingHome);
    expectReadOnly("get_reporting_home");
  });

  it("maps RPC payload to typed ReportingHome DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        total_dashboard_count: "8",
        available_section_count: "8",
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedHome() satisfies ReportingHome);
    expectReadOnly("get_reporting_home");
  });

  it("maps nested DashboardNavigationItem entries from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        available_dashboards: [
          dashboardItem(),
          dashboardItem({
            dashboard_key: "alerts",
            display_name: "Alerts Dashboard",
            category: "operations",
            description:
              "Operational alerts across stock, production, and system readiness.",
            sort_order: "60",
            icon_identifier: "alerts",
            availability: "available",
          }),
        ],
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data?.available_dashboards).toEqual([
      mappedDashboard(),
      mappedDashboard({
        dashboard_key: "alerts",
        display_name: "Alerts Dashboard",
        category: "operations",
        description:
          "Operational alerts across stock, production, and system readiness.",
        sort_order: 60,
        icon_identifier: "alerts",
        availability: "available",
      }),
    ] satisfies DashboardNavigationItem[]);
    expectReadOnly("get_reporting_home");
  });

  it("maps dashboard counts from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        total_dashboard_count: 8,
        available_section_count: 8,
        available_dashboards: [
          dashboardItem(),
          dashboardItem({
            dashboard_key: "kpi",
            display_name: "KPI Dashboard",
            sort_order: 20,
            icon_identifier: "kpi",
          }),
        ],
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    // Counts come from the RPC - never recomputed from nested arrays.
    expect(result.data?.total_dashboard_count).toBe(8);
    expect(result.data?.available_section_count).toBe(8);
    expect(result.data?.available_dashboards).toHaveLength(2);
    expectReadOnly("get_reporting_home");
  });

  it("maps reporting categories from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        reporting_categories: ["governance", "operations", "overview"],
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data?.reporting_categories).toEqual([
      "governance",
      "operations",
      "overview",
    ]);
    expect(result.data?.reporting_categories).toHaveLength(3);
    expectReadOnly("get_reporting_home");
  });

  it("maps last_generated_at from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        last_generated_at: "2026-07-25T18:30:00.000Z",
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data?.last_generated_at).toBe("2026-07-25T18:30:00.000Z");
    expectReadOnly("get_reporting_home");
  });

  it("maps application_reporting_version from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        application_reporting_version: "1.0",
      }),
      error: null,
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.error).toBeNull();
    expect(result.data?.application_reporting_version).toBe("1.0");
    expectReadOnly("get_reporting_home");
  });

  it("rejects invalid home payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const invalidShape = await reportingHomeService.getReportingHome();
    expect(invalidShape.data).toBeNull();
    expect(invalidShape.error).toBe("Reporting home response was invalid.");

    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        available_dashboards: "not-an-array",
      }),
      error: null,
    });

    const invalidDashboards = await reportingHomeService.getReportingHome();
    expect(invalidDashboards.data).toBeNull();
    expect(invalidDashboards.error).toBe(
      "Reporting home response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        reporting_categories: [""],
      }),
      error: null,
    });

    const invalidCategories = await reportingHomeService.getReportingHome();
    expect(invalidCategories.data).toBeNull();
    expect(invalidCategories.error).toBe(
      "Reporting home response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: homeRow({
        total_dashboard_count: -1,
      }),
      error: null,
    });

    const invalidCount = await reportingHomeService.getReportingHome();
    expect(invalidCount.data).toBeNull();
    expect(invalidCount.error).toBe("Reporting home response was invalid.");

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_reporting_home function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_reporting_home",
      },
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting home is not available yet. Apply the reporting home database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing reporting_home relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "reporting_home" does not exist',
      },
    });

    const result = await reportingHomeService.getReportingHome();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Reporting home is not available yet. Apply the reporting home database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow(),
      error: null,
    });

    await reportingHomeService.getReportingHome();

    expectReadOnly("get_reporting_home");
  });

  it("never queries reporting home source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: homeRow(),
      error: null,
    });

    await reportingHomeService.getReportingHome();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_home");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("dashboard_navigation");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "reporting_api_sections",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_api");
    expectNoDirectWrites();
  });
});
