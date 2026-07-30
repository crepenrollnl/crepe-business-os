"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import { PurchaseAccountingPreview } from "./purchase-accounting-preview";
import { purchaseTaxService } from "../services/purchase-tax-service";
import type {
  PurchaseFormValues,
  PurchaseIngredientOption,
  PurchaseLineInput,
  PurchaseStatus,
  PurchaseSupplier,
  PurchaseWithRelations,
} from "../types/purchase";
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";
import {
  PURCHASE_TAX_CATEGORY_OPTIONS,
  PURCHASE_TAX_REGIME_OPTIONS,
  type PurchaseTaxResult,
} from "../types/purchase-tax";
import { buildPurchaseTaxDocument } from "../utils/build-purchase-tax-document";

/** Debounce delay before re-requesting the tax preview RPC after an edit. */
const TAX_PREVIEW_DEBOUNCE_MS = 400;

type PurchaseDocumentModalProps = {
  isOpen: boolean;
  purchase: PurchaseWithRelations | null;
  initialValues: PurchaseFormValues;
  suppliers: PurchaseSupplier[];
  ingredients: PurchaseIngredientOption[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Existing in-memory / document-derived accounting preview (display only). */
  accountingPreview?: PurchaseAccountingPreviewData | null;
  onClose: () => void;
  onSaveDraft: (values: PurchaseFormValues) => Promise<boolean>;
  onReceiveGoods: (values: PurchaseFormValues) => Promise<boolean>;
};

type NumericLineField = "quantity" | "unit_cost";

type LineDraft = Omit<
  PurchaseLineInput,
  NumericLineField | "discount" | "tax_category" | "tax_regime"
> & {
  quantity: string;
  unit_cost: string;
  discount: string;
  tax_category: string;
  tax_regime: string;
};

type FormDraft = Omit<PurchaseFormValues, "lines"> & {
  supplier_country: string;
  tax_country: string;
  lines: LineDraft[];
};

type FormErrors = {
  supplier_id?: string;
  purchased_at?: string;
  lines?: string;
  lineErrors?: Array<{
    ingredient_id?: string;
    quantity?: string;
    unit_cost?: string;
  }>;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function coerceNumericField(value: string): number {
  return parseNumericInput(value) ?? 0;
}

function valuesToDraft(
  values: PurchaseFormValues,
  options?: { emptyNumericDefaults?: boolean },
): FormDraft {
  return {
    ...values,
    supplier_country: values.supplier_country ?? "NL",
    tax_country: values.tax_country ?? "NL",
    lines: values.lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: options?.emptyNumericDefaults
        ? ""
        : formatNumericInput(line.quantity),
      unit_cost: options?.emptyNumericDefaults
        ? ""
        : formatNumericInput(line.unit_cost),
      discount: options?.emptyNumericDefaults
        ? ""
        : formatNumericInput(line.discount ?? 0),
      tax_category: line.tax_category ?? "goods",
      tax_regime: line.tax_regime ?? "standard_vat",
    })),
  };
}

function draftToValues(draft: FormDraft): PurchaseFormValues {
  return {
    supplier_id: draft.supplier_id,
    invoice_number: draft.invoice_number,
    purchased_at: draft.purchased_at,
    notes: draft.notes,
    supplier_country: draft.supplier_country,
    tax_country: draft.tax_country,
    lines: draft.lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: coerceNumericField(line.quantity),
      unit_cost: coerceNumericField(line.unit_cost),
      discount: coerceNumericField(line.discount),
      tax_category: line.tax_category,
      tax_regime: line.tax_regime,
    })),
  };
}

function validateDraft(
  draft: FormDraft,
  options?: { requireSupplier?: boolean },
): FormErrors {
  const errors: FormErrors = {};
  const lineErrors: NonNullable<FormErrors["lineErrors"]> = [];

  // Drafts may omit supplier (e.g. Production Planning). Receiving requires one.
  if (options?.requireSupplier && !draft.supplier_id) {
    errors.supplier_id = "Supplier is required";
  }

  if (!draft.purchased_at) {
    errors.purchased_at = "Purchase date is required";
  }

  if (draft.lines.length === 0) {
    errors.lines = "Add at least one purchase line";
  }

  draft.lines.forEach((line) => {
    const lineError: {
      ingredient_id?: string;
      quantity?: string;
      unit_cost?: string;
    } = {};

    if (!line.ingredient_id) {
      lineError.ingredient_id = "Ingredient is required";
    }

    const quantity = parseNumericInput(line.quantity);
    if (quantity === null || quantity <= 0) {
      lineError.quantity = "Quantity must be greater than zero";
    }

    const unitCost = parseNumericInput(line.unit_cost);
    if (unitCost === null || unitCost < 0) {
      lineError.unit_cost = "Unit price must be 0 or greater";
    }

    lineErrors.push(lineError);
  });

  if (lineErrors.some((line) => Object.keys(line).length > 0)) {
    errors.lineErrors = lineErrors;
  }

  return errors;
}

function formatStatus(status: PurchaseStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function getStatusBadgeClass(status: PurchaseStatus): string {
  if (status === "received") {
    return "bg-green-100 text-green-700";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  return "bg-amber-100 text-amber-800";
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

type PurchaseDocumentFormProps = Omit<PurchaseDocumentModalProps, "isOpen">;

function PurchaseDocumentForm({
  purchase,
  initialValues,
  suppliers,
  ingredients,
  isLoading,
  isSaving,
  error,
  accountingPreview = null,
  onClose,
  onSaveDraft,
  onReceiveGoods,
}: PurchaseDocumentFormProps) {
  const [formValues, setFormValues] = useState<FormDraft>(() =>
    valuesToDraft(initialValues, {
      emptyNumericDefaults: purchase === null,
    }),
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const isReadOnly = purchase?.status === "received" || purchase?.status === "cancelled";
  const draftFieldErrors = validateDraft(formValues);
  const receiveFieldErrors = validateDraft(formValues, { requireSupplier: true });
  const fieldErrors = draftFieldErrors;
  const isDraftValid = Object.keys(draftFieldErrors).length === 0;
  const isReceiveValid = Object.keys(receiveFieldErrors).length === 0;

  const [taxPreview, setTaxPreview] = useState<{
    error: string | null;
    data: PurchaseTaxResult | null;
  } | null>(null);
  const [isTaxPreviewLoading, setIsTaxPreviewLoading] = useState(false);

  // Debounced: re-requests the tax preview RPC after edits settle, instead
  // of calculating in-browser synchronously on every keystroke.
  useEffect(() => {
    const values = draftToValues(formValues);
    if (values.lines.length === 0 || !values.purchased_at) {
      setTaxPreview(null);
      setIsTaxPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setIsTaxPreviewLoading(true);

    const timerId = window.setTimeout(() => {
      const document = buildPurchaseTaxDocument({
        values,
        suppliers,
        documentId: purchase?.id,
      });

      void purchaseTaxService.previewPurchaseTaxes(document).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.error || !result.data) {
          setTaxPreview({
            error: result.error ?? "Tax preview unavailable.",
            data: null,
          });
        } else {
          setTaxPreview({ error: null, data: result.data });
        }
        setIsTaxPreviewLoading(false);
      });
    }, TAX_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [formValues, purchase?.id, suppliers]);

  const subtotal = useMemo(() => {
    return roundMoney(
      formValues.lines.reduce((sum, line) => {
        const quantity = coerceNumericField(line.quantity);
        const unitCost = coerceNumericField(line.unit_cost);
        const discount = coerceNumericField(line.discount);
        return sum + quantity * unitCost - discount;
      }, 0),
    );
  }, [formValues.lines]);

  const taxTotal =
    accountingPreview?.tax_total ?? taxPreview?.data?.tax_total ?? 0;
  const netAmount = accountingPreview?.net_amount ?? subtotal;
  const grandTotal =
    accountingPreview?.grand_total ?? roundMoney(subtotal + taxTotal);
  const previewCurrency = accountingPreview?.currency ?? "EUR";

  const previewForDisplay: PurchaseAccountingPreviewData = accountingPreview ?? {
    net_amount: netAmount,
    tax_total: taxTotal,
    grand_total: grandTotal,
    currency: previewCurrency,
    status: "draft_proposal",
    has_proposal: false,
    lines: [],
  };

  const updateHeader = <K extends keyof Omit<FormDraft, "lines">>(
    field: K,
    value: FormDraft[K],
  ) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const updateLine = <K extends keyof LineDraft>(
    index: number,
    field: K,
    value: LineDraft[K],
  ) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    }));
  };

  const addLine = () => {
    setFormValues((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          ingredient_id: "",
          quantity: "",
          unit_cost: "",
          discount: "",
          tax_category: "goods",
          tax_regime: "standard_vat",
        },
      ],
    }));
  };

  const removeLine = (index: number) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  };

  const handleAction = async (
    action: (values: PurchaseFormValues) => Promise<boolean>,
    options?: { requireSupplier?: boolean },
  ) => {
    setHasAttemptedSubmit(true);

    const isValid = options?.requireSupplier ? isReceiveValid : isDraftValid;

    if (!isValid) {
      return;
    }

    await action(draftToValues(formValues));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  if (isLoading) {
    return (
      <div className="relative max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div className="space-y-4">
          <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
          <div className="h-4 w-72 animate-pulse rounded bg-zinc-200" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded bg-zinc-200" />
            ))}
          </div>
          <div className="mt-6 h-40 animate-pulse rounded bg-zinc-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">
            {purchase ? "Purchase Document" : "New Purchase"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {isReadOnly
              ? "Received purchases are read-only and already applied to inventory."
              : "Save as draft without stock changes, or receive goods to increase inventory."}
          </p>
          {purchase?.production_plan_id && (
            <p className="mt-2 text-sm text-amber-700">
              Linked to a Production Plan. Complete supplier and prices, then
              receive goods in Purchases.
            </p>
          )}
        </div>

        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(
            purchase?.status ?? "draft",
          )}`}
        >
          {formatStatus(purchase?.status ?? "draft")}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
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
              onChange={(event) => updateHeader("supplier_id", event.target.value)}
              disabled={isReadOnly || isSaving}
              className={inputClassName}
              aria-invalid={Boolean(
                hasAttemptedSubmit && receiveFieldErrors.supplier_id,
              )}
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            {hasAttemptedSubmit && receiveFieldErrors.supplier_id && (
              <p className="text-sm text-red-600">
                {receiveFieldErrors.supplier_id}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="invoice_number"
              className="block text-sm font-medium text-zinc-700"
            >
              Invoice number
            </label>
            <input
              id="invoice_number"
              type="text"
              value={formValues.invoice_number}
              onChange={(event) =>
                updateHeader("invoice_number", event.target.value)
              }
              disabled={isReadOnly || isSaving}
              className={inputClassName}
              placeholder="e.g. INV-1042"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="purchased_at"
              className="block text-sm font-medium text-zinc-700"
            >
              Purchase date
            </label>
            <input
              id="purchased_at"
              type="date"
              value={formValues.purchased_at}
              onChange={(event) =>
                updateHeader("purchased_at", event.target.value)
              }
              disabled={isReadOnly || isSaving}
              className={inputClassName}
              aria-invalid={Boolean(
                hasAttemptedSubmit && fieldErrors.purchased_at,
              )}
            />
            {hasAttemptedSubmit && fieldErrors.purchased_at && (
              <p className="text-sm text-red-600">{fieldErrors.purchased_at}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="status_display"
              className="block text-sm font-medium text-zinc-700"
            >
              Status
            </label>
            <input
              id="status_display"
              type="text"
              value={formatStatus(purchase?.status ?? "draft")}
              disabled
              className={inputClassName}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="supplier_country"
              className="block text-sm font-medium text-zinc-700"
            >
              Supplier country
            </label>
            <input
              id="supplier_country"
              type="text"
              value={formValues.supplier_country}
              onChange={(event) =>
                updateHeader("supplier_country", event.target.value.toUpperCase())
              }
              disabled={isReadOnly || isSaving}
              className={inputClassName}
              placeholder="NL"
              maxLength={2}
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="tax_country"
              className="block text-sm font-medium text-zinc-700"
            >
              Tax country
            </label>
            <input
              id="tax_country"
              type="text"
              value={formValues.tax_country}
              onChange={(event) =>
                updateHeader("tax_country", event.target.value.toUpperCase())
              }
              disabled={isReadOnly || isSaving}
              className={inputClassName}
              placeholder="NL"
              maxLength={2}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="notes"
            className="block text-sm font-medium text-zinc-700"
          >
            Notes
          </label>
          <textarea
            id="notes"
            value={formValues.notes}
            onChange={(event) => updateHeader("notes", event.target.value)}
            disabled={isReadOnly || isSaving}
            rows={3}
            className={inputClassName}
            placeholder="Optional notes about this purchase"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-900">Lines</h3>
            {!isReadOnly && (
              <button
                type="button"
                onClick={addLine}
                disabled={isSaving}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Add line
              </button>
            )}
          </div>

          {hasAttemptedSubmit && fieldErrors.lines && (
            <p className="text-sm text-red-600">{fieldErrors.lines}</p>
          )}

          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                      Ingredient
                    </th>
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Quantity
                    </th>
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Unit price
                    </th>
                    <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                      Tax category
                    </th>
                    <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                      Tax regime
                    </th>
                    <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                      Tax code
                    </th>
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Tax %
                    </th>
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Tax amount
                    </th>
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Line total
                    </th>
                    {!isReadOnly && (
                      <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {formValues.lines.map((line, index) => {
                    const lineTotal = roundMoney(
                      coerceNumericField(line.quantity) *
                        coerceNumericField(line.unit_cost) -
                        coerceNumericField(line.discount),
                    );
                    const lineError = fieldErrors.lineErrors?.[index];
                    const taxLine = taxPreview?.data?.lines.find(
                      (row) => row.line_id === `line-${index + 1}`,
                    );

                    return (
                      <tr key={index} className="border-t border-zinc-200">
                        <td className="px-3 py-3 align-top">
                          <select
                            value={line.ingredient_id}
                            onChange={(event) =>
                              updateLine(index, "ingredient_id", event.target.value)
                            }
                            disabled={isReadOnly || isSaving}
                            className={inputClassName}
                            aria-invalid={Boolean(
                              hasAttemptedSubmit && lineError?.ingredient_id,
                            )}
                          >
                            <option value="">Select ingredient</option>
                            {ingredients.map((ingredient) => (
                              <option key={ingredient.id} value={ingredient.id}>
                                {ingredient.name} ({ingredient.unit})
                              </option>
                            ))}
                          </select>
                          {hasAttemptedSubmit && lineError?.ingredient_id && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.ingredient_id}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <NumericInput
                            value={line.quantity}
                            onChange={(value) =>
                              updateLine(index, "quantity", value)
                            }
                            disabled={isReadOnly || isSaving}
                            className="text-right"
                            placeholder="0"
                            aria-invalid={Boolean(
                              hasAttemptedSubmit && lineError?.quantity,
                            )}
                          />
                          {hasAttemptedSubmit && lineError?.quantity && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.quantity}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <NumericInput
                            value={line.unit_cost}
                            onChange={(value) =>
                              updateLine(index, "unit_cost", value)
                            }
                            disabled={isReadOnly || isSaving}
                            className="text-right"
                            placeholder="0.00"
                            aria-invalid={Boolean(
                              hasAttemptedSubmit && lineError?.unit_cost,
                            )}
                          />
                          {hasAttemptedSubmit && lineError?.unit_cost && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.unit_cost}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <select
                            value={line.tax_category}
                            onChange={(event) =>
                              updateLine(index, "tax_category", event.target.value)
                            }
                            disabled={isReadOnly || isSaving}
                            className={inputClassName}
                          >
                            {PURCHASE_TAX_CATEGORY_OPTIONS.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <select
                            value={line.tax_regime}
                            onChange={(event) =>
                              updateLine(index, "tax_regime", event.target.value)
                            }
                            disabled={isReadOnly || isSaving}
                            className={inputClassName}
                          >
                            {PURCHASE_TAX_REGIME_OPTIONS.map((regime) => (
                              <option key={regime} value={regime}>
                                {regime}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3 align-top text-sm text-zinc-700">
                          {taxLine?.tax_code ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right align-top text-sm text-zinc-700">
                          {taxLine?.tax_rate_percent !== null &&
                          taxLine?.tax_rate_percent !== undefined
                            ? `${taxLine.tax_rate_percent}%`
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right align-top text-sm text-zinc-700">
                          €{(taxLine?.tax_amount ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-3 text-right align-top text-sm font-medium text-zinc-900">
                          €{lineTotal.toFixed(2)}
                        </td>
                        {!isReadOnly && (
                          <td className="px-3 py-3 text-right align-top">
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              disabled={isSaving || formValues.lines.length === 1}
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {isTaxPreviewLoading && (
            <p className="text-sm text-zinc-500">Calculating taxes…</p>
          )}
          {!isTaxPreviewLoading && taxPreview?.error && (
            <p className="text-sm text-amber-700">{taxPreview.error}</p>
          )}
        </div>

        <PurchaseAccountingPreview preview={previewForDisplay} />

        <div className="flex items-center justify-end border-t border-zinc-200 pt-4">
          <div className="space-y-1 text-right">
            <p className="text-sm text-zinc-500">
              Subtotal{" "}
              <span className="font-medium text-zinc-800">
                €{netAmount.toFixed(2)}
              </span>
            </p>
            <p className="text-sm text-zinc-500">
              Tax total{" "}
              <span className="font-medium text-zinc-800">
                €{taxTotal.toFixed(2)}
              </span>
            </p>
            <p className="text-sm text-zinc-500">Grand total</p>
            <p className="text-2xl font-semibold text-zinc-900">
              €{grandTotal.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isReadOnly ? "Close" : "Cancel"}
          </button>

          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={() => void handleAction(onSaveDraft)}
                disabled={isSaving}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAction(onReceiveGoods, { requireSupplier: true })
                }
                disabled={isSaving}
                className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Receiving..." : "Receive Goods"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

export function PurchaseDocumentModal({
  isOpen,
  purchase,
  initialValues,
  suppliers,
  ingredients,
  isLoading,
  isSaving,
  error,
  accountingPreview = null,
  onClose,
  onSaveDraft,
  onReceiveGoods,
}: PurchaseDocumentModalProps) {
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

      <PurchaseDocumentForm
        key={purchase?.id ?? `create-${isLoading ? "loading" : "ready"}`}
        purchase={purchase}
        initialValues={initialValues}
        suppliers={suppliers}
        ingredients={ingredients}
        isLoading={isLoading}
        isSaving={isSaving}
        error={error}
        accountingPreview={accountingPreview}
        onClose={onClose}
        onSaveDraft={onSaveDraft}
        onReceiveGoods={onReceiveGoods}
      />
    </div>
  );
}
