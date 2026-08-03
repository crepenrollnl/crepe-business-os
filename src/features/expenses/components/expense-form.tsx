"use client";

import { useState, type FormEvent } from "react";
import { NumericInput, parseNumericInput } from "@/components/ui/numeric-input";
import { calculateExpenseBreakdown } from "../utils/calculate-expense-breakdown";
import {
  EXPENSE_VAT_RATE_OPTIONS,
  type ExpenseAccountOption,
  type RecordExpenseInput,
} from "../types/expense";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ExpenseFormDraft {
  accountId: string;
  expenseDate: string;
  grossAmount: string;
  vatRate: number;
  description: string;
  supplier: string;
}

function emptyDraft(): ExpenseFormDraft {
  return {
    accountId: "",
    expenseDate: todayIsoDate(),
    grossAmount: "",
    vatRate: EXPENSE_VAT_RATE_OPTIONS[0].value,
    description: "",
    supplier: "",
  };
}

type FormErrors = Partial<Record<keyof ExpenseFormDraft, string>>;

function validateDraft(draft: ExpenseFormDraft): FormErrors {
  const errors: FormErrors = {};

  if (!draft.accountId) {
    errors.accountId = "Category is required";
  }

  if (!draft.expenseDate) {
    errors.expenseDate = "Date is required";
  }

  const grossAmount = parseNumericInput(draft.grossAmount);
  if (grossAmount === null || grossAmount <= 0) {
    errors.grossAmount = "Enter an amount greater than 0";
  }

  if (!draft.description.trim()) {
    errors.description = "Description is required";
  }

  return errors;
}

function draftToInput(draft: ExpenseFormDraft): RecordExpenseInput {
  return {
    accountId: draft.accountId,
    expenseDate: draft.expenseDate,
    grossAmount: parseNumericInput(draft.grossAmount) ?? 0,
    vatRate: draft.vatRate,
    description: draft.description.trim(),
    supplier: draft.supplier.trim() || null,
  };
}

function formatEuro(value: number): string {
  return `€${value.toFixed(2)}`;
}

interface ExpenseFormProps {
  accounts: ExpenseAccountOption[];
  isSaving: boolean;
  error: string | null;
  lastPostingNumber: string | null;
  onSubmit: (input: RecordExpenseInput) => Promise<boolean>;
  onDismissSuccess: () => void;
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function ExpenseForm({
  accounts,
  isSaving,
  error,
  lastPostingNumber,
  onSubmit,
  onDismissSuccess,
}: ExpenseFormProps) {
  const [draft, setDraft] = useState<ExpenseFormDraft>(emptyDraft);
  const [touched, setTouched] = useState<Partial<Record<keyof ExpenseFormDraft, boolean>>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateDraft(draft);
  const isFormValid = Object.keys(fieldErrors).length === 0;

  const showFieldError = (field: keyof ExpenseFormDraft): string | undefined => {
    if (!hasAttemptedSubmit && !touched[field]) {
      return undefined;
    }
    return fieldErrors[field];
  };

  const updateField = <K extends keyof ExpenseFormDraft>(
    field: K,
    value: ExpenseFormDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setTouched((current) => ({ ...current, [field]: true }));
  };

  const parsedGross = parseNumericInput(draft.grossAmount) ?? 0;
  const breakdown = calculateExpenseBreakdown(parsedGross, draft.vatRate);

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

  const accountError = showFieldError("accountId");
  const dateError = showFieldError("expenseDate");
  const grossError = showFieldError("grossAmount");
  const descriptionError = showFieldError("description");

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Record an expense</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Paid immediately from Cash/Bank. Posts a balanced journal entry
        automatically.
      </p>

      {lastPostingNumber && (
        <div
          role="status"
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          <span>
            Expense recorded and posted as{" "}
            <span className="font-semibold">{lastPostingNumber}</span>.
          </span>
          <button
            type="button"
            onClick={onDismissSuccess}
            className="text-emerald-700 underline hover:text-emerald-900"
          >
            Dismiss
          </button>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="accountId" className="block text-sm font-medium text-zinc-700">
              Category
            </label>
            <select
              id="accountId"
              value={draft.accountId}
              onChange={(event) => updateField("accountId", event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, accountId: true }))}
              className={inputClassName}
              aria-invalid={Boolean(accountError)}
            >
              <option value="">Select category</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} — {account.name}
                </option>
              ))}
            </select>
            {accountError && <p className="text-sm text-red-600">{accountError}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="expenseDate" className="block text-sm font-medium text-zinc-700">
              Date
            </label>
            <input
              id="expenseDate"
              type="date"
              value={draft.expenseDate}
              onChange={(event) => updateField("expenseDate", event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, expenseDate: true }))}
              className={inputClassName}
              aria-invalid={Boolean(dateError)}
            />
            {dateError && <p className="text-sm text-red-600">{dateError}</p>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="grossAmount" className="block text-sm font-medium text-zinc-700">
              Gross Amount
            </label>
            <NumericInput
              id="grossAmount"
              value={draft.grossAmount}
              onChange={(value) => updateField("grossAmount", value)}
              onBlur={() => setTouched((current) => ({ ...current, grossAmount: true }))}
              placeholder="0.00"
              aria-invalid={Boolean(grossError)}
            />
            {grossError && <p className="text-sm text-red-600">{grossError}</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="vatRate" className="block text-sm font-medium text-zinc-700">
              VAT Rate
            </label>
            <select
              id="vatRate"
              value={draft.vatRate}
              onChange={(event) => updateField("vatRate", Number(event.target.value))}
              className={inputClassName}
            >
              {EXPENSE_VAT_RATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          Net {formatEuro(breakdown.netAmount)} · VAT {formatEuro(breakdown.vatAmount)}{" "}
          · Gross {formatEuro(breakdown.grossAmount)}
        </div>

        <div className="space-y-2">
          <label htmlFor="description" className="block text-sm font-medium text-zinc-700">
            Description
          </label>
          <input
            id="description"
            type="text"
            value={draft.description}
            onChange={(event) => updateField("description", event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, description: true }))}
            className={inputClassName}
            placeholder="What was this expense for?"
            aria-invalid={Boolean(descriptionError)}
          />
          {descriptionError && <p className="text-sm text-red-600">{descriptionError}</p>}
        </div>

        <div className="space-y-2">
          <label htmlFor="supplier" className="block text-sm font-medium text-zinc-700">
            Supplier <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <input
            id="supplier"
            type="text"
            value={draft.supplier}
            onChange={(event) => updateField("supplier", event.target.value)}
            className={inputClassName}
            placeholder="e.g. Shell, Makro"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving || !isFormValid}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Recording..." : "Record expense"}
          </button>
        </div>
      </form>
    </div>
  );
}
