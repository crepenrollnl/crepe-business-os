/**
 * Presentational coverage for SalesProductReportTable.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SalesProductReportTable } from "./sales-product-report-table";

const PRODUCT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("SalesProductReportTable", () => {
  it("renders product money columns from row facts", () => {
    render(
      <SalesProductReportTable
        rows={[
          {
            product_id: PRODUCT_A,
            product_name: "Chicken Crepe",
            quantity: 2,
            revenue: 20,
            cogs: 2.01,
            gross_profit: 17.99,
            gross_margin_percent: 89.95,
          },
        ]}
        loading={false}
        error={null}
        sortField="revenue"
        sortDirection="desc"
        onSort={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Chicken Crepe")).toBeInTheDocument();
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getAllByText("89.95%")).toHaveLength(2);
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("shows an empty period message", () => {
    render(
      <SalesProductReportTable
        rows={[]}
        loading={false}
        error={null}
        sortField="revenue"
        sortDirection="desc"
        onSort={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByText("No completed sales in this period."),
    ).toBeInTheDocument();
  });
});
