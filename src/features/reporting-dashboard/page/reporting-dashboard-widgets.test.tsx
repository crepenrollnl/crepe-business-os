/**
 * UI coverage for Reporting Dashboard widgets composition (DEV-078).
 *
 * Verifies the final composition hosted by the approved Reporting Workspace.
 * Uses reportingWorkspaceService.getReportingWorkspace only.
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
import type { ReportingWorkspace } from "@/features/reporting-workspace/types/reporting-workspace";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardComposition } from "../components/reporting-dashboard-composition";
import { ReportingDashboardCards } from "../components/reporting-dashboard-cards";

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

vi.mock("@/features/reporting-workspace/services/reporting-workspace-service", () => ({
  reportingWorkspaceService: {
    getReportingWorkspace: (...args: unknown[]) =>
      getReportingWorkspaceMock(...args),
  },
}));

import { ReportingDashboardPage } from "./reporting-dashboard-page";

const WIDGET_ORDER = [
  "Executive Dashboard",
  "KPI Dashboard",
  "Company Dashboard",
  "Inventory Dashboard",
  "Production Dashboard",
  "Alerts Dashboard",
  "Audit Dashboard",
  "User Activity Dashboard",
] as const;

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
      gross_revenue: 1250,
      total_orders: 10,
      average_order_value: 125,
      inventory_turnover: null,
      recipe_cost_average: null,
      supplier_count: 0,
      customer_count: 0,
      production_efficiency: null,
      low_stock_ratio: null,
      sales_growth: null,
    },
    company: {
      total_suppliers: 4,
      total_customers: 8,
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
      total_ingredients: 12,
      low_stock_count: 3,
      out_of_stock_count: 1,
      total_inventory_value: 0,
      last_purchase_date: null,
      last_production_date: null,
    },
    production: {
      total_batches: 6,
      completed_batches: 5,
      failed_batches: 0,
      total_finished_goods: 0,
      last_production_date: null,
      average_batch_duration: null,
    },
    audit: {
      total_audit_events: 20,
      events_today: 0,
      events_last_7_days: 0,
      failed_operations: 2,
      user_activity_count: 0,
      production_events: 0,
      inventory_events: 0,
      sales_events: 0,
      purchase_events: 0,
      last_audit_event_at: null,
    },
    user_activity: {
      active_users_today: 3,
      active_users_last_7_days: 0,
      total_user_actions: 0,
      production_actions: 0,
      inventory_actions: 0,
      purchase_actions: 0,
      sales_actions: 0,
      last_user_activity_at: null,
      most_active_user: "Ada Admin",
      average_actions_per_user: null,
    },
    alerts: {
      low_stock_alerts: 3,
      out_of_stock_alerts: 0,
      overdue_production: 0,
      failed_batches: 0,
      stale_purchase_prices: 0,
      inactive_suppliers: 0,
      declining_sales: false,
      missing_company_settings: false,
      backup_status: "ok",
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
  const view = render(<ReportingDashboardPage />);
  await flushMicrotasks();
  return view;
}

describe("ReportingDashboardComposition (DEV-078 UI)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the final composition with overview timestamp as-is", () => {
    render(<ReportingDashboardComposition overview={overview()} />);

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-07-25T16:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("Company Health")).toBeInTheDocument();
    expect(screen.getByText("Gross Revenue")).toBeInTheDocument();
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
  });

  it("renders section widgets in the approved composition order", () => {
    render(<ReportingDashboardComposition overview={overview()} />);

    const widgetList = screen.getByRole("list", {
      name: "Reporting dashboard section widgets",
    });
    const headings = within(widgetList)
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);

    expect(headings).toEqual([...WIDGET_ORDER]);
  });

  it("exposes accessible landmarks for composition and widgets", () => {
    render(<ReportingDashboardComposition overview={overview()} />);

    const composition = screen
      .getByRole("heading", { name: "Reporting dashboards" })
      .closest("section");
    expect(composition).not.toBeNull();
    expect(composition).toHaveAttribute(
      "aria-labelledby",
      "reporting-dashboards-heading",
    );

    expect(
      screen.getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(WIDGET_ORDER.length);

    for (const title of WIDGET_ORDER) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 4, name: title }),
      ).toBeInTheDocument();
    }
  });

  it("displays null metric values as presentation dash", () => {
    const data = overview();
    render(
      <ReportingDashboardComposition
        overview={overview({
          executive: {
            ...data.executive,
            sales_growth: null,
          },
          user_activity: {
            ...data.user_activity,
            most_active_user: null,
          },
        })}
      />,
    );

    const executive = screen.getByRole("region", {
      name: "Executive Dashboard",
    });
    expect(within(executive).getByText("Sales Growth")).toBeInTheDocument();
    expect(within(executive).getAllByText("-").length).toBeGreaterThan(0);

    const userActivity = screen.getByRole("region", {
      name: "User Activity Dashboard",
    });
    expect(within(userActivity).getByText("Most Active User")).toBeInTheDocument();
    expect(within(userActivity).getAllByText("-").length).toBeGreaterThan(0);
  });

  it("keeps ReportingDashboardCards as the Workspace-compatible composition host", () => {
    const { container: compositionContainer } = render(
      <ReportingDashboardComposition overview={overview()} />,
    );
    const compositionHtml = compositionContainer.innerHTML;
    cleanup();

    const { container: cardsContainer } = render(
      <ReportingDashboardCards overview={overview()} />,
    );

    expect(cardsContainer.innerHTML).toBe(compositionHtml);
  });
});

describe("Reporting Dashboard widgets workspace integration (DEV-078 UI)", () => {
  beforeEach(() => {
    getReportingWorkspaceMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("integrates the widgets composition into the Workspace page host", async () => {
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
    expect(
      screen.getByRole("heading", { name: "Reporting dashboards" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dashboard navigation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reporting overview" }),
    ).toBeInTheDocument();

    const widgetList = screen.getByRole("list", {
      name: "Reporting dashboard section widgets",
    });
    const headings = within(widgetList)
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual([...WIDGET_ORDER]);
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

    render(<ReportingDashboardPage />);

    expect(screen.getByRole("status")).toHaveTextContent(
      /loading reporting workspace/i,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(
      screen.queryByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveRequest?.({ data: workspace(), error: null });
      await Promise.resolve();
    });
  });

  it("shows empty dashboard composition when overview is unavailable", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        available_dashboards: [],
        navigation_catalog: [],
        reporting_overview: null,
      }),
      error: null,
    });

    await renderSettled();

    const empty = screen
      .getByRole("heading", { name: "Reporting dashboards" })
      .closest("section");
    expect(empty).not.toBeNull();
    expect(empty).toHaveAttribute(
      "aria-labelledby",
      "reporting-dashboards-empty-heading",
    );
    expect(
      screen.getByText("No reporting dashboard cards are available yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await flushMicrotasks();

    expect(
      screen.getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBeInTheDocument();
    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(2);
  });

  it("highlights active Reports navigation for accessibility", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    const reportsLink = screen.getByRole("link", { name: "Reports" });
    expect(reportsLink).toHaveAttribute("href", "/reports");
    expect(reportsLink).toHaveAttribute("aria-current", "page");
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
    expect(
      screen.queryByRole("button", { name: /save|edit|delete|create/i }),
    ).not.toBeInTheDocument();
  });
});
