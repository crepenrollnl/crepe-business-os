import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { IngredientStockLevelsTable } from "./ingredient-stock-levels-table";
import type { IngredientStockLevel } from "../types/inventory";

function level(overrides?: Partial<IngredientStockLevel>): IngredientStockLevel {
  return {
    id: "i-1",
    name: "Flour",
    category_id: "c-1",
    unit: "kg",
    current_stock: 10,
    minimum_stock: 2,
    active: true,
    category: { id: "c-1", name: "Baking" },
    ...overrides,
  };
}

const props = {
  totalCount: 1,
  hasActiveFilters: false,
  loading: false,
  error: null,
  sortField: "name" as const,
  sortDirection: "asc" as const,
  onSort: () => undefined,
  onRetry: () => undefined,
};

describe("IngredientStockLevelsTable (seller Inventory)", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows quantities only: no prices, suppliers, purchasing columns or actions", () => {
    render(<IngredientStockLevelsTable {...props} items={[level()]} />);

    expect(
      screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.replace(/[↑↓↕]/g, "").trim()),
    ).toEqual(["Name", "Category", "Unit", "Current Quantity", "Minimum Stock"]);
    expect(screen.getByText("Flour")).toBeInTheDocument();
    expect(screen.getByText("Baking")).toBeInTheDocument();
    expect(screen.getByTestId("current-quantity")).toHaveTextContent("10");
    expect(screen.getByTestId("minimum-stock")).toHaveTextContent("2");
    expect(screen.queryByText(/€/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    for (const name of ["Edit", "Delete", "Adjust Stock", "Show more columns"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("sorts through the sortable headers", () => {
    const onSort = vi.fn();
    render(
      <IngredientStockLevelsTable {...props} onSort={onSort} items={[level()]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Current Quantity/ }));

    expect(onSort).toHaveBeenCalledWith("current_stock");
  });

  it("shows an empty state without an Add button", () => {
    render(
      <IngredientStockLevelsTable {...props} totalCount={0} items={[]} />,
    );

    expect(screen.getByText("No ingredients yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
    expect(screen.getByText("No ingredients yet").closest("td")).toHaveAttribute(
      "colspan",
      "5",
    );
  });

  it("shows the error with retry", () => {
    const onRetry = vi.fn();
    render(
      <IngredientStockLevelsTable
        {...props}
        items={[]}
        error="permission denied"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });
});
