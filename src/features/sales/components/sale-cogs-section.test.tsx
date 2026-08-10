/**
 * Sale Details COGS UI (DEV-108).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleCostSummary } from "../types/sale-cogs";
import { SaleCogsSection } from "./sale-cogs-section";

function summary(
  overrides?: Partial<SaleCostSummary>,
): SaleCostSummary {
  return {
    sale_id: "sale-1",
    total_cogs: 22,
    consumed_quantity: 9,
    is_frozen: true,
    line_summaries: [],
    layers: [
      {
        consumption_id: "c-1",
        sale_line_id: "line-1",
        production_batch_id: "batch-a",
        batch_number: 1,
        quantity: 5,
        unit_cost: 2,
        total_cost: 10,
        produced_at: "2026-07-01T08:00:00.000Z",
      },
      {
        consumption_id: "c-2",
        sale_line_id: "line-1",
        production_batch_id: "batch-b",
        batch_number: 2,
        quantity: 4,
        unit_cost: 3,
        total_cost: 12,
        produced_at: "2026-07-02T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

describe("SaleCogsSection (DEV-108)", () => {
  afterEach(() => {
    cleanup();
  });

  it("displays total COGS, consumed batches, unit cost, and quantity", () => {
    render(<SaleCogsSection summary={summary()} />);

    expect(screen.getByTestId("sale-total-cogs")).toHaveTextContent("€22.00");
    expect(screen.getByText("#1")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("€2.0000")).toBeInTheDocument();
    expect(screen.getByText("€3.0000")).toBeInTheDocument();
    expect(screen.getByText("€10.00")).toBeInTheDocument();
    expect(screen.getByText("€12.00")).toBeInTheDocument();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(
      <SaleCogsSection summary={null} loading />,
    );
    expect(screen.getByText(/loading cost of goods/i)).toBeInTheDocument();

    rerender(
      <SaleCogsSection
        summary={null}
        error="Sale has no Finished Goods consumption layers for COGS."
      />,
    );
    expect(
      screen.getByText(/no finished goods consumption/i),
    ).toBeInTheDocument();
  });
});
