"use client";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { RecipeCostDetail } from "../types/recipe-cost-report";
import { RecipeCostDetailModal } from "./recipe-cost-detail-modal";

const BATTER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FLOUR_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MILK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const CYCLE_MESSAGE =
  "Recipe sub-components form a cycle. Remove the circular reference before planning or producing.";

function detail(overrides?: Partial<RecipeCostDetail>): RecipeCostDetail {
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
    ingredient_breakdown: [
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: "Flour",
        quantity: 2,
        unit: "kg",
        cost_per_unit: 1.5,
        line_cost: 3,
      },
      {
        ingredient_id: MILK_ID,
        ingredient_name: "Milk",
        quantity: 1,
        unit: "L",
        cost_per_unit: 0.8,
        line_cost: 0.8,
      },
    ],
    ...overrides,
  };
}

describe("RecipeCostDetailModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading state", () => {
    render(
      <RecipeCostDetailModal
        isOpen
        recipeName="Batter"
        detail={null}
        loading
        error={null}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Flour")).not.toBeInTheDocument();
  });

  it("shows a cycle error through role=alert", () => {
    render(
      <RecipeCostDetailModal
        isOpen
        recipeName="Cycle A"
        detail={null}
        loading={false}
        error={CYCLE_MESSAGE}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(CYCLE_MESSAGE);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Flour")).not.toBeInTheDocument();
  });

  it("renders the ingredient breakdown table", () => {
    render(
      <RecipeCostDetailModal
        isOpen
        recipeName="Batter"
        detail={detail()}
        loading={false}
        error={null}
        onClose={() => undefined}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByText("Flour")).toBeInTheDocument();
    expect(within(table).getByText("2 kg")).toBeInTheDocument();
    expect(within(table).getByText("Milk")).toBeInTheDocument();
    expect(within(table).getByText("1 L")).toBeInTheDocument();
    expect(screen.getByText("€3.80")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
