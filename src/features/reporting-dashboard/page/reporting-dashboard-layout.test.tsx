/**
 * UI coverage for Reporting Dashboard layout polish.
 */

import {
  act,
  cleanup,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { ReportingWorkspace } from "@/features/reporting-workspace/types/reporting-workspace";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardComposition } from "../components/reporting-dashboard-composition";
import { ReportingDashboardEmptyOverview } from "../components/reporting-dashboard-empty-overview";
import { ReportingDashboardPanel } from "../components/reporting-dashboard-panel";

const PANEL_SHELL_CLASSES = [
  "rounded-xl",
  "border",
  "border-zinc-200",
  "bg-white",
  "shadow-sm",
] as const;

const PANEL_HEADER_CLASSES = ["border-b", "border-zinc-200", "px-4", "py-4", "sm:px-6"] as const;

const PANEL_BODY_CLASSES = ["px-4", "py-5", "sm:px-6", "sm:py-6"] as const;

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

vi.mock("@/features/auth/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/features/reporting-workspace/services/reporting-workspace-service", () => ({
  reportingWorkspaceService: {
    getReportingWorkspace: (...args: unknown[]) =>
      getReportingWorkspaceMock(...args),
  },
}));

import { ReportingDashboardPage } from "./reporting-dashboard-page";

function expectClassTokens(element: Element, tokens: readonly string[]) {
  for (const token of tokens) {
    expect(element.classList.contains(token)).toBe(true);
  }
}

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
    navigation_catalog: [navigationItem()],
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

describe("ReportingDashboardPanel (DEV-080 UI)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the shared panel with accessible header and body", () => {
    render(
      <ReportingDashboardPanel
        headingId="layout-panel-heading"
        title="Reporting dashboards"
        description="Panel description"
      >
        <p>Panel body</p>
      </ReportingDashboardPanel>,
    );

    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Reporting dashboards",
    });
    expect(heading).toHaveAttribute("id", "layout-panel-heading");

    const panel = heading.closest("section");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-labelledby", "layout-panel-heading");
    expectClassTokens(panel as HTMLElement, PANEL_SHELL_CLASSES);

    const header = heading.parentElement;
    expect(header).not.toBeNull();
    expectClassTokens(header as HTMLElement, PANEL_HEADER_CLASSES);
    expect(within(header as HTMLElement).getByText("Panel description")).toBeInTheDocument();

    const body = screen.getByText("Panel body").parentElement;
    expect(body).not.toBeNull();
    expectClassTokens(body as HTMLElement, PANEL_BODY_CLASSES);
  });

  it("keeps composition and empty overview on the same panel spacing scale", () => {
    const { container: compositionContainer } = render(
      <ReportingDashboardComposition overview={overview()} />,
    );
    const compositionPanel = compositionContainer.querySelector("section");
    expect(compositionPanel).not.toBeNull();
    expectClassTokens(compositionPanel as HTMLElement, PANEL_SHELL_CLASSES);

    const compositionHeader = compositionPanel?.querySelector(":scope > div");
    const compositionBody = compositionPanel?.querySelector(":scope > div:last-child");
    expect(compositionHeader).not.toBeNull();
    expect(compositionBody).not.toBeNull();
    expectClassTokens(compositionHeader as HTMLElement, PANEL_HEADER_CLASSES);
    expectClassTokens(compositionBody as HTMLElement, PANEL_BODY_CLASSES);
    cleanup();

    const { container: emptyContainer } = render(
      <ReportingDashboardEmptyOverview />,
    );
    const emptyPanel = emptyContainer.querySelector("section");
    expect(emptyPanel).not.toBeNull();
    expectClassTokens(emptyPanel as HTMLElement, PANEL_SHELL_CLASSES);

    const emptyHeader = emptyPanel?.querySelector(":scope > div");
    const emptyBody = emptyPanel?.querySelector(":scope > div:last-child");
    expect(emptyHeader).not.toBeNull();
    expect(emptyBody).not.toBeNull();
    expectClassTokens(emptyHeader as HTMLElement, PANEL_HEADER_CLASSES);
    expectClassTokens(emptyBody as HTMLElement, PANEL_BODY_CLASSES);

    expect((compositionPanel as HTMLElement).className).toBe(
      (emptyPanel as HTMLElement).className,
    );
    expect((compositionHeader as HTMLElement).className).toBe(
      (emptyHeader as HTMLElement).className,
    );
    expect((compositionBody as HTMLElement).className).toBe(
      (emptyBody as HTMLElement).className,
    );
  });

  it("does not nest duplicate ReportingDashboardPanel wrappers", () => {
    const { container } = render(
      <ReportingDashboardComposition overview={overview()} />,
    );

    const panels = container.querySelectorAll(
      "section.rounded-xl.border.border-zinc-200.bg-white.shadow-sm",
    );
    expect(panels).toHaveLength(1);

    expect(
      screen.getAllByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      }),
    ).toHaveLength(1);
  });

  it("keeps responsive container tokens on the shared panel", () => {
    render(
      <ReportingDashboardPanel headingId="responsive-panel" title="Reporting dashboards">
        <p>Body</p>
      </ReportingDashboardPanel>,
    );

    const panel = screen
      .getByRole("heading", { name: "Reporting dashboards" })
      .closest("section");
    expect(panel).not.toBeNull();

    const header = panel?.querySelector(":scope > div");
    const body = panel?.querySelector(":scope > div:last-child");
    expect(header?.className).toContain("sm:px-6");
    expect(body?.className).toContain("sm:px-6");
    expect(body?.className).toContain("sm:py-6");
  });
});

describe("Reporting Dashboard layout workspace integration (DEV-080 UI)", () => {
  beforeEach(() => {
    getReportingWorkspaceMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a single shared panel inside the Workspace host when overview exists", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    const dashboardHeading = screen.getByRole("heading", {
      level: 3,
      name: "Reporting dashboards",
    });
    expect(dashboardHeading).toHaveAttribute("id", "reporting-dashboards-heading");

    const panel = dashboardHeading.closest("section");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute(
      "aria-labelledby",
      "reporting-dashboards-heading",
    );
    expectClassTokens(panel as HTMLElement, PANEL_SHELL_CLASSES);

    expect(
      screen.getAllByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      }),
    ).toHaveLength(1);

    expect(
      screen.getByRole("region", {
        name: "Bound reporting dashboard overview",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Reporting Workspace",
      }),
    ).toBeInTheDocument();
  });

  it("uses the shared panel for empty overview while loading/error stay on Workspace host", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace({
        reporting_overview: null,
        available_dashboards: [],
        navigation_catalog: [],
      }),
      error: null,
    });

    await renderSettled();

    const emptyHeading = screen.getByRole("heading", {
      level: 3,
      name: "Reporting dashboards",
    });
    expect(emptyHeading).toHaveAttribute(
      "id",
      "reporting-dashboards-empty-heading",
    );
    const emptyPanel = emptyHeading.closest("section");
    expect(emptyPanel).not.toBeNull();
    expectClassTokens(emptyPanel as HTMLElement, PANEL_SHELL_CLASSES);
    expect(
      screen.getByText("No reporting dashboard cards are available yet."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", {
        name: "Bound reporting dashboard overview",
      }),
    ).not.toBeInTheDocument();
    cleanup();

    let resolveRequest:
      | ((
          _payload: {
            data: ReportingWorkspace | null;
            error: string | null;
          },
        ) => void)
      | undefined;

    getReportingWorkspaceMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<ReportingDashboardPage />);

    const loading = screen.getByRole("status");
    expect(loading).toHaveTextContent(/loading reporting workspace/i);
    expect(loading).toHaveAttribute("aria-live", "polite");
    expect(
      screen.queryByRole("heading", { name: "Reporting dashboards" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveRequest?.({
        data: null,
        error: "Failed to load reporting workspace",
      });
      await Promise.resolve();
    });
    cleanup();

    getReportingWorkspaceMock.mockResolvedValue({
      data: null,
      error: "Failed to load reporting workspace",
    });

    await renderSettled();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not load reporting workspace");
    expect(
      screen.queryByRole("heading", { name: "Reporting dashboards" }),
    ).not.toBeInTheDocument();
  });

  it("preserves accessibility landmarks for the polished layout", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: workspace(),
      error: null,
    });

    await renderSettled();

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", {
        name: "Bound reporting dashboard overview",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBeInTheDocument();

    const dashboardPanel = screen
      .getByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      })
      .closest("section");
    expect(dashboardPanel).not.toBeNull();
    const timestamp = (dashboardPanel as HTMLElement).querySelector("time");
    expect(timestamp).not.toBeNull();
    expect(timestamp).toHaveAttribute("dateTime", "2026-07-25T16:00:00.000Z");
    expect(timestamp).toHaveTextContent(
      formatDateTime("2026-07-25T16:00:00.000Z"),
    );

    const reportsLink = screen.getByRole("link", { name: "Reports" });
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
