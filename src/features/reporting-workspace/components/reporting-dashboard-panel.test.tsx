/**
 * UI coverage for ReportingDashboardPanel.
 *
 * Moved from reporting-dashboard/page/reporting-dashboard-layout.test.tsx
 * (feature-sprawl consolidation, 08.08.2026) -- only the component-level
 * describe block survived the move. Its sibling "workspace integration"
 * describe block re-tested loading/error/nav-highlight/read-only-ness and
 * accessibility landmarks already covered end to end by
 * reporting-workspace-page.test.tsx and by the component-level tests kept
 * here -- dropped as duplicate, not moved. See
 * reporting-workspace-page.test.tsx's "shows empty navigation and overview
 * messages when catalogs are empty" test, which now also asserts the
 * dashboard-cards empty copy this file's dropped integration test used to
 * be the only place checking.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardComposition } from "./reporting-dashboard-composition";
import { ReportingDashboardEmptyOverview } from "./reporting-dashboard-empty-overview";
import { ReportingDashboardPanel } from "./reporting-dashboard-panel";

const PANEL_SHELL_CLASSES = [
  "rounded-xl",
  "border",
  "border-zinc-200",
  "bg-white",
  "shadow-sm",
] as const;

const PANEL_HEADER_CLASSES = ["border-b", "border-zinc-200", "px-4", "py-4", "sm:px-6"] as const;

const PANEL_BODY_CLASSES = ["px-4", "py-5", "sm:px-6", "sm:py-6"] as const;

function expectClassTokens(element: Element, tokens: readonly string[]) {
  for (const token of tokens) {
    expect(element.classList.contains(token)).toBe(true);
  }
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
