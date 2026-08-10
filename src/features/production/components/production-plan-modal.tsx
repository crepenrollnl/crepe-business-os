"use client";

import { useState, type FormEvent } from "react";
import type { ProductionPlanFormValues } from "../types/production";
import {
  isCreateProductionPlanInputValid,
  validateCreateProductionPlanInput,
} from "../utils/validate-create-production-plan";

type ProductionPlanModalProps = {
  isOpen: boolean;
  initialValues: ProductionPlanFormValues;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: ProductionPlanFormValues) => Promise<boolean>;
};

type FormDraft = ProductionPlanFormValues;
type TouchedFields = Partial<Record<keyof FormDraft, boolean>>;

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

export function ProductionPlanModal({
  isOpen,
  initialValues,
  isSaving,
  error,
  onClose,
  onSave,
}: ProductionPlanModalProps) {
  const [formValues, setFormValues] = useState<FormDraft>(initialValues);
  const [touched, setTouched] = useState<TouchedFields>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  if (!isOpen) {
    return null;
  }

  const fieldErrors = validateCreateProductionPlanInput(formValues);
  const isFormValid = isCreateProductionPlanInputValid(formValues);

  const showFieldError = (field: keyof FormDraft): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }

    return fieldErrors[field as keyof typeof fieldErrors];
  };

  const updateField = <K extends keyof FormDraft>(
    field: K,
    value: FormDraft[K],
  ) => {
    setFormValues((current) => ({ ...current, [field]: value }));
    setTouched((current) => ({ ...current, [field]: true }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid) {
      return;
    }

    await onSave(formValues);
  };

  const nameError = showFieldError("name");
  const planningDateError = showFieldError("planning_date");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : onClose}
        disabled={isSaving}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-zinc-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-zinc-900">
            Create Production Plan
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Create a draft plan for a specific production day. Inventory does
            not change.
          </p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div>
              <label
                htmlFor="production-plan-name"
                className="mb-1.5 block text-sm font-medium text-zinc-700"
              >
                Name
              </label>
              <input
                id="production-plan-name"
                type="text"
                value={formValues.name}
                onChange={(event) => updateField("name", event.target.value)}
                disabled={isSaving}
                placeholder="e.g. Saturday Market Prep"
                className={inputClassName}
                autoFocus
              />
              {nameError && (
                <p className="mt-1.5 text-sm text-red-600">{nameError}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="production-plan-planned-date"
                className="mb-1.5 block text-sm font-medium text-zinc-700"
              >
                Planned Date
              </label>
              <input
                id="production-plan-planned-date"
                type="date"
                value={formValues.planning_date}
                onChange={(event) =>
                  updateField("planning_date", event.target.value)
                }
                disabled={isSaving}
                className={inputClassName}
              />
              {planningDateError && (
                <p className="mt-1.5 text-sm text-red-600">
                  {planningDateError}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="production-plan-notes"
                className="mb-1.5 block text-sm font-medium text-zinc-700"
              >
                Notes
              </label>
              <textarea
                id="production-plan-notes"
                value={formValues.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                disabled={isSaving}
                rows={3}
                placeholder="Optional notes for this plan"
                className={inputClassName}
              />
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
              {isSaving ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
