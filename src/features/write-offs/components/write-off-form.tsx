"use client";

import { useMemo, useState, type FormEvent } from "react";
import { NumericInput, parseNumericInput } from "@/components/ui/numeric-input";
import {
  WRITE_OFF_REASON_LABELS,
  WRITE_OFF_REASONS,
  type RecordWriteOffInput,
  type WriteOffIngredientOption,
  type WriteOffItemType,
  type WriteOffProductOption,
  type WriteOffReason,
} from "../types/write-off";

interface WriteOffFormDraft {
  itemType: WriteOffItemType;
  itemId: string;
  quantity: string;
  reason: WriteOffReason;
  note: string;
  search: string;
}

function emptyDraft(prefill?: {
  itemType?: WriteOffItemType | null;
  itemId?: string | null;
}): WriteOffFormDraft {
  return {
    itemType: prefill?.itemType ?? "ingredient",
    itemId: prefill?.itemId ?? "",
    quantity: "",
    reason: "spoilage",
    note: "",
    search: "",
  };
}

type FormErrors = Partial<Record<"itemId" | "quantity", string>>;

function validateDraft(draft: WriteOffFormDraft): FormErrors {
  const errors: FormErrors = {};

  if (!draft.itemId) {
    errors.itemId =
      draft.itemType === "ingredient"
        ? "Select an ingredient"
        : "Select a finished good";
  }

  const quantity = parseNumericInput(draft.quantity);
  if (quantity === null || quantity <= 0) {
    errors.quantity = "Enter a quantity greater than 0";
  }

  return errors;
}

function draftToInput(draft: WriteOffFormDraft): RecordWriteOffInput {
  return {
    itemType: draft.itemType,
    ingredientId: draft.itemType === "ingredient" ? draft.itemId : null,
    productId: draft.itemType === "finished_good" ? draft.itemId : null,
    quantity: parseNumericInput(draft.quantity) ?? 0,
    reason: draft.reason,
    note: draft.note.trim() || null,
  };
}

interface WriteOffFormProps {
  ingredients: WriteOffIngredientOption[];
  products: WriteOffProductOption[];
  isSaving: boolean;
  error: string | null;
  lastSuccess: string | null;
  postingWarning: string | null;
  accountingNote: string | null;
  prefillItemType?: WriteOffItemType | null;
  prefillItemId?: string | null;
  onSubmit: (input: RecordWriteOffInput) => Promise<boolean>;
  onDismissSuccess: () => void;
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function WriteOffForm({
  ingredients,
  products,
  isSaving,
  error,
  lastSuccess,
  postingWarning,
  accountingNote,
  prefillItemType,
  prefillItemId,
  onSubmit,
  onDismissSuccess,
}: WriteOffFormProps) {
  const [draft, setDraft] = useState<WriteOffFormDraft>(() =>
    emptyDraft({ itemType: prefillItemType, itemId: prefillItemId }),
  );
  const [touched, setTouched] = useState<
    Partial<Record<"itemId" | "quantity", boolean>>
  >({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateDraft(draft);
  const isFormValid = Object.keys(fieldErrors).length === 0;

  const showFieldError = (
    field: "itemId" | "quantity",
  ): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }
    return fieldErrors[field];
  };

  const options = draft.itemType === "ingredient" ? ingredients : products;
  const filteredOptions = useMemo(() => {
    const query = draft.search.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((option) =>
      option.name.toLowerCase().includes(query),
    );
  }, [draft.search, options]);

  const updateField = <K extends keyof WriteOffFormDraft>(
    field: K,
    value: WriteOffFormDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "itemId" || field === "quantity") {
      setTouched((current) => ({ ...current, [field]: true }));
    }
  };

  const setItemType = (itemType: WriteOffItemType) => {
    setDraft((current) => ({
      ...current,
      itemType,
      itemId: "",
      search: "",
    }));
    setTouched((current) => ({ ...current, itemId: true }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid) {
      return;
    }

    const succeeded = await onSubmit(draftToInput(draft));

    if (succeeded) {
      setDraft(emptyDraft());
      setTouched({});
      setHasAttemptedSubmit(false);
    }
  };

  const itemError = showFieldError("itemId");
  const quantityError = showFieldError("quantity");
  const itemLabel =
    draft.itemType === "ingredient" ? "Ingredient" : "Finished good";
  const selectedIngredient =
    draft.itemType === "ingredient"
      ? ingredients.find((ingredient) => ingredient.id === draft.itemId)
      : undefined;
  const selectedProduct =
    draft.itemType === "finished_good"
      ? products.find((product) => product.id === draft.itemId)
      : undefined;
  const selectedItemUnit = selectedIngredient?.unit ?? selectedProduct?.unit ?? null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Record a write-off</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Removes stock now. Date is always today — the same as production and
        sales.
      </p>

      {lastSuccess && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          <span>{lastSuccess}</span>
          <button
            type="button"
            onClick={onDismissSuccess}
            className="text-emerald-700 underline hover:text-emerald-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {accountingNote && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700"
        >
          <span>{accountingNote}</span>
          <button
            type="button"
            onClick={onDismissSuccess}
            className="text-zinc-600 underline hover:text-zinc-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {postingWarning && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Write-off recorded, but accounting posting failed: {postingWarning}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="mt-6 space-y-4"
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-700">Item type</legend>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={draft.itemType === "ingredient"}
              onClick={() => setItemType("ingredient")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                draft.itemType === "ingredient"
                  ? "bg-amber-500 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Ingredient
            </button>
            <button
              type="button"
              aria-pressed={draft.itemType === "finished_good"}
              onClick={() => setItemType("finished_good")}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                draft.itemType === "finished_good"
                  ? "bg-amber-500 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Finished good
            </button>
          </div>
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="writeOffSearch" className="block text-sm font-medium text-zinc-700">
            Search {itemLabel.toLowerCase()}
          </label>
          <input
            id="writeOffSearch"
            type="search"
            value={draft.search}
            onChange={(event) => updateField("search", event.target.value)}
            className={inputClassName}
            placeholder={`Filter ${itemLabel.toLowerCase()}s`}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="writeOffItemId" className="block text-sm font-medium text-zinc-700">
            {itemLabel}
          </label>
          <select
            id="writeOffItemId"
            value={draft.itemId}
            onChange={(event) => updateField("itemId", event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, itemId: true }))}
            className={inputClassName}
            aria-invalid={Boolean(itemError)}
          >
            <option value="">Select {itemLabel.toLowerCase()}</option>
            {filteredOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.unit ? `${option.name} (${option.unit})` : option.name}
              </option>
            ))}
          </select>
          {itemError && <p className="text-sm text-red-600">{itemError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="writeOffQuantity" className="block text-sm font-medium text-zinc-700">
              Quantity
            </label>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <NumericInput
                  id="writeOffQuantity"
                  value={draft.quantity}
                  onChange={(value) => updateField("quantity", value)}
                  onBlur={() =>
                    setTouched((current) => ({ ...current, quantity: true }))
                  }
                  placeholder="0"
                  aria-invalid={Boolean(quantityError)}
                />
              </div>
              {selectedItemUnit && (
                <span className="shrink-0 text-sm text-zinc-500">
                  {selectedItemUnit}
                </span>
              )}
            </div>
            {quantityError && (
              <p className="text-sm text-red-600">{quantityError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="writeOffReason" className="block text-sm font-medium text-zinc-700">
              Reason
            </label>
            <select
              id="writeOffReason"
              value={draft.reason}
              onChange={(event) =>
                updateField("reason", event.target.value as WriteOffReason)
              }
              className={inputClassName}
            >
              {WRITE_OFF_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {WRITE_OFF_REASON_LABELS[reason]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="writeOffNote" className="block text-sm font-medium text-zinc-700">
            Note <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <textarea
            id="writeOffNote"
            value={draft.note}
            onChange={(event) => updateField("note", event.target.value)}
            className={inputClassName}
            rows={2}
            placeholder="Optional context for this write-off"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving || !isFormValid}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Recording..." : "Record write-off"}
          </button>
        </div>
      </form>
    </div>
  );
}
