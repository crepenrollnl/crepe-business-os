/**
 * /sales/[id] Add line (audit D4): the seller never types a price. Only
 * products with a selling price in Recipes are offered, the price is shown
 * read-only, and the line is added at exactly that price.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleDetailLine } from "../types/sale";
import {
  SaleLinesSection,
  type SaleProductOption,
} from "./sale-lines-section";

const PRICED: SaleProductOption = {
  id: "recipe-priced",
  name: "Chicken Crepe",
  selling_price: 9.99,
};
const UNPRICED: SaleProductOption = {
  id: "recipe-unpriced",
  name: "Mystery Crepe",
  selling_price: null,
};

function renderSection(options?: {
  products?: SaleProductOption[];
  lines?: SaleDetailLine[];
  onAddLine?: (input: {
    product_id: string;
    quantity: number;
    unit_price: number;
  }) => Promise<boolean>;
}) {
  const onAddLine = options?.onAddLine ?? vi.fn().mockResolvedValue(true);
  render(
    <SaleLinesSection
      lines={options?.lines ?? []}
      products={options?.products ?? [PRICED, UNPRICED]}
      canEdit
      mutating={false}
      onAddLine={onAddLine}
      onUpdateQuantity={vi.fn().mockResolvedValue(true)}
      onDeleteLine={vi.fn().mockResolvedValue(true)}
    />,
  );
  return { onAddLine };
}

afterEach(() => {
  cleanup();
});

describe("SaleLinesSection Add line price (audit D4)", () => {
  it("has no unit price input", () => {
    renderSection();

    expect(screen.queryByLabelText(/unit price/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("offers only products with a selling price", () => {
    renderSection();

    const options = Array.from(
      (screen.getByLabelText("Product") as HTMLSelectElement).options,
    ).map((option) => option.textContent);

    expect(options).toEqual(["Select product", "Chicken Crepe"]);
  });

  it("explains when no product has a price yet", () => {
    renderSection({ products: [UNPRICED] });

    expect(screen.getByLabelText("Product")).toBeDisabled();
    expect(
      screen.getByText(/set a selling price on an active assembly recipe/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add line" })).toBeDisabled();
  });

  it("shows the selected product's price read-only and a line total preview", () => {
    renderSection();

    expect(screen.getByTestId("add-line-price")).toHaveTextContent(
      "Select a product",
    );

    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: PRICED.id },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "3" },
    });

    expect(screen.getByTestId("add-line-price")).toHaveTextContent(
      "€9.99, set in Recipes",
    );
    expect(screen.getByText("Line total €29.97")).toBeInTheDocument();
  });

  it("adds the line at the product's selling price", async () => {
    const { onAddLine } = renderSection();

    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: PRICED.id },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add line" }));

    await vi.waitFor(() => expect(onAddLine).toHaveBeenCalledTimes(1));
    expect(onAddLine).toHaveBeenCalledWith({
      product_id: PRICED.id,
      quantity: 2,
      unit_price: 9.99,
    });
  });

  it("still labels an existing line whose product has no price", () => {
    renderSection({
      lines: [
        {
          line_id: "line-1",
          product_id: UNPRICED.id,
          quantity: 1,
          unit_price: 4,
          line_total: 4,
        },
      ],
    });

    expect(screen.getByText("Mystery Crepe")).toBeInTheDocument();
  });
});
