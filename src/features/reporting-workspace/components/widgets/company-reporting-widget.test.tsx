import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatDateTime } from "@/lib/date";
import type { CompanyDashboard } from "@/features/company-dashboard/types/company-dashboard";
import { CompanyReportingWidget } from "./company-reporting-widget";

const RAW_TIMESTAMP = "2026-07-25T16:42:00.000Z";

function data(overrides?: Partial<CompanyDashboard>): CompanyDashboard {
  return {
    total_suppliers: 4,
    total_customers: 8,
    total_recipes: 0,
    total_ingredients: 0,
    total_finished_goods: 0,
    total_sales: 0,
    total_purchases: 0,
    total_production_batches: 0,
    last_sale_date: RAW_TIMESTAMP,
    last_purchase_date: RAW_TIMESTAMP,
    last_production_date: RAW_TIMESTAMP,
    ...overrides,
  };
}

describe("CompanyReportingWidget", () => {
  afterEach(() => {
    cleanup();
  });

  it("formats last_sale_date/last_purchase_date/last_production_date instead of the raw timestamp", () => {
    render(<CompanyReportingWidget title="Company Dashboard" data={data()} />);

    expect(screen.getAllByText(formatDateTime(RAW_TIMESTAMP)).length).toBe(3);
    expect(screen.queryByText(RAW_TIMESTAMP)).not.toBeInTheDocument();
  });

  it("renders a presentation dash when the dates are null", () => {
    render(
      <CompanyReportingWidget
        title="Company Dashboard"
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
