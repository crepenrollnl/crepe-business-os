/**
 * UI coverage for the Composition -> DataBinding -> Widgets memo chain.
 *
 * Moved from reporting-dashboard/page/reporting-dashboard-performance.test.tsx
 * (feature-sprawl consolidation, 08.08.2026) -- only the component-level
 * memo-boundary describe block survived the move (its sibling pure-logic
 * describe block moved to reporting-dashboard-overview-equality.test.ts in
 * this same directory). The "workspace integration" describe block that
 * used to sit alongside these re-tested loading/error/nav-highlight/
 * read-only-ness already covered end to end by
 * reporting-workspace-page.test.tsx and by the composition/data-binding
 * component tests kept here -- dropped as duplicate, not moved.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardCards } from "./reporting-dashboard-cards";
import { ReportingDashboardComposition } from "./reporting-dashboard-composition";
import { ReportingDashboardDataBinding } from "./reporting-dashboard-data-binding";
import { ReportingDashboardWidgets } from "./widgets/reporting-dashboard-widgets";

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

describe("Reporting Dashboard performance memo boundaries (DEV-081 UI)", () => {
  afterEach(() => {
    cleanup();
  });

  it("preserves Composition identity on ReportingDashboardCards without an extra wrapper", () => {
    expect(ReportingDashboardCards).toBe(ReportingDashboardComposition);

    const data = overview();
    const { container: compositionContainer } = render(
      <ReportingDashboardComposition overview={data} />,
    );
    const compositionHtml = compositionContainer.innerHTML;
    cleanup();

    const { container: cardsContainer } = render(
      <ReportingDashboardCards overview={data} />,
    );

    expect(cardsContainer.innerHTML).toBe(compositionHtml);
    expect(
      cardsContainer.querySelectorAll(
        "section.rounded-xl.border.border-zinc-200.bg-white.shadow-sm",
      ),
    ).toHaveLength(1);
  });

  it("keeps Composition → DataBinding → Widgets memo boundaries on same overview identity", () => {
    const data = overview();

    const compositionView = render(
      <ReportingDashboardComposition overview={data} />,
    );
    const compositionPanel = screen
      .getByRole("heading", { name: "Reporting dashboards" })
      .closest("section");
    expect(compositionPanel).not.toBeNull();

    compositionView.rerender(<ReportingDashboardComposition overview={data} />);
    expect(
      screen.getByRole("heading", { name: "Reporting dashboards" }).closest(
        "section",
      ),
    ).toBe(compositionPanel);
    cleanup();

    const bindingView = render(<ReportingDashboardDataBinding overview={data} />);
    const bindingRegion = screen.getByRole("region", {
      name: "Bound reporting dashboard overview",
    });

    bindingView.rerender(<ReportingDashboardDataBinding overview={data} />);
    expect(
      screen.getByRole("region", {
        name: "Bound reporting dashboard overview",
      }),
    ).toBe(bindingRegion);
    cleanup();

    const widgetsView = render(<ReportingDashboardWidgets overview={data} />);
    const widgetList = screen.getByRole("list", {
      name: "Reporting dashboard section widgets",
    });

    widgetsView.rerender(<ReportingDashboardWidgets overview={data} />);
    expect(
      screen.getByRole("list", {
        name: "Reporting dashboard section widgets",
      }),
    ).toBe(widgetList);
  });

  it("updates the composition when overview identity changes", () => {
    const initial = overview();
    const { rerender } = render(
      <ReportingDashboardComposition overview={initial} />,
    );

    const executive = screen.getByRole("region", {
      name: "Executive Dashboard",
    });
    expect(within(executive).getByText("ok")).toBeInTheDocument();

    const next = overview({
      executive: {
        ...initial.executive,
        company_health: "critical",
      },
    });

    rerender(<ReportingDashboardComposition overview={next} />);

    const updatedExecutive = screen.getByRole("region", {
      name: "Executive Dashboard",
    });
    expect(within(updatedExecutive).getByText("critical")).toBeInTheDocument();
    expect(
      within(updatedExecutive).getByLabelText("Company Health: critical"),
    ).toBeInTheDocument();
  });
});
