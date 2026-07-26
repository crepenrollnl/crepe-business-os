/**
 * Service-level coverage for dashboardNavigationService (DEV-073).
 *
 * Reads must go only through get_dashboard_navigation RPC.
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

import { dashboardNavigationService } from "./dashboard-navigation-service";
import type {
  DashboardNavigationCatalog,
  DashboardNavigationItem,
} from "../types/dashboard-navigation";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function navigationRow(overrides?: Record<string, unknown>) {
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

function mappedItem(
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

describe("dashboardNavigationService.getDashboardNavigation (DEV-073)", () => {
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

  it("retrieves dashboard navigation catalog successfully via get_dashboard_navigation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow(),
        navigationRow({
          dashboard_key: "kpi",
          display_name: "KPI Dashboard",
          category: "overview",
          description:
            "Core business KPIs across revenue, inventory, and operations.",
          sort_order: 20,
          icon_identifier: "kpi",
          availability: "available",
        }),
      ],
      error: null,
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_dashboard_navigation");
    expectReadOnly("get_dashboard_navigation");
  });

  it("returns an empty catalog when navigation has no rows", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([] satisfies DashboardNavigationCatalog);
    expectReadOnly("get_dashboard_navigation");
  });

  it("maps RPC rows to typed DashboardNavigationItem DTOs", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow({
          dashboard_key: "inventory",
          display_name: "Inventory Dashboard",
          category: "operations",
          description:
            "Ingredient stock levels, valuation, and purchase freshness.",
          sort_order: 40,
          icon_identifier: "inventory",
          availability: "available",
        }),
      ],
      error: null,
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      mappedItem({
        dashboard_key: "inventory",
        display_name: "Inventory Dashboard",
        category: "operations",
        description:
          "Ingredient stock levels, valuation, and purchase freshness.",
        sort_order: 40,
        icon_identifier: "inventory",
        availability: "available",
      }),
    ] satisfies DashboardNavigationCatalog);
    expectReadOnly("get_dashboard_navigation");
  });

  it("maps availability values from SQL without transformation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow({
          dashboard_key: "audit",
          display_name: "Audit Dashboard",
          category: "governance",
          sort_order: 70,
          icon_identifier: "audit",
          availability: "available",
        }),
        navigationRow({
          dashboard_key: "user_activity",
          display_name: "User Activity Dashboard",
          category: "governance",
          description: "Attributed user activity and usage concentration.",
          sort_order: 80,
          icon_identifier: "user-activity",
          availability: "unavailable",
        }),
      ],
      error: null,
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.error).toBeNull();
    expect(result.data?.map((item) => item.availability)).toEqual([
      "available",
      "unavailable",
    ]);
    expectReadOnly("get_dashboard_navigation");
  });

  it("maps category and sort_order from SQL without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow({
          dashboard_key: "alerts",
          display_name: "Alerts Dashboard",
          category: "operations",
          description:
            "Operational alerts across stock, production, and system readiness.",
          sort_order: "60",
          icon_identifier: "alerts",
        }),
        navigationRow({
          dashboard_key: "company",
          display_name: "Company Dashboard",
          category: "overview",
          description: "Company-wide master-data and activity totals.",
          sort_order: 30,
          icon_identifier: "company",
        }),
      ],
      error: null,
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.error).toBeNull();
    // Catalog order and values come from the RPC - never recomputed.
    expect(
      result.data?.map((item) => ({
        dashboard_key: item.dashboard_key,
        category: item.category,
        sort_order: item.sort_order,
      })),
    ).toEqual([
      {
        dashboard_key: "alerts",
        category: "operations",
        sort_order: 60,
      },
      {
        dashboard_key: "company",
        category: "overview",
        sort_order: 30,
      },
    ]);
    expectReadOnly("get_dashboard_navigation");
  });

  it("rejects invalid catalog payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {},
      error: null,
    });

    const invalidShape =
      await dashboardNavigationService.getDashboardNavigation();
    expect(invalidShape.data).toBeNull();
    expect(invalidShape.error).toBe(
      "Dashboard navigation response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow({
          dashboard_key: "",
        }),
      ],
      error: null,
    });

    const invalidItem =
      await dashboardNavigationService.getDashboardNavigation();
    expect(invalidItem.data).toBeNull();
    expect(invalidItem.error).toBe(
      "Dashboard navigation response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: [
        navigationRow({
          sort_order: 10.5,
        }),
      ],
      error: null,
    });

    const invalidSort =
      await dashboardNavigationService.getDashboardNavigation();
    expect(invalidSort.data).toBeNull();
    expect(invalidSort.error).toBe(
      "Dashboard navigation response was invalid.",
    );

    expect(supabaseMock.from).not.toHaveBeenCalled();
    expectNoDirectWrites();
  });

  it("maps missing get_dashboard_navigation function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_dashboard_navigation",
      },
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Dashboard navigation is not available yet. Apply the dashboard navigation database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing dashboard_navigation relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "dashboard_navigation" does not exist',
      },
    });

    const result = await dashboardNavigationService.getDashboardNavigation();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Dashboard navigation is not available yet. Apply the dashboard navigation database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [navigationRow()],
      error: null,
    });

    await dashboardNavigationService.getDashboardNavigation();

    expectReadOnly("get_dashboard_navigation");
  });

  it("never queries dashboard navigation source tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [navigationRow()],
      error: null,
    });

    await dashboardNavigationService.getDashboardNavigation();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("dashboard_navigation");
    expect(supabaseMock.from).not.toHaveBeenCalledWith(
      "reporting_api_sections",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("reporting_api");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("executive_dashboard");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("kpi_dashboard");
    expectNoDirectWrites();
  });
});
