/**
 * Dashboard resilience composition coverage (DEV-126.1).
 *
 * UI composition only — no service changes.
 */

import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardInfo } from "../components/dashboard-info";
import { DashboardLowStockAlertsSection } from "../components/dashboard-low-stock-alerts-section";
import { buildDashboardCompletion } from "./dashboard-completion-builder";
import {
  classifyDashboardLoadFailure,
  createUnavailableModulesReadModel,
  dedupeInformationalMessages,
} from "./dashboard-resilience";

describe("dashboard-resilience (DEV-126.1)", () => {
  it("classifies missing Shift failures as shift-owned", () => {
    const classified = classifyDashboardLoadFailure(
      "Failed to load active shift from shifts table",
    );

    expect(classified.owner).toBe("shift");
    expect(classified.userMessage).toMatch(/Shift information/i);
    expect(classified.userMessage).not.toMatch(/shifts table/i);
  });

  it("classifies missing Inventory/alert failures as inventory-owned", () => {
    const classified = classifyDashboardLoadFailure(
      "Low stock alerts unavailable for inventory ingredients",
    );

    expect(classified.owner).toBe("inventory");
    expect(classified.userMessage).toMatch(/Inventory alerts/i);
    expect(classified.userMessage).not.toMatch(/ingredients/i);
  });

  it("classifies true Dashboard Read Model failures as fatal dashboard-owned", () => {
    const classified = classifyDashboardLoadFailure(
      'relation "dashboard_summary" does not exist',
    );

    expect(classified.owner).toBe("dashboard");
    expect(classified.userMessage).toMatch(/dashboard overview could not be loaded/i);
    expect(classified.userMessage).not.toMatch(/relation/i);
    expect(classified.userMessage).not.toMatch(/dashboard_summary/i);
  });

  it("keeps a partial Dashboard usable when modules are missing", () => {
    const shell = createUnavailableModulesReadModel();
    const result = buildDashboardCompletion(shell);

    expect(result.error).toBeNull();
    expect(result.data?.kpi_cards.length).toBe(4);
    expect(result.data?.operational).toBeTruthy();
    expect(result.data?.business_health).toBeTruthy();
    expect(result.data?.low_stock_alerts).toBeNull();
    // No duplicated shift/inventory ownership copy in dashboard info.
    expect(result.data?.informational_messages.join(" ")).not.toMatch(
      /No shift is available/i,
    );
    expect(result.data?.informational_messages.join(" ")).not.toMatch(
      /Low stock alerts are unavailable/i,
    );
  });

  it("removes duplicated informational messages", () => {
    expect(
      dedupeInformationalMessages([
        "Some overview metrics are temporarily unavailable. The rest of the dashboard remains usable.",
        "Some overview metrics are temporarily unavailable. The rest of the dashboard remains usable.",
        "Some daily close summaries are not ready yet. Available figures still appear below.",
      ]),
    ).toEqual([
      "Some overview metrics are temporarily unavailable. The rest of the dashboard remains usable.",
      "Some daily close summaries are not ready yet. Available figures still appear below.",
    ]);
  });

  it("renders warning-style dashboard info instead of an error block", () => {
    const html = renderToStaticMarkup(
      <DashboardInfo
        messages={[
          "Some overview metrics are temporarily unavailable. The rest of the dashboard remains usable.",
        ]}
      />,
    );

    expect(html).toContain("dashboard-info");
    expect(html).toContain("border-amber-200");
    expect(html).toContain("A few details are still catching up");
    expect(html).not.toContain("border-red-200");
    expect(html).not.toContain("Could not load dashboard");
  });

  it("keeps inventory missing state isolated to the alerts section", () => {
    const html = renderToStaticMarkup(
      <DashboardLowStockAlertsSection alerts={null} />,
    );

    expect(html).toContain("dashboard-low-stock-alerts-missing");
    expect(html).toContain("Inventory alerts could not be loaded right now");
    expect(html).toContain("Everything else on this page still works");
  });
});
