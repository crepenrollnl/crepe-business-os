/**
 * Pure builder coverage for Business Health (DEV-125).
 */

import { describe, expect, it } from "vitest";
import type { DashboardReadModel } from "../types/dashboard-read-model";
import {
  buildBusinessHealth,
  buildBusinessHealthFromReadModel,
} from "./business-health-builder";

const SHIFT_OPEN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_CLOSED_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function byId<T extends { id: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function emptyReadModel(
  overrides?: Partial<DashboardReadModel>,
): DashboardReadModel {
  return {
    current_shift: null,
    latest_closed_shift: null,
    daily_sales_summary: null,
    daily_profit_summary: null,
    cash_reconciliation: null,
    low_stock_alerts: null,
    kpi_summary: null,
    ...overrides,
  };
}

describe("business-health-builder (DEV-125)", () => {
  it("builds a healthy state from closed balanced shift and no alerts", () => {
    const result = buildBusinessHealth({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_CLOSED_ID, status: "closed" },
      cash_reconciliation: { difference: 0 },
      low_stock_alerts: [],
    });

    expect(result.error).toBeNull();
    expect(result.data.overall_level).toBe("healthy");
    expect(result.data.overall_display).toBe("Healthy");

    const indicators = byId(result.data.indicators);
    expect(indicators.shift_status?.display_value).toBe("Closed");
    expect(indicators.cash_status?.display_value).toBe("Balanced");
    expect(indicators.inventory_status?.display_value).toBe("Healthy");
    expect(indicators.alert_count?.display_value).toBe("0");
  });

  it("keeps overall healthy for an active shift with no inventory alerts", () => {
    const result = buildBusinessHealth({
      current_shift: { id: SHIFT_OPEN_ID, status: "open" },
      latest_closed_shift: null,
      cash_reconciliation: null,
      low_stock_alerts: [],
    });

    expect(result.data.overall_level).toBe("healthy");
    const indicators = byId(result.data.indicators);
    expect(indicators.shift_status?.display_value).toBe("Open");
    expect(indicators.cash_status?.display_value).toBe("N/A");
    expect(indicators.cash_status?.level).toBeNull();
  });

  it("marks attention when only low inventory alerts exist", () => {
    const result = buildBusinessHealth({
      current_shift: { id: SHIFT_OPEN_ID, status: "open" },
      latest_closed_shift: null,
      cash_reconciliation: null,
      low_stock_alerts: [{ alert_level: "low" }],
    });

    expect(result.data.overall_level).toBe("attention");
    expect(result.data.overall_display).toBe("Attention");
    expect(
      byId(result.data.indicators).inventory_status?.display_value,
    ).toBe("Attention");
    expect(byId(result.data.indicators).alert_count?.display_value).toBe("1");
  });

  it("marks critical when critical inventory alerts exist", () => {
    const result = buildBusinessHealth({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_CLOSED_ID, status: "closed" },
      cash_reconciliation: { difference: 0 },
      low_stock_alerts: [
        { alert_level: "low" },
        { alert_level: "critical" },
      ],
    });

    expect(result.data.overall_level).toBe("critical");
    expect(result.data.overall_display).toBe("Critical");
    expect(
      byId(result.data.indicators).inventory_status?.display_value,
    ).toBe("Critical");
    expect(byId(result.data.indicators).alert_count?.display_value).toBe("2");
  });

  it("marks critical when cash reconciliation has a difference", () => {
    const result = buildBusinessHealth({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_CLOSED_ID, status: "closed" },
      cash_reconciliation: { difference: -5 },
      low_stock_alerts: [],
    });

    expect(result.data.overall_level).toBe("critical");
    expect(byId(result.data.indicators).cash_status?.display_value).toBe(
      "Difference",
    );
  });

  it("marks attention for missing modules / partial dashboard", () => {
    const result = buildBusinessHealthFromReadModel(
      emptyReadModel({
        current_shift: null,
        latest_closed_shift: null,
        cash_reconciliation: null,
        low_stock_alerts: null,
      }),
    );

    expect(result.data.overall_level).toBe("attention");
    const indicators = byId(result.data.indicators);
    expect(indicators.shift_status?.display_value).toBe("None");
    expect(indicators.inventory_status?.display_value).toBe("Unknown");
    expect(indicators.alert_count?.display_value).toBe("—");
  });

  it("marks attention when closed shift cash is pending", () => {
    const result = buildBusinessHealth({
      current_shift: null,
      latest_closed_shift: { id: SHIFT_CLOSED_ID, status: "closed" },
      cash_reconciliation: null,
      low_stock_alerts: [],
    });

    expect(result.data.overall_level).toBe("attention");
    expect(byId(result.data.indicators).cash_status?.display_value).toBe(
      "Pending",
    );
  });
});
