import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WriteOffForm } from "./write-off-form";
import type {
  WriteOffIngredientOption,
  WriteOffProductOption,
} from "../types/write-off";
import { WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE } from "../types/write-off";

const INGREDIENTS: WriteOffIngredientOption[] = [
  { id: "ing-1", name: "Chicken", unit: "kg" },
  { id: "ing-2", name: "Flour", unit: "kg" },
];

const PRODUCTS: WriteOffProductOption[] = [
  { id: "recipe-1", name: "Chicken Crepe", unit: "pcs" },
  { id: "recipe-2", name: "Unitless Product", unit: null },
];

function renderForm(overrides?: {
  error?: string | null;
  lastSuccess?: string | null;
  postingWarning?: string | null;
  accountingNote?: string | null;
  prefillItemType?: "ingredient" | "finished_good" | null;
  prefillItemId?: string | null;
  onSubmit?: (input: unknown) => Promise<boolean>;
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(true);
  const onDismissSuccess = vi.fn();

  render(
    <WriteOffForm
      ingredients={INGREDIENTS}
      products={PRODUCTS}
      isSaving={false}
      error={overrides?.error ?? null}
      lastSuccess={overrides?.lastSuccess ?? null}
      postingWarning={overrides?.postingWarning ?? null}
      accountingNote={overrides?.accountingNote ?? null}
      prefillItemType={overrides?.prefillItemType}
      prefillItemId={overrides?.prefillItemId}
      onSubmit={onSubmit}
      onDismissSuccess={onDismissSuccess}
    />,
  );

  return { onSubmit, onDismissSuccess };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Ingredient"), {
    target: { value: "ing-1" },
  });
  fireEvent.change(screen.getByLabelText("Quantity"), {
    target: { value: "2" },
  });
}

describe("WriteOffForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the item-type toggle, reason select, and submit button", () => {
    renderForm();

    expect(screen.getByRole("button", { name: "Ingredient" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /record write-off/i }),
    ).toBeDisabled();
  });

  it("prefills the selected ingredient from the inventory row link", () => {
    renderForm({
      prefillItemType: "ingredient",
      prefillItemId: "ing-1",
    });

    expect(screen.getByLabelText("Ingredient")).toHaveValue("ing-1");
  });

  it("submits a write-off once quantity and item are valid", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /record write-off/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        itemType: "ingredient",
        ingredientId: "ing-1",
        productId: null,
        quantity: 2,
        reason: "spoilage",
        note: null,
      });
    });
  });

  it("switches to finished goods and submits that item type", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });

    fireEvent.click(screen.getByRole("button", { name: "Finished good" }));
    fireEvent.change(screen.getByLabelText("Finished good"), {
      target: { value: "recipe-1" },
    });
    fireEvent.change(screen.getByLabelText("Quantity"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "staff_use" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record write-off/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        itemType: "finished_good",
        ingredientId: null,
        productId: "recipe-1",
        quantity: 1,
        reason: "staff_use",
        note: null,
      });
    });
  });

  it("shows the selected ingredient's unit beside the quantity field", () => {
    renderForm();

    expect(screen.queryByText("kg")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ingredient"), {
      target: { value: "ing-1" },
    });

    expect(screen.getByText("kg")).toBeInTheDocument();
  });

  it("shows the selected finished good's yield_unit beside the quantity field", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Finished good" }));
    fireEvent.change(screen.getByLabelText("Finished good"), {
      target: { value: "recipe-1" },
    });

    expect(screen.getByText("pcs")).toBeInTheDocument();
  });

  it("shows no unit hint for a finished good with no yield_unit set", () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Finished good" }));
    fireEvent.change(screen.getByLabelText("Finished good"), {
      target: { value: "recipe-2" },
    });

    expect(screen.queryByText("pcs")).not.toBeInTheDocument();
    expect(screen.queryByText("kg")).not.toBeInTheDocument();
  });

  it("shows a neutral note when no accounting entry was created", () => {
    renderForm({
      accountingNote: WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
    });

    expect(
      screen.getByText(WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/^Write-off recorded\.$/),
    ).not.toBeInTheDocument();
  });
});
