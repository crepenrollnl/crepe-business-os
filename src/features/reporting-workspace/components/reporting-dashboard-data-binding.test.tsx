/**
 * UI coverage for ReportingDashboardDataBinding.
 *
 * Moved from reporting-dashboard/page/reporting-dashboard-data-binding.test.tsx
 * (feature-sprawl consolidation, 08.08.2026) -- only the component-level
 * describe block survived the move. Its sibling "workspace integration"
 * describe block re-tested loading/error/nav-highlight/read-only-ness
 * already covered end to end by reporting-workspace-page.test.tsx, and its
 * "renders dashboard cards from Reporting API overview values as-is" style
 * checks were already a strict subset of the DTO-mapping test kept here --
 * dropped as duplicate, not moved.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardComposition } from "./reporting-dashboard-composition";
import { ReportingDashboardDataBinding } from "./reporting-dashboard-data-binding";

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

describe("ReportingDashboardDataBinding (DEV-079 UI)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the bound overview region with generated_at as-is", () => {
    const data = overview();
    render(<ReportingDashboardDataBinding overview={data} />);

    const binding = screen.getByRole("region", {
      name: "Bound reporting dashboard overview",
    });
    expect(binding).toHaveAttribute(
      "data-reporting-generated-at",
      "2026-07-25T16:00:00.000Z",
    );
    expect(
      within(binding).getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBeInTheDocument();
  });

  it("maps ReportingOverview DTO fields onto section widgets as-is", () => {
    render(<ReportingDashboardDataBinding overview={overview()} />);

    const executive = screen.getByRole("region", {
      name: "Executive Dashboard",
    });
    expect(within(executive).getByText("Company Health")).toBeInTheDocument();
    expect(within(executive).getByText("ok")).toBeInTheDocument();
    expect(within(executive).getByText("Inventory Value")).toBeInTheDocument();
    expect(within(executive).getByText("100")).toBeInTheDocument();
    expect(within(executive).getByText("Total Purchases")).toBeInTheDocument();
    expect(within(executive).getByText("3")).toBeInTheDocument();
    expect(within(executive).getByText("Sales Growth")).toBeInTheDocument();
    expect(within(executive).getByText("5.5")).toBeInTheDocument();

    const kpi = screen.getByRole("region", { name: "KPI Dashboard" });
    expect(within(kpi).getByText("Gross Revenue")).toBeInTheDocument();
    expect(within(kpi).getByText("1250")).toBeInTheDocument();
    expect(within(kpi).getByText("Inventory Turnover")).toBeInTheDocument();

    const company = screen.getByRole("region", { name: "Company Dashboard" });
    expect(within(company).getByText("Total Suppliers")).toBeInTheDocument();
    expect(within(company).getByText("4")).toBeInTheDocument();
    expect(within(company).getByText("Total Recipes")).toBeInTheDocument();

    const inventory = screen.getByRole("region", {
      name: "Inventory Dashboard",
    });
    expect(within(inventory).getByText("Total Ingredients")).toBeInTheDocument();
    expect(within(inventory).getByText("12")).toBeInTheDocument();
    expect(
      within(inventory).getByText("Total Inventory Value"),
    ).toBeInTheDocument();

    const production = screen.getByRole("region", {
      name: "Production Dashboard",
    });
    expect(within(production).getByText("Completed Batches")).toBeInTheDocument();
    expect(within(production).getByText("5")).toBeInTheDocument();
    expect(
      within(production).getByText("Average Batch Duration"),
    ).toBeInTheDocument();

    const alerts = screen.getByRole("region", { name: "Alerts Dashboard" });
    expect(within(alerts).getByText("Low Stock Alerts")).toBeInTheDocument();
    expect(within(alerts).getByText("Declining Sales")).toBeInTheDocument();
    expect(
      within(alerts).getByLabelText("Declining Sales: false"),
    ).toBeInTheDocument();
    expect(within(alerts).getByText("Backup Status")).toBeInTheDocument();

    const audit = screen.getByRole("region", { name: "Audit Dashboard" });
    expect(within(audit).getByText("Total Audit Events")).toBeInTheDocument();
    expect(within(audit).getByText("20")).toBeInTheDocument();
    expect(within(audit).getByText("Failed Operations")).toBeInTheDocument();
    expect(within(audit).getByText("2")).toBeInTheDocument();

    const userActivity = screen.getByRole("region", {
      name: "User Activity Dashboard",
    });
    expect(within(userActivity).getByText("Most Active User")).toBeInTheDocument();
    expect(within(userActivity).getByText("Ada Admin")).toBeInTheDocument();
    expect(
      within(userActivity).getByText("Average Actions Per User"),
    ).toBeInTheDocument();
  });

  it("renders null DTO values as presentation dashes", () => {
    const data = overview();
    render(
      <ReportingDashboardDataBinding
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
    expect(within(executive).getByLabelText("Sales Growth: -")).toBeInTheDocument();
    expect(within(executive).getAllByText("-").length).toBeGreaterThan(0);

    const userActivity = screen.getByRole("region", {
      name: "User Activity Dashboard",
    });
    expect(
      within(userActivity).getByLabelText("Most Active User: -"),
    ).toBeInTheDocument();
  });

  it("exposes accessible labels for bound metrics and composition time", () => {
    render(<ReportingDashboardComposition overview={overview()} />);

    expect(
      screen.getByRole("region", {
        name: "Bound reporting dashboard overview",
      }),
    ).toBeInTheDocument();

    const timestamp = screen.getByText(formatDateTime("2026-07-25T16:00:00.000Z"));
    expect(timestamp.tagName).toBe("TIME");
    expect(timestamp).toHaveAttribute("dateTime", "2026-07-25T16:00:00.000Z");

    expect(
      screen.getByLabelText("Company Health: ok"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Gross Revenue: 1250")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Most Active User: Ada Admin"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Reporting dashboards",
      }),
    ).toBeInTheDocument();
  });
});
