"use client";

import { useState, type FormEvent } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import type {
  IngredientCategory,
  IngredientFormValues,
  IngredientWithRelations,
  Supplier,
} from "../types/inventory";

type IngredientModalProps = {
  isOpen: boolean;
  item: IngredientWithRelations | null;
  categories: IngredientCategory[];
  suppliers: Supplier[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: IngredientFormValues) => Promise<boolean>;
};

type NumericFormField = "current_stock" | "minimum_stock" | "cost_per_unit";

type IngredientFormDraft = Omit<IngredientFormValues, NumericFormField> & {
  current_stock: string;
  minimum_stock: string;
  cost_per_unit: string;
};

type FormErrors = Partial<Record<keyof IngredientFormValues, string>>;
type TouchedFields = Partial<Record<keyof IngredientFormValues, boolean>>;

const emptyForm: IngredientFormDraft = {
  name: "",
  category_id: "",
  supplier_id: "",
  unit: "",
  current_stock: "",
  minimum_stock: "",
  cost_per_unit: "",
};

function itemToFormDraft(item: IngredientWithRelations): IngredientFormDraft {
  return {
    name: item.name,
    category_id: item.category_id ?? "",
    supplier_id: item.supplier_id ?? "",
    unit: item.unit,
    current_stock: formatNumericInput(item.current_stock),
    minimum_stock: formatNumericInput(item.minimum_stock),
    cost_per_unit: formatNumericInput(item.cost_per_unit),
  };
}

function coerceNumericField(value: string): number {
  return parseNumericInput(value) ?? 0;
}

function draftToFormValues(draft: IngredientFormDraft): IngredientFormValues {
  return {
    name: draft.name,
    category_id: draft.category_id,
    supplier_id: draft.supplier_id,
    unit: draft.unit,
    current_stock: coerceNumericField(draft.current_stock),
    minimum_stock: coerceNumericField(draft.minimum_stock),
    cost_per_unit: coerceNumericField(draft.cost_per_unit),
  };
}

function validateNumericField(value: string, message: string): string | undefined {
  const parsed = parseNumericInput(value);

  if (parsed === null || parsed < 0) {
    return message;
  }

  return undefined;
}

function validateFormDraft(draft: IngredientFormDraft): FormErrors {
  const errors: FormErrors = {};

  if (!draft.name.trim()) {
    errors.name = "Name is required";
  }

  if (!draft.category_id) {
    errors.category_id = "Category is required";
  }

  if (!draft.unit.trim()) {
    errors.unit = "Unit is required";
  }

  const currentStockError = validateNumericField(
    draft.current_stock,
    "Current stock must be 0 or greater",
  );
  if (currentStockError) {
    errors.current_stock = currentStockError;
  }

  const minimumStockError = validateNumericField(
    draft.minimum_stock,
    "Minimum stock must be 0 or greater",
  );
  if (minimumStockError) {
    errors.minimum_stock = minimumStockError;
  }

  const costError = validateNumericField(
    draft.cost_per_unit,
    "Cost per unit must be 0 or greater",
  );
  if (costError) {
    errors.cost_per_unit = costError;
  }

  return errors;
}

type IngredientModalFormProps = Omit<IngredientModalProps, "isOpen">;

function IngredientModalForm({
  item,
  categories,
  suppliers,
  isSaving,
  error,
  onClose,
  onSave,
}: IngredientModalFormProps) {
  const [formValues, setFormValues] = useState<IngredientFormDraft>(() =>
    item ? itemToFormDraft(item) : emptyForm,
  );
  const [touched, setTouched] = useState<TouchedFields>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateFormDraft(formValues);
  const isFormValid = Object.keys(fieldErrors).length === 0;

  const showFieldError = (field: keyof IngredientFormValues): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }

    return fieldErrors[field];
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid) {
      return;
    }

    await onSave(draftToFormValues(formValues));
  };

  const updateField = <K extends keyof IngredientFormDraft>(
    field: K,
    value: IngredientFormDraft[K],
  ) => {
    setFormValues((current) => ({ ...current, [field]: value }));
    setTouched((current) => ({ ...current, [field]: true }));
  };

  const inputClassName =
    "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

  const nameError = showFieldError("name");
  const categoryError = showFieldError("category_id");
  const unitError = showFieldError("unit");
  const currentStockError = showFieldError("current_stock");
  const minimumStockError = showFieldError("minimum_stock");
  const costError = showFieldError("cost_per_unit");

  return (
    <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-900">
          {item ? "Edit Ingredient" : "Add Ingredient"}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          {item
            ? "Update ingredient details and stock information."
            : "Create a new ingredient and set its initial stock levels."}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={formValues.name}
            onChange={(event) => updateField("name", event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
            className={inputClassName}
            placeholder="e.g. All-purpose flour"
            aria-invalid={Boolean(nameError)}
          />
          {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="category_id"
              className="block text-sm font-medium text-zinc-700"
            >
              Category
            </label>
            <select
              id="category_id"
              value={formValues.category_id}
              onChange={(event) => updateField("category_id", event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, category_id: true }))
              }
              className={inputClassName}
              aria-invalid={Boolean(categoryError)}
            >
              <option value="">Select category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoryError && (
              <p className="text-sm text-red-600">{categoryError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="supplier_id"
              className="block text-sm font-medium text-zinc-700"
            >
              Supplier
            </label>
            <select
              id="supplier_id"
              value={formValues.supplier_id}
              onChange={(event) => updateField("supplier_id", event.target.value)}
              className={inputClassName}
            >
              <option value="">No supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="unit" className="block text-sm font-medium text-zinc-700">
            Unit
          </label>
          <input
            id="unit"
            type="text"
            value={formValues.unit}
            onChange={(event) => updateField("unit", event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, unit: true }))}
            className={inputClassName}
            placeholder="e.g. kg, L, pcs"
            aria-invalid={Boolean(unitError)}
          />
          {unitError && <p className="text-sm text-red-600">{unitError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label
              htmlFor="current_stock"
              className="block text-sm font-medium text-zinc-700"
            >
              Current Stock
            </label>
            <NumericInput
              id="current_stock"
              value={formValues.current_stock}
              onChange={(value) => updateField("current_stock", value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, current_stock: true }))
              }
              placeholder="0"
              aria-invalid={Boolean(currentStockError)}
            />
            {currentStockError && (
              <p className="text-sm text-red-600">{currentStockError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="minimum_stock"
              className="block text-sm font-medium text-zinc-700"
            >
              Minimum Stock
            </label>
            <NumericInput
              id="minimum_stock"
              value={formValues.minimum_stock}
              onChange={(value) => updateField("minimum_stock", value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, minimum_stock: true }))
              }
              placeholder="0"
              aria-invalid={Boolean(minimumStockError)}
            />
            {minimumStockError && (
              <p className="text-sm text-red-600">{minimumStockError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="cost_per_unit"
              className="block text-sm font-medium text-zinc-700"
            >
              Cost Per Unit
            </label>
            <NumericInput
              id="cost_per_unit"
              value={formValues.cost_per_unit}
              onChange={(value) => updateField("cost_per_unit", value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, cost_per_unit: true }))
              }
              placeholder="0.00"
              aria-invalid={Boolean(costError)}
            />
            {costError && <p className="text-sm text-red-600">{costError}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
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
  );
}

export function IngredientModal({
  isOpen,
  item,
  categories,
  suppliers,
  isSaving,
  error,
  onClose,
  onSave,
}: IngredientModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : onClose}
        disabled={isSaving}
      />

      <IngredientModalForm
        key={item?.id ?? "create"}
        item={item}
        categories={categories}
        suppliers={suppliers}
        isSaving={isSaving}
        error={error}
        onClose={onClose}
        onSave={onSave}
      />
    </div>
  );
}
