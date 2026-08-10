"use client";

import { useState, type FormEvent } from "react";
import type {
  ProductionPlanProduct,
  UpdateProductionPlanProductQuantityInput,
} from "../types/production";
import {
  isUpdatePlanProductQuantityInputValid,
  validateUpdatePlanProductQuantityInput,
} from "../utils/validate-plan-product";

type EditPlanProductQuantityModalProps = {
  product: ProductionPlanProduct | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: UpdateProductionPlanProductQuantityInput) => Promise<boolean>;
};

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

function parseQuantity(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function EditPlanProductQuantityModal({
  product,
  isSaving,
  error,
  onClose,
  onSave,
}: EditPlanProductQuantityModalProps) {
  const [quantity, setQuantity] = useState(
    product ? String(product.planned_quantity) : "",
  );
  const [touched, setTouched] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  if (!product) {
    return null;
  }

  const quantityValue = parseQuantity(quantity);
  const fieldErrors = validateUpdatePlanProductQuantityInput({
    planned_quantity: quantityValue,
  });
  const isFormValid = isUpdatePlanProductQuantityInputValid({
    planned_quantity: quantityValue,
  });
  const showError =
    hasAttemptedSubmit || touched ? fieldErrors.planned_quantity : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid || quantityValue === null) {
      return;
    }

    await onSave({ planned_quantity: quantityValue });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : onClose}
        disabled={isSaving}
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-zinc-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-zinc-900">
            Edit Planned Quantity
          </h2>
          <p className="mt-1 text-sm text-zinc-500">{product.recipe_name}</p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-5 px-6 py-5"
        >
          <div>
            <label
              htmlFor="edit-plan-product-quantity"
              className="mb-1.5 block text-sm font-medium text-zinc-700"
            >
              Planned Quantity ({product.yield_unit})
            </label>
            <input
              id="edit-plan-product-quantity"
              type="number"
              min="0.001"
              step="any"
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value);
                setTouched(true);
              }}
              disabled={isSaving}
              className={inputClassName}
              autoFocus
            />
            {showError && (
              <p className="mt-1.5 text-sm text-red-600">{showError}</p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !isFormValid}
              className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
