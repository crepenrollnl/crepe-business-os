"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import { formatMoney, formatUnitCost } from "@/lib/money";
import { PurchaseAccountingPreview } from "./purchase-accounting-preview";
import { PurchaseReceiptsSection } from "./purchase-receipts-section";
import { purchaseService } from "../services/purchase-service";
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
  DEFAULT_TAX_REGIME_BY_CATEGORY,
  formatPurchaseTaxCategoryLabel,
  formatPurchaseTaxRegimeLabel,
  PURCHASE_TAX_CATEGORY_OPTIONS,
  PURCHASE_TAX_REGIME_OPTIONS,
  type PurchaseTaxCategoryCode,
  type PurchaseTaxResult,
} from "../types/purchase-tax";
import { buildPurchaseTaxDocument } from "../utils/build-purchase-tax-document";
import {
  deriveExclusiveUnitCostFromLineTotal,
  LINE_TOTAL_UNIT_PRICE_ERROR,
} from "../utils/derive-exclusive-unit-cost-from-line-total";
import {
  buildLineTotalProbeKey,
  editableLineTotalValue,
  shouldInvalidateLineTotalProbeOnPriceModeChange,
  shouldRunLineTotalProbe,
  unitCostAfterLineTotalProbe,
} from "../utils/line-total-probe-apply";
import {
  automaticPrefillEventKey,
  fillLastPricesNote,
  formatLastPurchaseHint,
  isEmptyOrZeroUnitPrice,
  planAutomaticPrefill,
  planFillLastPrices,
  planUseLastPurchase,
  resolveLastPurchaseSource,
  type LastPurchaseFieldPatch,
  type LastPurchaseLineLookup,
  type PrefillTouchState,
} from "../utils/apply-last-purchase-prefill";

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
  /**
   * Set only when Receive succeeded but posting the Accounting journal
   * failed — the purchase and its stock are already updated regardless.
   */
  postingError?: string | null;
  onClose: () => void;
  onSaveDraft: (values: PurchaseFormValues) => Promise<boolean>;
  onReceiveGoods: (values: PurchaseFormValues) => Promise<boolean>;
  driveConfigured?: boolean;
  driveUnavailable?: boolean;
  onRetryDrive?: (fileIds: string[]) => void;
};

type NumericLineField = "quantity" | "unit_cost";

type LineLastEditedField = "quantity" | "unit_cost" | "line_total" | null;

export type LineDraft = Omit<
  PurchaseLineInput,
  | NumericLineField
  | "discount"
  | "tax_category"
  | "tax_regime"
  | "price_mode"
  | "entered_unit_price"
> & {
  quantity: string;
  unit_cost: string;
  line_total: string;
  last_edited_field: LineLastEditedField;
  discount: string;
  tax_category: string;
  tax_regime: string;
  price_mode: "" | "exclusive" | "inclusive";
  loaded_from_database?: boolean;
  loaded_ingredient_id?: string;
  ingredient_changed?: boolean;
  touched_unit_cost?: boolean;
  touched_price_mode?: boolean;
  touched_tax_category?: boolean;
  touched_tax_regime?: boolean;
  helper_unit_cost?: boolean;
  helper_price_mode?: boolean;
  helper_tax_category?: boolean;
  helper_tax_regime?: boolean;
  /** Last automatic-prefill event applied or considered for this line. */
  prefill_key?: string;
};

function lineTouchState(line: LineDraft): PrefillTouchState {
  return {
    unitCost: line.touched_unit_cost === true,
    priceMode: line.touched_price_mode === true,
    taxCategory: line.touched_tax_category === true,
    taxRegime: line.touched_tax_regime === true,
  };
}

function lineHelperState(line: LineDraft): PrefillTouchState {
  return {
    unitCost: line.helper_unit_cost === true,
    priceMode: line.helper_price_mode === true,
    taxCategory: line.helper_tax_category === true,
    taxRegime: line.helper_tax_regime === true,
  };
}

type UnitCostWriteOptions = {
  fillDespiteTouch?: boolean;
  /** Explicit Use of the current number still counts as the user's price. */
  commitSameValue?: boolean;
};

function withoutPrefillFlags(line: LineDraft): LineDraft {
  return {
    ...line,
    touched_unit_cost: false,
    touched_price_mode: false,
    touched_tax_category: false,
    touched_tax_regime: false,
    helper_unit_cost: false,
    helper_price_mode: false,
    helper_tax_category: false,
    helper_tax_regime: false,
    prefill_key: "",
  };
}

function markPrefillField(
  line: LineDraft,
  field: "unit_cost" | "price_mode" | "tax_category" | "tax_regime",
  origin: "user" | "helper",
): LineDraft {
  const touched = origin === "user";
  if (field === "unit_cost") {
    return {
      ...line,
      touched_unit_cost: touched,
      helper_unit_cost: !touched,
    };
  }
  if (field === "price_mode") {
    return {
      ...line,
      touched_price_mode: touched,
      helper_price_mode: !touched,
    };
  }
  if (field === "tax_category") {
    return {
      ...line,
      touched_tax_category: touched,
      helper_tax_category: !touched,
    };
  }
  return {
    ...line,
    touched_tax_regime: touched,
    helper_tax_regime: !touched,
  };
}

function prefillPatchApplied(
  line: LineDraft,
  patch: LastPurchaseFieldPatch,
): boolean {
  if (
    patch.unitPrice !== undefined &&
    parseNumericInput(line.unit_cost) !== patch.unitPrice
  ) {
    return false;
  }
  if (patch.priceMode !== undefined && line.price_mode !== patch.priceMode) {
    return false;
  }
  if (
    patch.taxCategory !== undefined &&
    line.tax_category !== patch.taxCategory
  ) {
    return false;
  }
  if (patch.taxRegime !== undefined && line.tax_regime !== patch.taxRegime) {
    return false;
  }
  return true;
}

const blankPrefillFlags = {
  loaded_from_database: false,
  loaded_ingredient_id: "",
  ingredient_changed: false,
  touched_unit_cost: false,
  touched_price_mode: false,
  touched_tax_category: false,
  touched_tax_regime: false,
  helper_unit_cost: false,
  helper_price_mode: false,
  helper_tax_category: false,
  helper_tax_regime: false,
  prefill_key: "",
};

/** Tax identity of a new line, and of a line whose ingredient was switched. */
const NEW_LINE_TAX_SEED = {
  price_mode: "inclusive" as const,
  tax_category: "food",
  tax_regime: "reduced_vat",
};

interface LastPurchaseLookupCache {
  /** Supplier id the rows were fetched for. Null when the fetch had no supplier. */
  supplierId: string | null;
  lines: LastPurchaseLineLookup[];
}

const emptyLastPurchaseLookup: LastPurchaseLookupCache = {
  supplierId: null,
  lines: [],
};

export type FormDraft = Omit<PurchaseFormValues, "lines"> & {
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
    tax_category?: string;
  }>;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUnitCost(value: number): number {
  return Math.round(value * 10000) / 10000;
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
    supplier_country: values.supplier_country ?? "",
    tax_country: values.tax_country ?? "",
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
        : formatNumericInput(line.discount),
      line_total: options?.emptyNumericDefaults
        ? ""
        : formatNumericInput(roundMoney(line.quantity * line.unit_cost)),
      last_edited_field: null,
      tax_category: line.tax_category ?? "",
      tax_regime: line.tax_regime ?? "",
      price_mode:
        line.price_mode === "inclusive" || line.price_mode === "exclusive"
          ? line.price_mode
          : "",
      loaded_from_database: !options?.emptyNumericDefaults,
      loaded_ingredient_id: line.ingredient_id,
      ingredient_changed: false,
      touched_unit_cost: false,
      touched_price_mode: false,
      touched_tax_category: false,
      touched_tax_regime: false,
      helper_unit_cost: false,
      helper_price_mode: false,
      helper_tax_category: false,
      helper_tax_regime: false,
      prefill_key: "",
    })),
  };
}

export function draftToValues(draft: FormDraft): PurchaseFormValues {
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
      discount: parseNumericInput(line.discount),
      tax_category: line.tax_category,
      tax_regime: line.tax_regime,
      price_mode:
        line.price_mode === "inclusive" ? "inclusive" : "exclusive",
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
      tax_category?: string;
    } = {};

    if (!line.ingredient_id) {
      lineError.ingredient_id = "Ingredient is required";
    }

    if (!line.tax_category) {
      lineError.tax_category = "Tax category is required";
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
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 sm:text-sm";

const panelClassName =
  "relative h-full max-h-none w-full max-w-6xl overflow-y-auto rounded-none border-0 bg-white p-4 pb-0 shadow-xl sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border sm:border-zinc-200 sm:p-6";

const lineCellClassName = "p-0 align-top md:table-cell md:px-3 md:py-3";

function mobileFieldLabel(text: string) {
  return (
    <span className="mb-1 block text-xs font-medium text-zinc-600 md:hidden">
      {text}
    </span>
  );
}

function taxCellClassName(expanded: boolean, extra?: string): string {
  return [lineCellClassName, expanded ? null : "hidden", extra]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

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
  postingError = null,
  onClose,
  onSaveDraft,
  onReceiveGoods,
  driveConfigured = false,
  driveUnavailable = false,
  onRetryDrive,
}: PurchaseDocumentFormProps) {
  const [formValues, setFormValues] = useState<FormDraft>(() =>
    valuesToDraft(initialValues, {
      emptyNumericDefaults: purchase === null,
    }),
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [expandedTaxLines, setExpandedTaxLines] = useState<Set<number>>(
    () => new Set(),
  );
  const [headerDetailsOpen, setHeaderDetailsOpen] = useState(false);

  const isReadOnly = purchase?.status === "received" || purchase?.status === "cancelled";
  const draftFieldErrors = validateDraft(formValues);
  const receiveFieldErrors = validateDraft(formValues, { requireSupplier: true });
  const fieldErrors = draftFieldErrors;
  const isDraftValid = Object.keys(draftFieldErrors).length === 0;
  const isReceiveValid = Object.keys(receiveFieldErrors).length === 0;

  const [taxPreviewState, setTaxPreview] = useState<{
    error: string | null;
    data: PurchaseTaxResult | null;
  } | null>(null);
  const [isTaxPreviewLoadingState, setIsTaxPreviewLoading] = useState(false);
  const [lineTotalDeriveByIndex, setLineTotalDeriveByIndex] = useState<
    Record<number, { loading: boolean; error: string | null }>
  >({});
  const appliedLineTotalProbeKeysRef = useRef<Record<number, string>>({});
  const [lastPurchaseLookup, setLastPurchaseLookup] =
    useState<LastPurchaseLookupCache>(emptyLastPurchaseLookup);
  const [fillNote, setFillNote] = useState<string | null>(null);

  // The RPC preview only applies once the draft has enough content to price
  // (matches validateDraft's own requirements) — that check is pure
  // derivation from formValues, so it happens at render time, not in the
  // effect. The effect below owns only the genuine external subscription:
  // debouncing edits and awaiting the tax preview RPC.
  const hasCompletePreviewLine = formValues.lines.some((line) => {
    const quantity = coerceNumericField(line.quantity);
    const unitCost = coerceNumericField(line.unit_cost);
    return (
      quantity > 0 &&
      unitCost >= 0 &&
      line.tax_category.trim().length > 0
    );
  });

  const hasTaxPreviewInputs =
    hasCompletePreviewLine &&
    Boolean(formValues.purchased_at) &&
    !(
      isReadOnly &&
      formValues.lines.some(
        (line) => !line.tax_category.trim() || !line.price_mode,
      )
    );

  // Debounced: re-requests the tax preview RPC after edits settle, instead
  // of calculating in-browser synchronously on every keystroke.
  useEffect(() => {
    if (!hasTaxPreviewInputs) {
      return;
    }

    const values = draftToValues(formValues);
    let cancelled = false;
    // Marks the start of the debounce+RPC subscription below, not derived
    // state — there's no render-time value "pending fetch" can come from.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTaxPreviewLoading(true);

    const timerId = window.setTimeout(() => {
      const document = buildPurchaseTaxDocument({
        values,
        suppliers,
        documentId: purchase?.id,
      });

      if (document.lines.length === 0) {
        setTaxPreview(null);
        setIsTaxPreviewLoading(false);
        return;
      }

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
  }, [hasTaxPreviewInputs, formValues, purchase?.id, suppliers]);

  const taxPreview = hasTaxPreviewInputs ? taxPreviewState : null;
  const isTaxPreviewLoading = hasTaxPreviewInputs && isTaxPreviewLoadingState;

  // Isolated Line-total probe: pinned gross → unit_cost via RPC.
  // Exclusive writes probe net; inclusive writes pinnedGross/qty (never net).
  // Separate from the document-level tax preview that drives the footer.
  useEffect(() => {
    if (isReadOnly) {
      return;
    }

    let cancelled = false;
    const timerIds: number[] = [];

    formValues.lines.forEach((line, index) => {
      if (!shouldRunLineTotalProbe(line.last_edited_field)) {
        return;
      }

      const quantity = parseNumericInput(line.quantity);
      const lineTotal = parseNumericInput(line.line_total);
      if (quantity === null || quantity <= 0 || lineTotal === null) {
        return;
      }

      const probeKey = buildLineTotalProbeKey({
        quantity,
        lineTotal,
        taxCategory: line.tax_category,
        taxRegime: line.tax_regime,
        purchasedAt: formValues.purchased_at,
        taxCountry: formValues.tax_country,
        supplierCountry: formValues.supplier_country,
        supplierId: formValues.supplier_id,
        priceMode: line.price_mode,
      });

      if (appliedLineTotalProbeKeysRef.current[index] === probeKey) {
        return;
      }

      const timerId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        setLineTotalDeriveByIndex((current) => ({
          ...current,
          [index]: { loading: true, error: null },
        }));

        const supplier = suppliers.find(
          (row) => row.id === formValues.supplier_id,
        );

        void deriveExclusiveUnitCostFromLineTotal({
          purchasedAt: formValues.purchased_at,
          taxCountry: formValues.tax_country,
          supplierCountry: formValues.supplier_country,
          supplierId: formValues.supplier_id,
          supplierName: supplier?.name ?? null,
          documentId: purchase?.id,
          quantity,
          lineTotal,
          taxCategory: line.tax_category,
          taxRegime: line.tax_regime,
          discount: parseNumericInput(line.discount) ?? 0,
        }).then((result) => {
          if (cancelled) {
            return;
          }

          appliedLineTotalProbeKeysRef.current[index] = probeKey;

          if (result.error || !result.data) {
            setLineTotalDeriveByIndex((current) => ({
              ...current,
              [index]: {
                loading: false,
                error: result.error ?? LINE_TOTAL_UNIT_PRICE_ERROR,
              },
            }));
            return;
          }

          setLineTotalDeriveByIndex((current) => ({
            ...current,
            [index]: { loading: false, error: null },
          }));
          setFormValues((current) => ({
            ...current,
            lines: current.lines.map((currentLine, lineIndex) => {
              if (lineIndex !== index) {
                return currentLine;
              }
              if (currentLine.last_edited_field !== "line_total") {
                return currentLine;
              }
              if (parseNumericInput(currentLine.line_total) !== lineTotal) {
                return currentLine;
              }
              return markPrefillField(
                {
                  ...currentLine,
                  unit_cost: formatNumericInput(
                    unitCostAfterLineTotalProbe({
                      priceMode: currentLine.price_mode,
                      probeNetUnitCost: result.data.unitCost,
                      pinnedGross: lineTotal,
                      quantity:
                        parseNumericInput(currentLine.quantity) ?? quantity,
                    }),
                  ),
                },
                "unit_cost",
                "user",
              );
            }),
          }));
        });
      }, TAX_PREVIEW_DEBOUNCE_MS);

      timerIds.push(timerId);
    });

    return () => {
      cancelled = true;
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [formValues, isReadOnly, purchase?.id, suppliers]);

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
  const netAmount =
    accountingPreview?.net_amount ??
    taxPreview?.data?.subtotal ??
    subtotal;
  const grandTotal =
    accountingPreview?.grand_total ??
    taxPreview?.data?.grand_total ??
    roundMoney(subtotal + taxTotal);
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

  const updateLineQuantity = (index: number, value: string) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        const newQuantity = parseNumericInput(value);
        if (line.last_edited_field === "line_total") {
          const pinnedTotal = parseNumericInput(line.line_total);
          if (pinnedTotal !== null && newQuantity !== null && newQuantity > 0) {
            return {
              ...line,
              quantity: value,
              unit_cost: formatNumericInput(
                roundUnitCost(pinnedTotal / newQuantity),
              ),
            };
          }
          return { ...line, quantity: value };
        }
        const unitCost = parseNumericInput(line.unit_cost);
        if (newQuantity !== null && newQuantity > 0 && unitCost !== null) {
          return {
            ...line,
            quantity: value,
            line_total: formatNumericInput(roundMoney(newQuantity * unitCost)),
          };
        }
        return { ...line, quantity: value };
      }),
    }));
  };

  const updateLineUnitCost = useCallback((
    index: number,
    value: string,
    origin: "user" | "helper",
    options?: UnitCostWriteOptions,
  ) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        if (
          origin === "user" &&
          line.unit_cost === value &&
          !options?.commitSameValue
        ) {
          return line;
        }
        if (
          origin === "helper" &&
          line.touched_unit_cost === true &&
          !options?.fillDespiteTouch
        ) {
          return line;
        }
        delete appliedLineTotalProbeKeysRef.current[index];
        const quantity = parseNumericInput(line.quantity);
        const newUnitCost = parseNumericInput(value);
        const priced = markPrefillField(
          {
            ...line,
            unit_cost: value,
            last_edited_field: "unit_cost",
          },
          "unit_cost",
          origin,
        );
        if (value.trim() === "") {
          return {
            ...priced,
            unit_cost: "",
            line_total: "",
            last_edited_field: null,
          };
        }
        if (quantity !== null && quantity > 0 && newUnitCost !== null) {
          return {
            ...priced,
            line_total: formatNumericInput(
              roundMoney(quantity * newUnitCost),
            ),
          };
        }
        return priced;
      }),
    }));
    setLineTotalDeriveByIndex((current) => ({
      ...current,
      [index]: { loading: false, error: null },
    }));
  }, []);

  const updateLinePriceMode = (
    index: number,
    value: "inclusive" | "exclusive",
  ) => {
    setFormValues((current) => {
      const currentLine = current.lines[index];
      if (
        currentLine &&
        shouldInvalidateLineTotalProbeOnPriceModeChange(
          currentLine.last_edited_field,
        )
      ) {
        delete appliedLineTotalProbeKeysRef.current[index];
      }
      return {
        ...current,
        lines: current.lines.map((line, lineIndex) =>
          lineIndex === index
            ? markPrefillField({ ...line, price_mode: value }, "price_mode", "user")
            : line,
        ),
      };
    });
  };

  const updateLineTotal = (index: number, value: string) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        const quantity = parseNumericInput(line.quantity);
        const newTotal = parseNumericInput(value);
        const priced: LineDraft = {
          ...line,
          line_total: value,
          last_edited_field: "line_total",
        };
        if (
          line.price_mode === "inclusive" &&
          quantity !== null &&
          quantity > 0 &&
          newTotal !== null
        ) {
          priced.unit_cost = formatNumericInput(
            roundUnitCost(newTotal / quantity),
          );
        }
        return markPrefillField(priced, "unit_cost", "user");
      }),
    }));
    setLineTotalDeriveByIndex((current) => ({
      ...current,
      [index]: { loading: false, error: null },
    }));
    delete appliedLineTotalProbeKeysRef.current[index];
  };

  const updateLineTaxCategory = (index: number, category: string) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index
          ? markPrefillField(
              markPrefillField(
                {
                  ...line,
                  tax_category: category,
                  tax_regime:
                    DEFAULT_TAX_REGIME_BY_CATEGORY[
                      category as PurchaseTaxCategoryCode
                    ] ?? (category ? line.tax_regime : ""),
                },
                "tax_category",
                "user",
              ),
              "tax_regime",
              "user",
            )
          : line,
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
          line_total: "",
          last_edited_field: null,
          discount: "",
          ...NEW_LINE_TAX_SEED,
          ...blankPrefillFlags,
        },
      ],
    }));
  };

  const removeLine = (index: number) => {
    setExpandedTaxLines((current) => {
      const next = new Set<number>();
      for (const lineIndex of current) {
        if (lineIndex === index) {
          continue;
        }
        next.add(lineIndex > index ? lineIndex - 1 : lineIndex);
      }
      return next;
    });
    setFormValues((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  };

  const toggleTaxLine = (index: number) => {
    setExpandedTaxLines((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const lookupByIngredient = useMemo(() => {
    return new Map(
      lastPurchaseLookup.lines.map((row) => [row.ingredientId, row]),
    );
  }, [lastPurchaseLookup.lines]);

  const documentSupplierId = formValues.supplier_id.trim() || null;

  const sourceForLine = (line: LineDraft) =>
    resolveLastPurchaseSource(
      lookupByIngredient.get(line.ingredient_id) ?? null,
      documentSupplierId,
      lastPurchaseLookup.supplierId,
    );

  const applyLastPricePatch = useCallback((
    index: number,
    patch: LastPurchaseFieldPatch,
    origin: "user" | "helper",
    options?: UnitCostWriteOptions,
  ) => {
    if (patch.unitPrice !== undefined) {
      updateLineUnitCost(
        index,
        formatNumericInput(patch.unitPrice),
        origin,
        origin === "user" ? { ...options, commitSameValue: true } : options,
      );
    }
    if (
      patch.priceMode === undefined &&
      patch.taxCategory === undefined &&
      patch.taxRegime === undefined
    ) {
      return;
    }
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        let next = line;
        if (
          patch.priceMode &&
          !(origin === "helper" && line.touched_price_mode === true)
        ) {
          next = markPrefillField(
            { ...next, price_mode: patch.priceMode },
            "price_mode",
            origin,
          );
        }
        if (
          patch.taxCategory &&
          !(origin === "helper" && line.touched_tax_category === true)
        ) {
          next = markPrefillField(
            { ...next, tax_category: patch.taxCategory },
            "tax_category",
            origin,
          );
        }
        if (
          patch.taxRegime &&
          !(origin === "helper" && line.touched_tax_regime === true)
        ) {
          next = markPrefillField(
            { ...next, tax_regime: patch.taxRegime },
            "tax_regime",
            origin,
          );
        }
        return next;
      }),
    }));
  }, [updateLineUnitCost]);

  const ingredientIdsKey = formValues.lines
    .map((line) => line.ingredient_id)
    .filter((id) => id.length > 0)
    .sort()
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .join(",");

  useEffect(() => {
    if (isReadOnly) {
      return;
    }
    const ids =
      ingredientIdsKey.length > 0 ? ingredientIdsKey.split(",") : [];
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    const requestedSupplierId = formValues.supplier_id.trim() || null;
    void purchaseService
      .getLastPurchaseLines(ids, requestedSupplierId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.error || !result.data) {
          setLastPurchaseLookup(emptyLastPurchaseLookup);
          return;
        }
        setLastPurchaseLookup({
          supplierId: requestedSupplierId,
          lines: result.data,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [ingredientIdsKey, formValues.supplier_id, isReadOnly]);

  useEffect(() => {
    if (isReadOnly) {
      return;
    }
    formValues.lines.forEach((line, index) => {
      const source = resolveLastPurchaseSource(
        lookupByIngredient.get(line.ingredient_id) ?? null,
        documentSupplierId,
        lastPurchaseLookup.supplierId,
      );
      const key = automaticPrefillEventKey(line.ingredient_id, source);
      if (!key || line.prefill_key === key) {
        return;
      }
      const patch = planAutomaticPrefill(source, {
        readOnly: false,
        loadedFromDatabase: line.loaded_from_database === true,
        ingredientChanged: line.ingredient_changed === true,
        touched: lineTouchState(line),
        helperOwned: lineHelperState(line),
      });
      if (patch && !prefillPatchApplied(line, patch)) {
        applyLastPricePatch(index, patch, "helper");
      }
      setFormValues((current) => ({
        ...current,
        lines: current.lines.map((row, lineIndex) =>
          lineIndex === index ? { ...row, prefill_key: key } : row,
        ),
      }));
    });
  }, [
    applyLastPricePatch,
    documentSupplierId,
    formValues,
    isReadOnly,
    lastPurchaseLookup.supplierId,
    lookupByIngredient,
  ]);

  const fillCandidateCount = formValues.lines.filter(
    (line) =>
      isEmptyOrZeroUnitPrice(line.unit_cost) && sourceForLine(line) !== null,
  ).length;

  const fillLastPrices = () => {
    const plan = planFillLastPrices(
      formValues.lines.map((line) => ({
        unitPrice: line.unit_cost,
        source: sourceForLine(line),
        touched: lineTouchState(line),
      })),
      isReadOnly,
    );
    plan.patches.forEach((patch, index) => {
      if (!patch) {
        return;
      }
      applyLastPricePatch(index, patch, "helper", { fillDespiteTouch: true });
    });
    setFillNote(fillLastPricesNote(plan.filled, plan.candidates));
  };

  const acceptLastPrice = (index: number) => {
    const line = formValues.lines[index];
    if (!line) {
      return;
    }
    const patch = planUseLastPurchase(sourceForLine(line));
    if (!patch) {
      return;
    }
    applyLastPricePatch(index, patch, "user");
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
      <div className={panelClassName}>
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
    <div className={panelClassName}>
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

          <div className={headerDetailsOpen ? "contents" : "hidden md:contents"}>
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
              className={`${inputClassName} min-w-0 max-w-full appearance-none`}
              aria-invalid={Boolean(
                hasAttemptedSubmit && fieldErrors.purchased_at,
              )}
            />
            {hasAttemptedSubmit && fieldErrors.purchased_at && (
              <p className="text-sm text-red-600">{fieldErrors.purchased_at}</p>
            )}
          </div>

          <div className={headerDetailsOpen ? "contents" : "hidden md:contents"}>
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
              {isReadOnly && !formValues.supplier_country.trim() ? (
                <p className="text-sm text-zinc-500">Not recorded</p>
              ) : (
                <input
                  id="supplier_country"
                  type="text"
                  value={formValues.supplier_country}
                  onChange={(event) =>
                    updateHeader(
                      "supplier_country",
                      event.target.value.toUpperCase(),
                    )
                  }
                  disabled={isReadOnly || isSaving}
                  className={inputClassName}
                  placeholder="NL"
                  maxLength={2}
                />
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="tax_country"
                className="block text-sm font-medium text-zinc-700"
              >
                Tax country
              </label>
              {isReadOnly && !formValues.tax_country.trim() ? (
                <p className="text-sm text-zinc-500">Not recorded</p>
              ) : (
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
              )}
            </div>
          </div>

          <button
            type="button"
            aria-expanded={headerDetailsOpen}
            onClick={() => setHeaderDetailsOpen((open) => !open)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-700 sm:col-span-2 md:hidden"
          >
            {headerDetailsOpen ? "Fewer details" : "More details"}
          </button>
        </div>

        <div
          className={
            headerDetailsOpen ? "space-y-2" : "hidden space-y-2 md:block"
          }
        >
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
              <div className="flex flex-wrap items-center justify-end gap-2">
                {fillCandidateCount > 0 ? (
                  <button
                    type="button"
                    onClick={fillLastPrices}
                    disabled={isSaving}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Fill last prices
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={addLine}
                  disabled={isSaving}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  + Add line
                </button>
              </div>
            )}
          </div>

          {hasAttemptedSubmit && fieldErrors.lines && (
            <p className="text-sm text-red-600">{fieldErrors.lines}</p>
          )}
          {fillNote ? (
            <p className="text-sm text-zinc-600">{fillNote}</p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="block min-w-full md:table">
                <thead className="hidden bg-zinc-50 md:table-header-group">
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
                    <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                      Discount
                    </th>
                    <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                      Price includes tax
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
                <tbody className="block md:table-row-group">
                  {formValues.lines.map((line, index) => {
                    const quantity = coerceNumericField(line.quantity);
                    const lineError = fieldErrors.lineErrors?.[index];
                    const taxLine = taxPreview?.data?.lines.find(
                      (row) => row.line_id === `line-${index + 1}`,
                    );
                    const storedItem = purchase?.items[index];
                    const selectedIngredient = ingredients.find(
                      (ingredient) => ingredient.id === line.ingredient_id,
                    );
                    // "Line total" — сколько реально стоит эта строка
                    // (net + tax = gross), а не net-only. Известно только
                    // после ответа RPC для этой строки: до этого — "—",
                    // а не приблизительная net-цифра, которая раньше и
                    // путала (не совпадала с qty × unit price при "Price
                    // includes tax").
                    const lineTotal = taxLine ? taxLine.gross_amount : null;
                    const netUnitCost =
                      taxLine && quantity > 0
                        ? taxLine.net_amount / quantity
                        : storedItem?.unit_cost;
                    const showNetUnitCost =
                      line.price_mode === "inclusive" &&
                      netUnitCost !== undefined &&
                      netUnitCost !== null;
                    const taxUnrecorded = isReadOnly && !line.price_mode;
                    const taxExpanded =
                      expandedTaxLines.has(index) ||
                      Boolean(hasAttemptedSubmit && lineError?.tax_category);
                    const discountValue = line.discount.trim();
                    const taxSummary =
                      taxLine &&
                      taxLine.tax_rate_percent !== null &&
                      taxLine.tax_rate_percent !== undefined
                        ? `${taxLine.tax_rate_percent}% · tax ${formatMoney(taxLine.tax_amount)}${
                            discountValue ? ` · discount ${discountValue}` : ""
                          }`
                        : null;

                    return (
                      <tr
                        key={index}
                        className="grid grid-cols-2 gap-3 border-t border-zinc-200 p-3 md:table-row md:p-0"
                      >
                        <td className={`${lineCellClassName} order-1 col-span-2`}>
                          {mobileFieldLabel("Ingredient")}
                          <select
                            value={line.ingredient_id}
                            onChange={(event) => {
                              const nextId = event.target.value;
                              const currentLine = formValues.lines[index];
                              if (!currentLine || nextId === currentLine.ingredient_id) {
                                return;
                              }
                              const switchingIngredient =
                                currentLine.ingredient_id.trim().length > 0 &&
                                nextId.trim().length > 0;
                              const resetHelperUnitCost =
                                currentLine.helper_unit_cost === true;
                              if (switchingIngredient || resetHelperUnitCost) {
                                updateLineUnitCost(
                                  index,
                                  "",
                                  "helper",
                                  switchingIngredient
                                    ? { fillDespiteTouch: true }
                                    : undefined,
                                );
                              }
                              setFormValues((current) => ({
                                ...current,
                                lines: current.lines.map((row, lineIndex) => {
                                  if (lineIndex !== index) {
                                    return row;
                                  }
                                  const next: LineDraft = {
                                    ...row,
                                    ingredient_id: nextId,
                                    ingredient_changed:
                                      row.ingredient_changed ||
                                      (row.loaded_from_database === true &&
                                        nextId !== row.loaded_ingredient_id),
                                  };
                                  if (switchingIngredient) {
                                    return withoutPrefillFlags({
                                      ...next,
                                      ...NEW_LINE_TAX_SEED,
                                    });
                                  }
                                  if (resetHelperUnitCost) {
                                    next.helper_unit_cost = false;
                                  }
                                  if (row.helper_price_mode === true) {
                                    next.price_mode = NEW_LINE_TAX_SEED.price_mode;
                                    next.helper_price_mode = false;
                                  }
                                  if (row.helper_tax_category === true) {
                                    next.tax_category = NEW_LINE_TAX_SEED.tax_category;
                                    next.helper_tax_category = false;
                                  }
                                  if (row.helper_tax_regime === true) {
                                    next.tax_regime = NEW_LINE_TAX_SEED.tax_regime;
                                    next.helper_tax_regime = false;
                                  }
                                  return next;
                                }),
                              }));
                            }}
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
                        <td className={`${lineCellClassName} order-2`}>
                          {mobileFieldLabel("Quantity")}
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <NumericInput
                                value={line.quantity}
                                onChange={(value) =>
                                  updateLineQuantity(index, value)
                                }
                                disabled={isReadOnly || isSaving}
                                className="text-right"
                                placeholder="0"
                                aria-invalid={Boolean(
                                  hasAttemptedSubmit && lineError?.quantity,
                                )}
                              />
                            </div>
                            {selectedIngredient && (
                              <span className="shrink-0 text-sm text-zinc-500">
                                {selectedIngredient.unit}
                              </span>
                            )}
                          </div>
                          {hasAttemptedSubmit && lineError?.quantity && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.quantity}
                            </p>
                          )}
                        </td>
                        <td className={`${lineCellClassName} order-4 col-span-2`}>
                          {mobileFieldLabel("Unit price")}
                          <NumericInput
                            value={line.unit_cost}
                            onChange={(value) =>
                              updateLineUnitCost(index, value, "user")
                            }
                            disabled={
                              isReadOnly ||
                              isSaving ||
                              Boolean(lineTotalDeriveByIndex[index]?.loading)
                            }
                            className="text-right"
                            placeholder="0.00"
                            aria-label="Unit price"
                            aria-invalid={Boolean(
                              hasAttemptedSubmit && lineError?.unit_cost,
                            )}
                          />
                          {lineTotalDeriveByIndex[index]?.loading && (
                            <p className="mt-1 text-xs text-zinc-500">
                              Calculating…
                            </p>
                          )}
                          {lineTotalDeriveByIndex[index]?.error && (
                            <p className="mt-1 text-xs text-amber-700">
                              {lineTotalDeriveByIndex[index]?.error}
                            </p>
                          )}
                          {hasAttemptedSubmit && lineError?.unit_cost && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.unit_cost}
                            </p>
                          )}
                          {!isReadOnly && sourceForLine(line) ? (
                            <button
                              type="button"
                              onClick={() => acceptLastPrice(index)}
                              disabled={isSaving}
                              className="mt-1 block text-left text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {formatLastPurchaseHint(
                                sourceForLine(line)!,
                                selectedIngredient?.unit ?? "",
                              )}{" "}
                              Use
                            </button>
                          ) : null}
                          {showNetUnitCost && (
                            <p className="mt-1 text-xs text-zinc-500">
                              Net {formatUnitCost(netUnitCost)}
                            </p>
                          )}
                        </td>
                        <td className="order-5 col-span-2 p-0 md:hidden">
                          <div className="flex items-center justify-between gap-3">
                            <button
                              type="button"
                              aria-expanded={taxExpanded}
                              onClick={() => toggleTaxLine(index)}
                              className="text-sm font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-2"
                            >
                              Tax and discount
                            </button>
                            {taxSummary ? (
                              <span className="text-right text-xs text-zinc-600">
                                {taxSummary}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className={taxCellClassName(taxExpanded, "order-6 col-span-2")}>
                          {mobileFieldLabel("Discount")}
                          {isReadOnly && !line.discount.trim() ? (
                            <p className="text-sm text-zinc-500">Not recorded</p>
                          ) : (
                            <NumericInput
                              value={line.discount}
                              onChange={(value) =>
                                updateLine(index, "discount", value)
                              }
                              disabled={isReadOnly || isSaving}
                              className="text-right"
                              placeholder="0.00"
                              aria-label="Discount"
                            />
                          )}
                        </td>
                        <td className={taxCellClassName(taxExpanded, "order-7 col-span-2")}>
                          {mobileFieldLabel("Price includes tax")}
                          {taxUnrecorded ? (
                            <p className="text-sm text-zinc-500">Not recorded</p>
                          ) : (
                            <label className="flex items-center gap-2 text-sm text-zinc-700">
                              <input
                                type="checkbox"
                                checked={line.price_mode === "inclusive"}
                                onChange={(event) =>
                                  updateLinePriceMode(
                                    index,
                                    event.target.checked
                                      ? "inclusive"
                                      : "exclusive",
                                  )
                                }
                                disabled={isReadOnly || isSaving}
                                className="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500"
                              />
                              Includes tax
                            </label>
                          )}
                        </td>
                        <td className={taxCellClassName(taxExpanded, "order-8 col-span-2")}>
                          {mobileFieldLabel("Tax category")}
                          {isReadOnly && !line.tax_category ? (
                            <p className="text-sm text-zinc-500">Not recorded</p>
                          ) : (
                            <select
                              value={line.tax_category}
                              onChange={(event) =>
                                updateLineTaxCategory(index, event.target.value)
                              }
                              disabled={isReadOnly || isSaving}
                              className={inputClassName}
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && lineError?.tax_category,
                              )}
                            >
                              <option value="">Select category</option>
                              {PURCHASE_TAX_CATEGORY_OPTIONS.map((category) => (
                                <option key={category} value={category}>
                                  {formatPurchaseTaxCategoryLabel(category)}
                                </option>
                              ))}
                            </select>
                          )}
                          {hasAttemptedSubmit && lineError?.tax_category && (
                            <p className="mt-1 text-sm text-red-600">
                              {lineError.tax_category}
                            </p>
                          )}
                        </td>
                        <td className={taxCellClassName(taxExpanded, "order-9 col-span-2")}>
                          {mobileFieldLabel("Tax regime")}
                          {isReadOnly && !line.tax_regime ? (
                            <p className="text-sm text-zinc-500">Not recorded</p>
                          ) : (
                            <select
                              value={line.tax_regime}
                              onChange={(event) => {
                                const regime = event.target.value;
                                setFormValues((current) => ({
                                  ...current,
                                  lines: current.lines.map((row, lineIndex) =>
                                    lineIndex === index
                                      ? markPrefillField(
                                          { ...row, tax_regime: regime },
                                          "tax_regime",
                                          "user",
                                        )
                                      : row,
                                  ),
                                }));
                              }}
                              disabled={isReadOnly || isSaving}
                              className={inputClassName}
                            >
                              <option value="">Select regime</option>
                              {PURCHASE_TAX_REGIME_OPTIONS.map((regime) => (
                                <option key={regime} value={regime}>
                                  {formatPurchaseTaxRegimeLabel(regime)}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td
                          className={taxCellClassName(
                            taxExpanded,
                            "order-10 col-span-2 text-sm text-zinc-700",
                          )}
                        >
                          {mobileFieldLabel("Tax code")}
                          {taxLine?.tax_code ?? "—"}
                        </td>
                        <td
                          className={taxCellClassName(
                            taxExpanded,
                            "order-11 col-span-2 text-sm text-zinc-700 md:text-right",
                          )}
                        >
                          {mobileFieldLabel("Tax %")}
                          {taxLine?.tax_rate_percent !== null &&
                          taxLine?.tax_rate_percent !== undefined
                            ? `${taxLine.tax_rate_percent}%`
                            : "—"}
                        </td>
                        <td
                          className={taxCellClassName(
                            taxExpanded,
                            "order-12 col-span-2 text-sm text-zinc-700 md:text-right",
                          )}
                        >
                          {mobileFieldLabel("Tax amount")}
                          {taxLine ? formatMoney(taxLine.tax_amount) : "—"}
                        </td>
                        <td
                          className={`${lineCellClassName} order-3 text-sm font-medium text-zinc-900 md:text-right`}
                        >
                          {mobileFieldLabel("Line total")}
                          {isReadOnly ? (
                            lineTotal === null ? (
                              "—"
                            ) : (
                              formatMoney(lineTotal)
                            )
                          ) : (
                            <NumericInput
                              value={editableLineTotalValue({
                                lastEditedField: line.last_edited_field,
                                pinnedLineTotal: line.line_total,
                                previewGrossAmount: taxLine?.gross_amount,
                              })}
                              onChange={(value) =>
                                updateLineTotal(index, value)
                              }
                              disabled={isSaving}
                              className="text-right"
                              placeholder="0.00"
                              aria-label="Line total"
                            />
                          )}
                        </td>
                        {!isReadOnly && (
                          <td
                            className={`${lineCellClassName} order-last col-span-2 md:text-right`}
                          >
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              disabled={isSaving || formValues.lines.length === 1}
                              className="w-full rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto"
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
              {!isReadOnly ? (
                <button
                  type="button"
                  onClick={addLine}
                  disabled={isSaving}
                  aria-label="Add another line"
                  className="w-full border-t border-zinc-200 px-3 py-3 text-sm font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 md:hidden"
                >
                  + Add line
                </button>
              ) : null}
            </div>
          </div>
          {isTaxPreviewLoading && (
            <p className="text-sm text-zinc-500">Calculating taxes…</p>
          )}
          {!isTaxPreviewLoading && taxPreview?.error && (
            <p className="text-sm text-red-600">{taxPreview.error}</p>
          )}
        </div>

        <PurchaseAccountingPreview preview={previewForDisplay} />
        {postingError ? (
          <p className="text-sm text-amber-700">{postingError}</p>
        ) : null}

        <div className="flex items-center justify-end border-t border-zinc-200 pt-4">
          <div className="space-y-1 text-right">
            <p className="text-sm text-zinc-500">
              Subtotal{" "}
              <span className="font-medium text-zinc-800">
                {formatMoney(netAmount)}
              </span>
            </p>
            <p className="text-sm text-zinc-500">
              Tax total{" "}
              <span className="font-medium text-zinc-800">
                {formatMoney(taxTotal)}
              </span>
            </p>
            <p className="text-sm text-zinc-500">Grand total</p>
            <p className="text-2xl font-semibold text-zinc-900">
              {formatMoney(grandTotal)}
            </p>
          </div>
        </div>

        <PurchaseReceiptsSection
          purchaseId={purchase?.id ?? null}
          status={purchase?.status ?? "draft"}
          supplierId={formValues.supplier_id.trim() ? formValues.supplier_id.trim() : null}
          purchasedAt={formValues.purchased_at}
          grandTotal={grandTotal}
          driveConfigured={driveConfigured}
          driveUnavailable={driveUnavailable}
          onRetryDrive={onRetryDrive}
        />

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-zinc-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <p className="mb-2 flex items-center justify-between text-sm font-medium text-zinc-900 sm:hidden">
            <span>Total</span>
            <span>{formatMoney(grandTotal)}</span>
          </p>
          <div className="flex flex-row gap-3 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-2.5 sm:px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
          >
            {isReadOnly ? "Close" : "Cancel"}
          </button>

          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={() => void handleAction(onSaveDraft)}
                disabled={isSaving}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-2.5 sm:px-4 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {isSaving ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleAction(onReceiveGoods, { requireSupplier: true })
                }
                disabled={isSaving}
                className="flex-1 rounded-lg bg-amber-500 px-2 py-2.5 sm:px-4 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
              >
                {isSaving ? "Receiving..." : "Receive Goods"}
              </button>
            </>
          )}
          </div>
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
  postingError = null,
  onClose,
  onSaveDraft,
  onReceiveGoods,
  driveConfigured = false,
  driveUnavailable = false,
  onRetryDrive,
}: PurchaseDocumentModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:items-center sm:p-4">
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
        postingError={postingError}
        onClose={onClose}
        onSaveDraft={onSaveDraft}
        onReceiveGoods={onReceiveGoods}
        driveConfigured={driveConfigured}
        driveUnavailable={driveUnavailable}
        onRetryDrive={onRetryDrive}
      />
    </div>
  );
}
