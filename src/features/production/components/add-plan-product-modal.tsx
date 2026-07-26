"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  AddProductionPlanProductInput,
  ProductionFinishedGoodOption,
} from "../types/production";
import {
  isAddPlanProductInputValid,
  validateAddPlanProductInput,
} from "../utils/validate-plan-product";

type AddPlanProductModalProps = {
  isOpen: boolean;
  options: ProductionFinishedGoodOption[];
  hasCatalog: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: AddProductionPlanProductInput) => Promise<boolean>;
};

type FormDraft = {
  recipe_id: string;
  planned_quantity: string;
};

type TouchedFields = Partial<Record<keyof FormDraft, boolean>>;

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

export function AddPlanProductModal({
  isOpen,
  options,
  hasCatalog,
  isSaving,
  error,
  onClose,
  onSave,
}: AddPlanProductModalProps) {
  const [search, setSearch] = useState("");
  const [formValues, setFormValues] = useState<FormDraft>({
    recipe_id: "",
    planned_quantity: "",
  });
  const [touched, setTouched] = useState<TouchedFields>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const selectedOption = options.find(
    (option) => option.id === formValues.recipe_id,
  );

  const filteredOptions = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    if (normalized.length === 0) {
      return options;
    }

    return options.filter((option) =>
      option.name.toLowerCase().includes(normalized),
    );
  }, [options, search]);

  const quantityValue = parseQuantity(formValues.planned_quantity);
  const fieldErrors = validateAddPlanProductInput({
    recipe_id: formValues.recipe_id,
    planned_quantity: quantityValue,
  });
  const isFormValid = isAddPlanProductInputValid({
    recipe_id: formValues.recipe_id,
    planned_quantity: quantityValue,
  });

  const showFieldError = (field: keyof FormDraft): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }

    return fieldErrors[field];
  };

  const resetForm = () => {
    setSearch("");
    setFormValues({ recipe_id: "", planned_quantity: "" });
    setTouched({});
    setHasAttemptedSubmit(false);
  };

  const handleClose = () => {
    if (isSaving) {
      return;
    }

    resetForm();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid || quantityValue === null) {
      return;
    }

    const saved = await onSave({
      recipe_id: formValues.recipe_id,
      planned_quantity: quantityValue,
    });

    if (saved) {
      resetForm();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : handleClose}
        disabled={isSaving}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-zinc-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-zinc-900">Add Product</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Search finished goods, select a product, then enter the planned
            quantity.
          </p>
        </div>

        {!hasCatalog ? (
          <div className="space-y-5 px-6 py-6">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-medium text-amber-900">
                No Finished Goods are available.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Create products before planning production.
              </p>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => void handleSubmit(event)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <label
                  htmlFor="add-plan-product-search"
                  className="mb-1.5 block text-sm font-medium text-zinc-700"
                >
                  Search
                </label>
                <input
                  id="add-plan-product-search"
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={isSaving}
                  placeholder="Search by finished good name..."
                  className={inputClassName}
                  autoFocus
                />
              </div>

              <div>
                <p className="mb-1.5 text-sm font-medium text-zinc-700">
                  Select Product
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200">
                  {filteredOptions.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-zinc-500">
                      {options.length === 0
                        ? "All available finished goods are already on this plan."
                        : "No finished goods match your search."}
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-200">
                      {filteredOptions.map((option) => {
                        const isSelected = formValues.recipe_id === option.id;

                        return (
                          <li key={option.id}>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => {
                                setFormValues((current) => ({
                                  ...current,
                                  recipe_id: option.id,
                                }));
                                setTouched((current) => ({
                                  ...current,
                                  recipe_id: true,
                                }));
                              }}
                              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors ${
                                isSelected
                                  ? "bg-amber-50 text-amber-900"
                                  : "bg-white text-zinc-800 hover:bg-zinc-50"
                              }`}
                            >
                              <span className="font-medium">{option.name}</span>
                              <span className="text-zinc-500">
                                {option.yield_unit}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {showFieldError("recipe_id") && (
                  <p className="mt-1.5 text-sm text-red-600">
                    {showFieldError("recipe_id")}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-plan-product-quantity"
                  className="mb-1.5 block text-sm font-medium text-zinc-700"
                >
                  Planned Quantity
                  {selectedOption ? (
                    <span className="font-normal text-zinc-500">
                      {" "}
                      ({selectedOption.yield_unit})
                    </span>
                  ) : null}
                </label>
                <input
                  id="add-plan-product-quantity"
                  type="number"
                  min="0.001"
                  step="any"
                  value={formValues.planned_quantity}
                  onChange={(event) => {
                    setFormValues((current) => ({
                      ...current,
                      planned_quantity: event.target.value,
                    }));
                    setTouched((current) => ({
                      ...current,
                      planned_quantity: true,
                    }));
                  }}
                  disabled={isSaving}
                  placeholder="e.g. 20"
                  className={inputClassName}
                />
                {showFieldError("planned_quantity") && (
                  <p className="mt-1.5 text-sm text-red-600">
                    {showFieldError("planned_quantity")}
                  </p>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse justify-end gap-3 border-t border-zinc-200 px-6 py-4 sm:flex-row">
              <button
                type="button"
                onClick={handleClose}
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
        )}
      </div>
    </div>
  );
}
