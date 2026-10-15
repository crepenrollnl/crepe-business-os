"use client";

import type { FormEvent } from "react";
import { NumericInput } from "@/components/ui/numeric-input";
import {
  WRITE_OFF_REASON_LABELS,
  WRITE_OFF_REASONS,
  type WriteOffReason,
} from "@/features/write-offs/types/write-off";
import {
  WRITE_OFF_REQUEST_ITEM_TYPE_LABELS,
  WRITE_OFF_REQUEST_ITEM_TYPES,
  WRITE_OFF_REQUEST_NOTE_MAX_LENGTH,
  type WriteOffRequestItemOption,
  type WriteOffRequestItemType,
} from "../types/write-off-request";
import type { WriteOffRequestDraft } from "../hooks/use-write-off-request-form";

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

type WriteOffRequestFormProps = {
  draft: WriteOffRequestDraft;
  filteredOptions: WriteOffRequestItemOption[];
  selectedItem: WriteOffRequestItemOption | null;
  optionsLoading: boolean;
  optionsError: string | null;
  submitting: boolean;
  submitError: string | null;
  success: string | null;
  onItemTypeChange: (itemType: WriteOffRequestItemType) => void;
  onFieldChange: <K extends keyof WriteOffRequestDraft>(
    field: K,
    value: WriteOffRequestDraft[K],
  ) => void;
  onSubmit: () => Promise<boolean>;
  onRetryOptions: () => void;
};

/**
 * Ask for a write-off (any role). Shows names and units only — never a
 * cost, value or price. Nothing changes in stock until it is approved.
 */
export function WriteOffRequestForm({
  draft,
  filteredOptions,
  selectedItem,
  optionsLoading,
  optionsError,
  submitting,
  submitError,
  success,
  onItemTypeChange,
  onFieldChange,
  onSubmit,
  onRetryOptions,
}: WriteOffRequestFormProps) {
  const itemLabel = WRITE_OFF_REQUEST_ITEM_TYPE_LABELS[draft.itemType];

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6"
      data-testid="write-off-request-form"
    >
      <fieldset>
        <legend className="mb-2 block text-sm font-medium text-zinc-700">Type</legend>
        <div className="flex flex-wrap gap-2">
          {WRITE_OFF_REQUEST_ITEM_TYPES.map((itemType) => (
            <button
              key={itemType}
              type="button"
              aria-pressed={draft.itemType === itemType}
              onClick={() => onItemTypeChange(itemType)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                draft.itemType === itemType
                  ? "bg-amber-500 text-white"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {WRITE_OFF_REQUEST_ITEM_TYPE_LABELS[itemType]}
            </button>
          ))}
        </div>
      </fieldset>

      {optionsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {optionsError}{" "}
          <button
            type="button"
            onClick={onRetryOptions}
            className="font-semibold underline"
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="writeOffRequestSearch" className="block text-sm font-medium text-zinc-700">
            Search
          </label>
          <input
            id="writeOffRequestSearch"
            type="search"
            value={draft.search}
            onChange={(event) => onFieldChange("search", event.target.value)}
            className={inputClassName}
            placeholder={`Filter ${itemLabel.toLowerCase()}s`}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="writeOffRequestItem" className="block text-sm font-medium text-zinc-700">
            {itemLabel}
          </label>
          <select
            id="writeOffRequestItem"
            value={draft.itemId}
            onChange={(event) => onFieldChange("itemId", event.target.value)}
            className={inputClassName}
            disabled={optionsLoading}
          >
            <option value="">
              {optionsLoading ? "Loading…" : `Select ${itemLabel.toLowerCase()}`}
            </option>
            {filteredOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.unit ? `${option.name} (${option.unit})` : option.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="writeOffRequestQuantity" className="block text-sm font-medium text-zinc-700">
            Quantity
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <NumericInput
                id="writeOffRequestQuantity"
                value={draft.quantity}
                onChange={(value) => onFieldChange("quantity", value)}
                placeholder="0"
              />
            </div>
            {selectedItem?.unit ? (
              <span className="shrink-0 text-sm text-zinc-500">{selectedItem.unit}</span>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="writeOffRequestReason" className="block text-sm font-medium text-zinc-700">
            Reason
          </label>
          <select
            id="writeOffRequestReason"
            value={draft.reason}
            onChange={(event) =>
              onFieldChange("reason", event.target.value as WriteOffReason)
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
        <label htmlFor="writeOffRequestNote" className="block text-sm font-medium text-zinc-700">
          Note <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="writeOffRequestNote"
          value={draft.note}
          maxLength={WRITE_OFF_REQUEST_NOTE_MAX_LENGTH}
          onChange={(event) => onFieldChange("note", event.target.value)}
          className={inputClassName}
          rows={2}
          placeholder="What happened?"
        />
      </div>

      {submitError ? (
        <p role="alert" className="text-sm text-red-600">
          {submitError}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-sm font-medium text-emerald-700">
          {success}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || optionsLoading}
          className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {submitting ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}
