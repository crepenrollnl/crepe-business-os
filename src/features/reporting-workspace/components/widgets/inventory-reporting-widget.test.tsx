import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { InventoryDashboard } from "@/features/inventory-dashboard/types/inventory-dashboard";
import { InventoryReportingWidget } from "./inventory-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(overrides?: Partial<InventoryDashboard>): InventoryDashboard {
  return {
    total_ingredients: 12,
    low_stock_count: 3,
    out_of_stock_count: 1,
    total_inventory_value: 0,
    last_purchase_date: RAW_TIMESTAMP,
    last_production_date: RAW_TIMESTAMP,
    ...overrides,
  };
}

describe("InventoryReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_purchase_date/last_production_date instead of the raw timestamp", () => {
    render(<InventoryReportingWidget title="Inventory Dashboard" data={data()} />);

    expect(screen.getAllByText(formatDateTime(RAW_TIMESTAMP)).length).toBe(2);
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when the dates are null", () => {
    render(
      <InventoryReportingWidget
        title="Inventory Dashboard"
        data={data({ last_purchase_date: null, last_production_date: null })}
      />,
    );

    expect(screen.getAllByText(formatDateTime(null)).length).toBe(2);
  });
});
