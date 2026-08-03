"use client";

import { useState, type FormEvent } from "react";
import { NumericInput, parseNumericInput } from "@/components/ui/numeric-input";
import type { RegisterFixedAssetInput } from "../types/fixed-asset";

interface FixedAssetFormDraft {
  name: string;
  purchaseDate: string;
  cost: string;
  usefulLifeMonths: string;
}

function emptyDraft(): FixedAssetFormDraft {
  return {
    name: "",
    purchaseDate: "",
    cost: "",
    usefulLifeMonths: "",
  };
}

type FormErrors = Partial<Record<keyof FixedAssetFormDraft, string>>;

function validateDraft(draft: FixedAssetFormDraft): FormErrors {
  const errors: FormErrors = {};

  if (!draft.name.trim()) {
    errors.name = "Name is required";
  }

  if (!draft.purchaseDate) {
    errors.purchaseDate = "Purchase date is required";
  }

  const cost = parseNumericInput(draft.cost);
  if (cost === null || cost <= 0) {
    errors.cost = "Enter a cost greater than 0";
  }

  const usefulLifeMonths = parseNumericInput(draft.usefulLifeMonths);
  if (
    usefulLifeMonths === null ||
    !Number.isInteger(usefulLifeMonths) ||
    usefulLifeMonths <= 0
  ) {
    errors.usefulLifeMonths = "Enter a whole number of months greater than 0";
  }

  return errors;
}

function draftToInput(draft: FixedAssetFormDraft): RegisterFixedAssetInput {
  return {
    name: draft.name.trim(),
    purchaseDate: draft.purchaseDate,
    cost: parseNumericInput(draft.cost) ?? 0,
    usefulLifeMonths: parseNumericInput(draft.usefulLifeMonths) ?? 0,
  };
}

interface FixedAssetFormProps {
  isSaving: boolean;
  error: string | null;
  onSubmit: (input: RegisterFixedAssetInput) => Promise<boolean>;
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function FixedAssetForm({ isSaving, error, onSubmit }: FixedAssetFormProps) {
  const [draft, setDraft] = useState<FixedAssetFormDraft>(emptyDraft);
  const [touched, setTouched] = useState<Partial<Record<keyof FixedAssetFormDraft, boolean>>>(
    {},
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateDraft(draft);
  const isFormValid = Object.keys(fieldErrors).length === 0;

  const showFieldError = (field: keyof FixedAssetFormDraft): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }
    return fieldErrors[field];
  };

  const updateField = <K extends keyof FixedAssetFormDraft>(
    field: K,
    value: FixedAssetFormDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setTouched((current) => ({ ...current, [field]: true }));
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

  const nameError = showFieldError("name");
  const purchaseDateError = showFieldError("purchaseDate");
  const costError = showFieldError("cost");
  const usefulLifeError = showFieldError("usefulLifeMonths");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Register a fixed asset</h2>
      <p className="mt-1 text-sm text-zinc-500">
        For assets already owned before this system existed. No journal is
        posted here — only future monthly depreciation is.
      </p>

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
        <div className="space-y-2">
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={draft.name}
            onChange={(event) => updateField("name", event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
            className={inputClassName}
            placeholder="e.g. Food truck, Refrigeration unit"
            aria-invalid={Boolean(nameError)}
          />
          {nameError && <p className="text-sm text-red-600">{nameError}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <label
              htmlFor="purchaseDate"
              className="block text-sm font-medium text-zinc-700"
            >
              Purchase Date
            </label>
            <input
              id="purchaseDate"
              type="date"
              value={draft.purchaseDate}
              onChange={(event) => updateField("purchaseDate", event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, purchaseDate: true }))
              }
              className={inputClassName}
              aria-invalid={Boolean(purchaseDateError)}
            />
            {purchaseDateError && (
              <p className="text-sm text-red-600">{purchaseDateError}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="cost" className="block text-sm font-medium text-zinc-700">
              Cost
            </label>
            <NumericInput
              id="cost"
              value={draft.cost}
              onChange={(value) => updateField("cost", value)}
              onBlur={() => setTouched((current) => ({ ...current, cost: true }))}
              placeholder="0.00"
              aria-invalid={Boolean(costError)}
            />
            {costError && <p className="text-sm text-red-600">{costError}</p>}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="usefulLifeMonths"
              className="block text-sm font-medium text-zinc-700"
            >
              Useful Life (Months)
            </label>
            <NumericInput
              id="usefulLifeMonths"
              value={draft.usefulLifeMonths}
              onChange={(value) => updateField("usefulLifeMonths", value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, usefulLifeMonths: true }))
              }
              placeholder="e.g. 60"
              aria-invalid={Boolean(usefulLifeError)}
            />
            {usefulLifeError && (
              <p className="text-sm text-red-600">{usefulLifeError}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving || !isFormValid}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Registering..." : "Register asset"}
          </button>
        </div>
      </form>
    </div>
  );
}
