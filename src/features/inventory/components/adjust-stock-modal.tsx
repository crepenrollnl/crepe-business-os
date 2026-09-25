"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { NumericInput, parseNumericInput } from "@/components/ui/numeric-input";
import { writeOffPrefillHref } from "@/features/write-offs/utils/write-off-href";
import type { IngredientWithRelations } from "../types/inventory";
import {
  INVENTORY_ADJUSTMENT_DIRECTIONS,
  INVENTORY_ADJUSTMENT_REASON_LABELS,
  INVENTORY_ADJUSTMENT_REASONS,
  type InventoryAdjustmentDirection,
  type InventoryAdjustmentReason,
  type RecordInventoryAdjustmentInput,
} from "../types/inventory-adjustment";

interface AdjustStockDraft {
  direction: InventoryAdjustmentDirection;
  quantity: string;
  reason: InventoryAdjustmentReason;
  note: string;
}

type FormErrors = Partial<Record<"quantity", string>>;

function emptyDraft(): AdjustStockDraft {
  return {
    direction: "increase",
    quantity: "",
    reason: "physical_count",
    note: "",
  };
}

function formatStockQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

function validateDraft(
  draft: AdjustStockDraft,
  currentStock: number,
): FormErrors {
  const errors: FormErrors = {};
  const quantity = parseNumericInput(draft.quantity);

  if (quantity === null || quantity <= 0) {
    errors.quantity = "Enter a quantity greater than 0";
    return errors;
  }

  if (draft.direction === "decrease" && quantity > currentStock) {
    errors.quantity = `Not enough stock for this decrease. Available: ${formatStockQuantity(currentStock)}.`;
  }

  return errors;
}

function draftToInput(
  ingredientId: string,
  draft: AdjustStockDraft,
): RecordInventoryAdjustmentInput {
  return {
    ingredientId,
    direction: draft.direction,
    quantity: parseNumericInput(draft.quantity) ?? 0,
    reason: draft.reason,
    note: draft.note.trim() || null,
  };
}

function previewStock(
  currentStock: number,
  direction: InventoryAdjustmentDirection,
  quantity: number | null,
): number | null {
  if (quantity === null || quantity <= 0) {
    return null;
  }

  return direction === "increase"
    ? currentStock + quantity
    : currentStock - quantity;
}

type AdjustStockModalProps = {
  isOpen: boolean;
  item: IngredientWithRelations | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: RecordInventoryAdjustmentInput) => Promise<boolean>;
};

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

type AdjustStockFormProps = Omit<AdjustStockModalProps, "isOpen"> & {
  item: IngredientWithRelations;
};

function AdjustStockForm({
  item,
  isSaving,
  error,
  onClose,
  onSubmit,
}: AdjustStockFormProps) {
  const [draft, setDraft] = useState<AdjustStockDraft>(emptyDraft);
  const [touched, setTouched] = useState<Partial<Record<"quantity", boolean>>>(
    {},
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateDraft(draft, item.current_stock);
  const isFormValid = Object.keys(fieldErrors).length === 0;
  const parsedQuantity = parseNumericInput(draft.quantity);
  const nextStock = previewStock(
    item.current_stock,
    draft.direction,
    parsedQuantity,
  );

  const showQuantityError =
    hasAttemptedSubmit || touched.quantity
      ? fieldErrors.quantity
      : undefined;

  const updateField = <K extends keyof AdjustStockDraft>(
    field: K,
    value: AdjustStockDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "quantity") {
      setTouched((current) => ({ ...current, quantity: true }));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid) {
      return;
    }

    await onSubmit(draftToInput(item.id, draft));
  };

  return (
    <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-900">Adjust Stock</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {item.name} ({item.unit})
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

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="space-y-4"
      >
        <div className="space-y-2">
          <p className="block text-sm font-medium text-zinc-700">
            Current stock
          </p>
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700">
            {formatStockQuantity(item.current_stock)} {item.unit}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-700">
            Direction
          </legend>
          <div className="flex gap-2">
            {INVENTORY_ADJUSTMENT_DIRECTIONS.map((direction) => (
              <button
                key={direction}
                type="button"
                aria-pressed={draft.direction === direction}
                onClick={() => updateField("direction", direction)}
                className={`rounded-lg px-3 py-2 text-sm font-medium capitalize transition-colors ${
                  draft.direction === direction
                    ? "bg-amber-500 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                {direction}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <label
            htmlFor="adjustStockQuantity"
            className="block text-sm font-medium text-zinc-700"
          >
            Quantity
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <NumericInput
                id="adjustStockQuantity"
                value={draft.quantity}
                onChange={(value) => updateField("quantity", value)}
                onBlur={() =>
                  setTouched((current) => ({ ...current, quantity: true }))
                }
                placeholder="0"
                aria-invalid={Boolean(showQuantityError)}
              />
            </div>
            <span className="shrink-0 text-sm text-zinc-500">{item.unit}</span>
          </div>
          {showQuantityError && (
            <p className="text-sm text-red-600">{showQuantityError}</p>
          )}
        </div>

        {nextStock !== null ? (
          <p className="text-sm text-zinc-600">
            New stock:{" "}
            <span className="font-medium text-zinc-900">
              {formatStockQuantity(nextStock)} {item.unit}
            </span>
          </p>
        ) : null}

        <div className="space-y-2">
          <label
            htmlFor="adjustStockReason"
            className="block text-sm font-medium text-zinc-700"
          >
            Reason
          </label>
          <select
            id="adjustStockReason"
            value={draft.reason}
            onChange={(event) =>
              updateField(
                "reason",
                event.target.value as InventoryAdjustmentReason,
              )
            }
            className={inputClassName}
          >
            {INVENTORY_ADJUSTMENT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {INVENTORY_ADJUSTMENT_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="adjustStockNote"
            className="block text-sm font-medium text-zinc-700"
          >
            Note <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <textarea
            id="adjustStockNote"
            value={draft.note}
            onChange={(event) => updateField("note", event.target.value)}
            className={inputClassName}
            rows={2}
            placeholder="Optional context for this adjustment"
          />
        </div>

        <p className="text-sm text-zinc-500">
          Spoilage, damage, or staff use →{" "}
          <Link
            href={writeOffPrefillHref("ingredient", item.id)}
            className="font-medium text-zinc-700 underline hover:text-zinc-900"
          >
            Write off
          </Link>
          , not this form.
        </p>

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

export function AdjustStockModal({
  isOpen,
  item,
  isSaving,
  error,
  onClose,
  onSubmit,
}: AdjustStockModalProps) {
  if (!isOpen || !item) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : onClose}
        disabled={isSaving}
      />

      <AdjustStockForm
        key={item.id}
        item={item}
        isSaving={isSaving}
        error={error}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </div>
  );
}
