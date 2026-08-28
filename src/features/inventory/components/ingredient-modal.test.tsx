import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { IngredientWithRelations } from "../types/inventory";
import { IngredientModal } from "./ingredient-modal";

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
const noopAsync = async () => false;

const item: IngredientWithRelations = {
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
};

const defaultProps = {
  isOpen: true,
  categories: [{ id: "cat-1", name: "Baking" }],
  suppliers: [{ id: "sup-1", name: "Acme Supplies" }],
  isSaving: false,
  error: null,
  recipeUsageCount: null,
  isCheckingRecipeUsage: false,
  onClose: noop,
  onSave: noopAsync,
};

describe("IngredientModal Movement history link", () => {
  afterEach(() => {
    cleanup();
  });

  it("links Movement history when editing an existing ingredient", () => {
    render(<IngredientModal {...defaultProps} item={item} />);

    expect(
      screen.getByRole("link", { name: "Movement history" }),
    ).toHaveAttribute("href", `/inventory/ingredients/${item.id}/movements`);
  });

  it("does not show Movement history when adding an ingredient", () => {
    render(<IngredientModal {...defaultProps} item={null} />);

    expect(
      screen.queryByRole("link", { name: "Movement history" }),
    ).not.toBeInTheDocument();
  });
});
