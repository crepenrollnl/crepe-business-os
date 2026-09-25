import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { IngredientWithRelations } from "../types/inventory";
import { AdjustStockModal } from "./adjust-stock-modal";

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

function renderModal(overrides?: {
  error?: string | null;
  isSaving?: boolean;
  onSubmit?: (input: unknown) => Promise<boolean>;
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();

  render(
    <AdjustStockModal
      isOpen
      item={item}
      isSaving={overrides?.isSaving ?? false}
      error={overrides?.error ?? null}
      onClose={onClose}
      onSubmit={onSubmit}
    />,
  );

  return { onSubmit, onClose };
}

describe("AdjustStockModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the ingredient, unit, and read-only current stock", () => {
    renderModal();

    expect(screen.getByRole("heading", { name: "Adjust Stock" })).toBeInTheDocument();
    expect(screen.getByText("Flour (kg)")).toBeInTheDocument();
    expect(screen.getByText("10 kg")).toBeInTheDocument();
    expect(screen.queryByLabelText(/cost/i)).not.toBeInTheDocument();
  });

  it("previews an increase and submits the RPC-shaped payload", async () => {
    const { onSubmit } = renderModal();

    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "4" },
    });

    expect(screen.getByText(/New stock:/)).toHaveTextContent("14 kg");

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "opening_stock" },
    });
    fireEvent.change(screen.getByLabelText(/Note/), {
      target: { value: "First count" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        ingredientId: item.id,
        direction: "increase",
        quantity: 4,
        reason: "opening_stock",
        note: "First count",
      });
    });
  });

  it("disables Save and shows a field error when a decrease would go below zero", () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "decrease" }));
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "12" },
    });
    fireEvent.blur(screen.getByLabelText("Quantity"));

    expect(
      screen.getByText("Not enough stock for this decrease. Available: 10."),
    ).toBeInTheDocument();
    expect(screen.getByText(/New stock:/)).toHaveTextContent("-2 kg");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("links spoilage / damage / staff use to Write off", () => {
    renderModal();

    expect(screen.getByRole("link", { name: "Write off" })).toHaveAttribute(
      "href",
      `/inventory?tab=write-offs&itemType=ingredient&id=${item.id}`,
    );
  });

  it("shows a service error in the banner", () => {
    renderModal({ error: "You don't have permission to adjust stock." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You don't have permission to adjust stock.",
    );
  });
});
