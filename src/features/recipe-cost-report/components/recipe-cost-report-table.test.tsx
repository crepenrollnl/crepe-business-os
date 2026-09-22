"use client";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { RecipeCostReportRow } from "../types/recipe-cost-report";
import { RecipeCostReportTable } from "./recipe-cost-report-table";

const BATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREPE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CYCLE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ZERO_INGREDIENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function row(overrides?: Partial<RecipeCostReportRow>): RecipeCostReportRow {
  return {
    recipe_id: BATTER_ID,
    recipe_name: "Batter",
    recipe_role: "component",
    yield_quantity: 4,
    yield_unit: "portion",
    is_active: true,
    selling_price: null,
    total_cost: 3.8,
    cost_per_yield_unit: 0.95,
    has_missing_cost_data: false,
    missing_ingredients: [],
    calculation_error: null,
    ...overrides,
  };
}

describe("RecipeCostReportTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders recipe rows with product and semi-finished labels", () => {
    render(
      <RecipeCostReportTable
        rows={[
          row(),
          row({
            recipe_id: CREPE_ID,
            recipe_name: "Chicken Crepe",
            recipe_role: "assembly",
            yield_quantity: 1,
            yield_unit: "pcs",
            selling_price: 9.5,
            total_cost: 4.6,
            cost_per_yield_unit: 4.6,
          }),
        ]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(screen.getByText("Batter")).toBeInTheDocument();
    expect(screen.getByText("Semi-finished")).toBeInTheDocument();
    expect(screen.getByText("4 portion")).toBeInTheDocument();
    expect(screen.getByText("€3.80")).toBeInTheDocument();
    expect(screen.getByText("€0.95")).toBeInTheDocument();
    expect(screen.getByText("Chicken Crepe")).toBeInTheDocument();
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("€9.50")).toBeInTheDocument();
    expect(screen.getAllByText("Active")).toHaveLength(2);
  });

  it("shows the incomplete cost data badge with missing ingredient names", () => {
    render(
      <RecipeCostReportTable
        rows={[
          row({
            recipe_id: ZERO_ID,
            recipe_name: "Zero cost filling",
            total_cost: 0,
            cost_per_yield_unit: 0,
            has_missing_cost_data: true,
            missing_ingredients: [
              {
                ingredient_id: ZERO_INGREDIENT_ID,
                ingredient_name: "Unpriced spice",
                unit: "kg",
              },
            ],
          }),
        ]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(screen.getByText("Incomplete cost data")).toHaveAttribute(
      "title",
      "Unpriced spice",
    );
  });

  it("shows the calculation error badge with the RPC error text", () => {
    const cycleMessage =
      "Recipe sub-components form a cycle. Remove the circular reference before planning or producing.";

    render(
      <RecipeCostReportTable
        rows={[
          row({
            recipe_id: CYCLE_ID,
            recipe_name: "Cycle A",
            total_cost: null,
            cost_per_yield_unit: null,
            has_missing_cost_data: null,
            missing_ingredients: null,
            calculation_error: cycleMessage,
          }),
        ]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(screen.getByText("Calculation error")).toHaveAttribute(
      "title",
      cycleMessage,
    );
  });

  it("renders em dashes when cost and selling price are null", () => {
    render(
      <RecipeCostReportTable
        rows={[
          row({
            recipe_id: CYCLE_ID,
            recipe_name: "Broken recipe",
            is_active: false,
            selling_price: null,
            total_cost: null,
            cost_per_yield_unit: null,
            has_missing_cost_data: null,
            missing_ingredients: null,
            calculation_error: "Recipe was not found.",
          }),
        ]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("calls onOpenDetail from the Details button", async () => {
    const user = userEvent.setup();
    const onOpenDetail = vi.fn();
    const batter = row();

    render(
      <RecipeCostReportTable
        rows={[batter]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={onOpenDetail}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Details" }));

    expect(onOpenDetail).toHaveBeenCalledWith(batter);
  });

  it("shows the empty state when there are no recipes", () => {
    render(
      <RecipeCostReportTable
        rows={[]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenDetail={() => undefined}
      />,
    );

    expect(screen.getByText("No recipes yet")).toBeInTheDocument();
  });
});
