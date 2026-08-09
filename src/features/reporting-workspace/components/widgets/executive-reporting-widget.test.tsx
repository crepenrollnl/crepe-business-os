import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { ExecutiveDashboard } from "@/features/executive-dashboard/types/executive-dashboard";
import { ExecutiveReportingWidget } from "./executive-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(overrides?: Partial<ExecutiveDashboard>): ExecutiveDashboard {
  return {
    company_health: "ok",
    inventory_value: 100,
    low_stock_count: 1,
    total_sales: 2,
    total_purchases: 3,
    total_batches: 4,
    sales_growth: 5.5,
    last_sale_date: RAW_TIMESTAMP,
    last_purchase_date: RAW_TIMESTAMP,
    last_production_date: RAW_TIMESTAMP,
    ...overrides,
  };
}

describe("ExecutiveReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_sale_date/last_purchase_date/last_production_date instead of the raw timestamp", () => {
    render(<ExecutiveReportingWidget title="Executive Dashboard" data={data()} />);

    expect(screen.getAllByText(formatDateTime(RAW_TIMESTAMP)).length).toBe(3);
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when the dates are null", () => {
    render(
      <ExecutiveReportingWidget
        title="Executive Dashboard"
        data={data({
          last_sale_date: null,
          last_purchase_date: null,
          last_production_date: null,
        })}
      />,
    );

    expect(screen.getAllByText(formatDateTime(null)).length).toBe(3);
  });
});
