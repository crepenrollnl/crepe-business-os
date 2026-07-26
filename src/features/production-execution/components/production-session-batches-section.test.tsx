/**
 * Production Batch Details UI coverage (DEV-103 / DEV-106).
 *
 * Display-only: no cost recalculation in the UI.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ProductionSessionBatchesSection } from "./production-session-batches-section";
import type { ProductionBatchWithProduct } from "../types/production-batch";

function batch(
  overrides?: Partial<ProductionBatchWithProduct>,
): ProductionBatchWithProduct {
  return {
    id: "batch-1",
    batch_number: 12,
    production_session_id: "session-1",
    production_session_line_id: "line-1",
    finished_good_id: "recipe-1",
    recipe_id: "recipe-1",
    produced_quantity: 10,
    unit_cost: 0.5,
    produced_at: "2026-07-26T12:00:00.000Z",
    created_at: "2026-07-26T12:00:00.000Z",
    product_name: "Chicken Crepe",
    yield_unit: "pcs",
    total_cost: 5,
    remaining_quantity: 8,
    remaining_value: 4,
    has_valuation: true,
    cost_breakdown: [
      {
        ingredient_id: "flour",
        ingredient_name: "Flour",
        consumed_quantity: 2,
        unit: "kg",
        inventory_unit_cost: 1.5,
        line_cost: 3,
      },
      {
        ingredient_id: "milk",
        ingredient_name: "Milk",
        consumed_quantity: 1,
        unit: "l",
        inventory_unit_cost: 2,
        line_cost: 2,
      },
    ],
    ...overrides,
  };
}

describe("ProductionSessionBatchesSection (DEV-106)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders batch details: produced, remaining qty/value, costs, and ingredient breakdown", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[batch()]}
        completionDate="2026-07-26T14:30:00.000Z"
        accountingPostingStatus="pending"
      />,
    );

    const details = screen.getByTestId("batch-cost-details-batch-1");
    expect(within(details).getByText("Produced Quantity")).toBeInTheDocument();
    expect(within(details).getByText("10 pcs")).toBeInTheDocument();
    expect(within(details).getByText("8 pcs")).toBeInTheDocument();
    expect(within(details).getByText("€0.5000")).toBeInTheDocument();
    expect(within(details).getByText("€5.00")).toBeInTheDocument();
    expect(within(details).getByText("€4.00")).toBeInTheDocument();
    expect(within(details).getByText("Flour")).toBeInTheDocument();
    expect(within(details).getByText("Milk")).toBeInTheDocument();
    expect(within(details).getByText("2 kg")).toBeInTheDocument();
    expect(within(details).getByText("€3.00")).toBeInTheDocument();
  });

  it("displays remaining quantity including zero remaining", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[
          batch({
            remaining_quantity: 0,
            remaining_value: 0,
          }),
        ]}
      />,
    );

    const details = screen.getByTestId("batch-cost-details-batch-1");
    expect(within(details).getByText("0 pcs")).toBeInTheDocument();
    expect(within(details).getByText("€0.00")).toBeInTheDocument();
  });

  it("displays partial remaining quantity and remaining inventory value", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[
          batch({
            produced_quantity: 20,
            remaining_quantity: 7.5,
            remaining_value: 3.75,
            total_cost: 10,
            unit_cost: 0.5,
          }),
        ]}
      />,
    );

    const details = screen.getByTestId("batch-cost-details-batch-1");
    expect(within(details).getByText("20 pcs")).toBeInTheDocument();
    expect(within(details).getByText("7.500 pcs")).toBeInTheDocument();
    expect(within(details).getByText("€3.75")).toBeInTheDocument();
  });

  it("shows ✓ Posted when accounting posting exists", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[batch()]}
        accountingPostingStatus="posted"
      />,
    );

    expect(screen.getByTestId("accounting-posting-status")).toHaveTextContent(
      "✓ Posted",
    );
    expect(screen.getAllByText("✓ Posted").length).toBeGreaterThanOrEqual(1);
  });

  it("shows Pending when accounting posting is missing", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[batch()]}
        accountingPostingStatus="pending"
      />,
    );

    expect(screen.getByTestId("accounting-posting-status")).toHaveTextContent(
      "Pending",
    );
  });

  it("defaults accounting status to Pending when not provided", () => {
    render(<ProductionSessionBatchesSection batches={[batch()]} />);

    expect(screen.getByTestId("accounting-posting-status")).toHaveTextContent(
      "Pending",
    );
  });

  it("handles missing valuation without displaying cost figures", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[
          batch({
            has_valuation: false,
            remaining_quantity: null,
            remaining_value: null,
            cost_breakdown: [],
          }),
        ]}
      />,
    );

    expect(screen.getByTestId("missing-valuation-batch-1")).toHaveTextContent(
      /valuation unavailable/i,
    );

    const details = screen.getByTestId("batch-cost-details-batch-1");
    const totalCostRow = within(details)
      .getByText("Total Batch Cost")
      .closest("div");
    expect(totalCostRow).toHaveTextContent("—");
    const unitCostRow = within(details).getByText("Unit Cost").closest("div");
    expect(unitCostRow).toHaveTextContent("—");
    const remainingValueRow = within(details)
      .getByText("Remaining Inventory Value")
      .closest("div");
    expect(remainingValueRow).toHaveTextContent("—");
  });

  it("displays production completion date from session", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[batch()]}
        completionDate="2026-07-26T14:30:00.000Z"
      />,
    );

    const expected = new Date("2026-07-26T14:30:00.000Z").toLocaleString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    );

    expect(screen.getByTestId("production-completion-date")).toHaveTextContent(
      expected,
    );
  });

  it("supports historical batches with frozen costs and ingredient breakdown", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[
          batch({
            produced_at: "2025-01-10T09:00:00.000Z",
            unit_cost: 1.25,
            total_cost: 12.5,
            remaining_quantity: 2,
            remaining_value: 2.5,
          }),
        ]}
        completionDate="2025-01-10T09:05:00.000Z"
        accountingPostingStatus="posted"
      />,
    );

    const details = screen.getByTestId("batch-cost-details-batch-1");
    expect(within(details).getByText("€1.2500")).toBeInTheDocument();
    expect(within(details).getByText("€12.50")).toBeInTheDocument();
    expect(within(details).getByText("€2.50")).toBeInTheDocument();
    expect(within(details).getByText("Flour")).toBeInTheDocument();
    expect(screen.getByTestId("accounting-posting-status")).toHaveTextContent(
      "✓ Posted",
    );
  });

  it("shows empty breakdown message when cost lines are unavailable", () => {
    render(
      <ProductionSessionBatchesSection
        batches={[batch({ cost_breakdown: [] })]}
      />,
    );

    expect(
      screen.getByText(/ingredient cost breakdown is not available/i),
    ).toBeInTheDocument();
  });
});
