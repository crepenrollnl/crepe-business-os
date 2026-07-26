/**
 * UI coverage for ReportingWorkspacePage (DEV-076).
 *
 * Uses reportingWorkspaceService.getReportingWorkspace only.
 * Renders SQL-provided workspace fields as-is - no calculations.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReportingWorkspace } from "../types/reporting-workspace";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

const { getReportingWorkspaceMock, fromMock, rpcMock } = vi.hoisted(() => ({
  getReportingWorkspaceMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
    className?: string;
    "aria-current"?: "page";
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

vi.mock("@/features/search/components/global-search", () => ({
  GlobalSearch: () => <div data-testid="global-search" />,
}));

vi.mock("../services/reporting-workspace-service", () => ({
  reportingWorkspaceService: {
    getReportingWorkspace: (...args: unknown[]) =>
      getReportingWorkspaceMock(...args),
  },
}));

import { ReportingWorkspacePage } from "./reporting-workspace-page";
import { ReportingWorkspaceEmptyState } from "../components/reporting-workspace-empty-state";

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

function overview(overrides?: Partial<ReportingOverview>): ReportingOverview {
  return {
    generated_at: "2026-07-25T16:00:00.000Z",
    sections: [
      {
        section_name: "executive",
        title: "Executive Dashboard",
        source_view: "executive_dashboard",
        source_rpc: "get_executive_dashboard",
      },
      {
        section_name: "alerts",
        title: "Alerts Dashboard",
        source_view: "alerts_dashboard",
        source_rpc: "get_alerts_dashboard",
      },
    ],
    executive: {
      company_health: "ok",
      inventory_value: 100,
      low_stock_count: 1,
      total_sales: 2,
      total_purchases: 3,
      total_batches: 4,
      sales_growth: 5.5,
      last_sale_date: null,
      last_purchase_date: null,
      last_production_date: null,
    },
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
    company: {
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
    },
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

function workspace(overrides?: Partial<ReportingWorkspace>): ReportingWorkspace {
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
    reporting_overview: overview(),
    generated_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSettled() {
  const view = render(<ReportingWorkspacePage />);
  await flushMicrotasks();
  return view;
}

describe("ReportingWorkspacePage (DEV-076 UI)", () => {
  beforeEach(() => {
    getReportingWorkspaceMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state while the workspace request is pending", async () => {
    let resolveRequest:
      | ((value: { data: ReportingWorkspace | null; error: string | null }) => void)
      | undefined;

    getReportingWorkspaceMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<ReportingWorkspacePage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /loading reporting workspace/i,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Reports",
    );

    await act(async () => {
      resolveRequest?.({ data: workspace(), error: null });
      await Promise.resolve();
    });
  });

  it("renders the workspace successfully with header, navigation, and overview", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Reporting Workspace",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(
      screen.getAllByText("2026-07-25T16:00:00.000Z").length,
    ).toBeGreaterThan(0);

    expect(
      screen.getByRole("heading", { name: "Dashboard navigation" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Executive Dashboard").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Alerts Dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("operations")).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Reporting overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("executive_dashboard")).toBeInTheDocument();
    expect(screen.getByText("get_alerts_dashboard")).toBeInTheDocument();

    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it("renders workspace header fields from the service payload as-is", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        workspace_title: "Reporting Workspace",
        reporting_version: "1.0",
        generated_at: "2026-07-25T18:45:00.000Z",
      }),
      error: null,
    });

    await renderSettled();

    expect(
      screen.getByRole("heading", { level: 2, name: "Reporting Workspace" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("1.0")).toBeInTheDocument();
    expect(screen.getByText("Generated")).toBeInTheDocument();
    expect(screen.getByText("2026-07-25T18:45:00.000Z")).toBeInTheDocument();
  });

  it("renders navigation catalog rows without recalculation", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        navigation_catalog: [
          navigationItem({
            dashboard_key: "audit",
            display_name: "Audit Dashboard",
            category: "governance",
            description: "Audit activity volume, failures, and domain event mix.",
            sort_order: 70,
            icon_identifier: "audit",
            availability: "available",
          }),
        ],
      }),
      error: null,
    });

    await renderSettled();

    const navigation = screen
      .getByRole("heading", { name: "Dashboard navigation" })
      .closest("section");
    expect(navigation).not.toBeNull();

    const section = navigation as HTMLElement;
    expect(within(section).getByText("Audit Dashboard")).toBeInTheDocument();
    expect(within(section).getAllByText("audit")).toHaveLength(2);
    expect(within(section).getByText("governance")).toBeInTheDocument();
    expect(within(section).getByText("70")).toBeInTheDocument();
    expect(within(section).getByText("available")).toBeInTheDocument();
  });

  it("renders reporting overview sections without recalculation", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        reporting_overview: overview({
          generated_at: "2026-07-25T16:00:00.000Z",
          sections: [
            {
              section_name: "kpi",
              title: "KPI Dashboard",
              source_view: "kpi_dashboard",
              source_rpc: "get_kpi_dashboard",
            },
          ],
        }),
      }),
      error: null,
    });

    await renderSettled();

    const overviewSection = screen
      .getByRole("heading", { name: "Reporting overview" })
      .closest("section");
    expect(overviewSection).not.toBeNull();

    const section = overviewSection as HTMLElement;
    expect(
      within(section).getByText("2026-07-25T16:00:00.000Z"),
    ).toBeInTheDocument();
    expect(within(section).getByText("kpi")).toBeInTheDocument();
    expect(within(section).getByText("KPI Dashboard")).toBeInTheDocument();
    expect(within(section).getByText("kpi_dashboard")).toBeInTheDocument();
    expect(within(section).getByText("get_kpi_dashboard")).toBeInTheDocument();
  });

  it("shows empty navigation and overview messages when catalogs are empty", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        available_dashboards: [],
        navigation_catalog: [],
        reporting_overview: null,
      }),
      error: null,
    });

    await renderSettled();

    expect(
      screen.getByText("No dashboard navigation entries are available yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No reporting overview is available yet."),
    ).toBeInTheDocument();
  });

  it("renders the empty state component copy for an empty workspace shell", () => {
    render(<ReportingWorkspaceEmptyState />);

    expect(
      screen.getByText("No reporting workspace data yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Workspace metadata will appear once reporting foundations are available.",
      ),
    ).toBeInTheDocument();
  });

  it("shows error state with accessibility alert and retry", async () => {
    getReportingWorkspaceMock
      .mockResolvedValueOnce({
        data: null,
        error: "Failed to load reporting workspace",
      })
      .mockResolvedValueOnce({
        data: workspace(),
        error: null,
      });

    await renderSettled();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load reporting workspace");
    expect(alert).toHaveTextContent("Failed to load reporting workspace");

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await flushMicrotasks();

    expect(
      screen.getByRole("heading", { level: 2, name: "Reporting Workspace" }),
    ).toBeInTheDocument();
    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(2);
  });

  it("highlights the active Reports navigation item", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    const reportsLink = screen.getByRole("link", { name: "Reports" });
    expect(reportsLink).toHaveAttribute("href", "/reports");
    expect(reportsLink).toHaveAttribute("aria-current", "page");

    const inventoryLink = screen.getByRole("link", { name: "Inventory" });
    expect(inventoryLink).not.toHaveAttribute("aria-current");
  });

  it("exposes loading and error accessibility attributes", async () => {
    let resolveRequest:
      | ((value: { data: ReportingWorkspace | null; error: string | null }) => void)
      | undefined;

    getReportingWorkspaceMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<ReportingWorkspacePage />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");

    await act(async () => {
      resolveRequest?.({
        data: null,
        error: "Reporting workspace is not available yet.",
      });
      await Promise.resolve();
    });
    await flushMicrotasks();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("is read-only and only calls getReportingWorkspace", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(getReportingWorkspaceMock).toHaveBeenCalledWith();
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
