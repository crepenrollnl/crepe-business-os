/**
 * Coverage for the compact/expanded column toggle (Фаза 2 tech debt:
 * "/inventory table overloaded with columns"). No test file existed for
 * `inventory-table.tsx`/`inventory-row.tsx` before this task.
 *
 * Covers: default compact view shows only the 6 always-visible columns,
 * "Show more columns" reveals the remaining 12, COLUMN_COUNT-derived
 * colSpan/skeleton width stays correct in both states, and the removed
 * "Reason" column surfaces via a tooltip on Recommendation instead (same
 * pattern already used for Alert).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { InventoryTable } from "./inventory-table";
import type { IngredientWithRelations } from "../types/inventory";
import type { PurchasingReviewRow } from "../types/purchasing-review";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const noop = () => undefined;

function ingredient(
  overrides?: Partial<IngredientWithRelations>,
): IngredientWithRelations {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Flour",
    category_id: "cat-1",
    supplier_id: "sup-1",
    unit: "kg",
    current_stock: 10,
    minimum_stock: 2,
    cost_per_unit: 1.5,
    category: { id: "cat-1", name: "Baking" },
    supplier: { id: "sup-1", name: "Acme Supplies" },
    ...overrides,
  };
}

function review(overrides?: Partial<PurchasingReviewRow>): PurchasingReviewRow {
  return {
    ingredient_id: "11111111-1111-4111-8111-111111111111",
    ingredient_name: "Flour",
    unit: "kg",
    current_quantity: 10,
    average_daily_usage: 1,
    days_remaining: 10,
    forecast_status: "healthy",
    forecast_available: true,
    suggested_order_quantity: null,
    target_stock: 20,
    recommendation_status: "recommended",
    recommendation_reason: "Stock will run low within the lead time window.",
    recommendation_available: true,
    last_supplier_name: "Acme Supplies",
    last_purchase_date: "2026-08-01",
    last_purchase_price: 1.4,
    purchase_count: 5,
    supplier_insight_available: true,
    alert_level: null,
    alert_reason: null,
    ...overrides,
  };
}

const defaultProps = {
  totalCount: 1,
  hasActiveFilters: false,
  loading: false,
  error: null,
  sortField: "name" as const,
  sortDirection: "asc" as const,
  onSort: noop,
  onRetry: noop,
  onAddClick: noop,
  onEdit: noop,
  onDelete: noop,
};

describe("InventoryTable compact/expanded columns", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows only the 6 compact columns by default", () => {
    render(<InventoryTable {...defaultProps} items={[ingredient()]} />);

    for (const label of [
      "Name",
      "Category",
      "Current Quantity",
      "Alert",
      "Recommendation",
      "Actions",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    for (const label of [
      "Supplier",
      "Unit",
      "Avg Daily Usage",
      "Days Remaining",
      "Recommended Qty",
      "Target Stock",
      "Last Supplier",
      "Last Price",
      "Last Purchase",
      "Purchase Count",
      "Minimum Stock",
      "Price",
    ]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }

    expect(screen.queryByText("Reason")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show more columns" }),
    ).toBeInTheDocument();
  });

  it("reveals the remaining 12 columns after clicking 'Show more columns', and the toggle flips to 'Show fewer columns'", () => {
    render(<InventoryTable {...defaultProps} items={[ingredient()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show more columns" }));

    for (const label of [
      "Supplier",
      "Unit",
      "Avg Daily Usage",
      "Days Remaining",
      "Recommended Qty",
      "Target Stock",
      "Last Supplier",
      "Last Price",
      "Last Purchase",
      "Purchase Count",
      "Minimum Stock",
      "Price",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    expect(screen.queryByText("Reason")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show fewer columns" }),
    ).toBeInTheDocument();
  });

  it("collapses back to 6 columns after clicking 'Show fewer columns' again", () => {
    render(<InventoryTable {...defaultProps} items={[ingredient()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Show more columns" }));
    fireEvent.click(screen.getByRole("button", { name: "Show fewer columns" }));

    expect(screen.queryByText("Supplier")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show more columns" }),
    ).toBeInTheDocument();
  });

  it("uses a 6-column skeleton in compact view and an 18-column skeleton once expanded", () => {
    const { rerender } = render(
      <InventoryTable {...defaultProps} items={[]} loading />,
    );

    const compactSkeletonRow = document.querySelector("tbody tr");
    expect(compactSkeletonRow?.children.length).toBe(6);

    rerender(<InventoryTable {...defaultProps} items={[]} loading />);
    fireEvent.click(screen.getByRole("button", { name: "Show more columns" }));

    const expandedSkeletonRow = document.querySelector("tbody tr");
    expect(expandedSkeletonRow?.children.length).toBe(18);
  });

  it("uses colSpan 6 for the empty state in compact view and 18 once expanded", () => {
    render(<InventoryTable {...defaultProps} items={[]} />);

    expect(document.querySelector("tbody td")).toHaveAttribute("colspan", "6");

    fireEvent.click(screen.getByRole("button", { name: "Show more columns" }));

    expect(document.querySelector("tbody td")).toHaveAttribute("colspan", "18");
  });

  it("surfaces the recommendation reason as a tooltip on Recommendation instead of a separate Reason column", () => {
    const reviews = new Map([[ingredient().id, review()]]);
    render(
      <InventoryTable
        {...defaultProps}
        items={[ingredient()]}
        purchasingReviews={reviews}
      />,
    );

    expect(screen.getByTestId("recommendation-status")).toHaveAttribute(
      "title",
      "Stock will run low within the lead time window.",
    );
  });

  it("links Movement history to the ingredient movements page", () => {
    const item = ingredient();
    render(<InventoryTable {...defaultProps} items={[item]} />);

    expect(
      screen.getByRole("link", { name: "Movement history" }),
    ).toHaveAttribute("href", `/inventory/ingredients/${item.id}/movements`);
  });
});
