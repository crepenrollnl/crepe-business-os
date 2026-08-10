/**
 * UI coverage for ReportingDashboardComposition.
 *
 * Moved from reporting-dashboard/page/reporting-dashboard-widgets.test.tsx
 * (feature-sprawl consolidation, 08.08.2026) -- only the component-level
 * describe block survived the move. Its sibling "workspace integration"
 * describe block re-tested loading/error/nav-highlight/read-only-ness
 * already covered end to end by reporting-workspace-page.test.tsx and was
 * dropped as duplicate, not moved.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardCards } from "./reporting-dashboard-cards";
import { ReportingDashboardComposition } from "./reporting-dashboard-composition";

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
    expect(
      screen.getByText(formatDateTime("2026-07-25T16:00:00.000Z")),
    ).toBeInTheDocument();
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
