import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import {
  formatFirstLevelRawOptionLabel,
  formatFirstLevelRawSingleLabel,
  formatSessionQuantity,
} from "../utils/format-production-session";

export type LineDraft = {
  raw: string;
  value: number | null;
  error: string | null;
};

export type HelperDraft = {
  raw: string;
  selectedIngredientId: string | null;
  error: string | null;
};

export const RAW_MATERIAL_SCALE_HELP =
  "Optional. Overrides automatic ingredient-scale calculation — useful when cooking loss/shrinkage makes the output smaller than what was actually cooked. Leave empty to calculate automatically from produced quantity.";

export const HELPER_HELP =
  "Optional. Enter how much of one recipe ingredient you actually used. Recipe Batches Used is filled as entered ÷ the recipe quantity. You can still edit Recipe Batches Used by hand.";

export function sessionNumberInputClass(
  hasError: boolean,
  options?: { disabled?: boolean; width?: "compact" | "full" },
): string {
  const widthClass = options?.width === "full" ? "w-full" : "w-28";

  return `h-11 ${widthClass} rounded-lg border px-3 text-right text-base text-zinc-900 shadow-sm outline-none transition focus:ring-2 focus:ring-amber-500/20 ${
    options?.disabled
      ? "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
      : ""
  } ${
    hasError
      ? "border-red-300 focus:border-red-500"
      : "border-zinc-300 focus:border-amber-500"
  }`;
}

export function ProducedQuantityField({
  line,
  draft,
  width = "compact",
  onProducedChange,
}: {
  line: ProductionSessionLineView;
  draft: LineDraft | undefined;
  width?: "compact" | "full";
  onProducedChange: (lineId: string, raw: string) => void;
}) {
  const fieldError = draft?.error ?? null;

  return (
    <div className={`flex flex-col gap-1 ${width === "full" ? "" : "items-end"}`}>
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        value={draft?.raw ?? ""}
        onChange={(event) => onProducedChange(line.id, event.target.value)}
        aria-label={`Actual produced quantity for ${line.product_name}`}
        aria-invalid={fieldError ? true : undefined}
        className={sessionNumberInputClass(Boolean(fieldError), { width })}
      />
      {fieldError ? (
        <span className="text-xs text-red-600">{fieldError}</span>
      ) : null}
    </div>
  );
}

export function RecipeBatchesUsedField({
  line,
  scaleDraft,
  width = "compact",
  onRawMaterialScaleChange,
}: {
  line: ProductionSessionLineView;
  scaleDraft: LineDraft | undefined;
  width?: "compact" | "full";
  onRawMaterialScaleChange: (lineId: string, raw: string) => void;
}) {
  const scaleError = scaleDraft?.error ?? null;

  return (
    <div className={`flex flex-col gap-1 ${width === "full" ? "" : "items-end"}`}>
      <input
        type="number"
        min={0.001}
        step="any"
        inputMode="decimal"
        value={scaleDraft?.raw ?? ""}
        onChange={(event) =>
          onRawMaterialScaleChange(line.id, event.target.value)
        }
        aria-label={`Recipe batches used for ${line.product_name}`}
        aria-invalid={scaleError ? true : undefined}
        className={sessionNumberInputClass(Boolean(scaleError), { width })}
      />
      {scaleError ? (
        <span className="text-xs text-red-600">{scaleError}</span>
      ) : null}
    </div>
  );
}

export function RawScaleHelperField({
  line,
  helperDraft,
  rawLines,
  width = "compact",
  onHelperQuantityChange,
  onHelperIngredientChange,
}: {
  line: ProductionSessionLineView;
  helperDraft: HelperDraft | undefined;
  rawLines: readonly FirstLevelRawIngredient[];
  width?: "compact" | "full";
  onHelperQuantityChange: (lineId: string, recipeId: string, raw: string) => void;
  onHelperIngredientChange: (
    lineId: string,
    recipeId: string,
    ingredientId: string,
  ) => void;
}) {
  if (rawLines.length === 0) {
    return null;
  }

  const selectedId =
    helperDraft?.selectedIngredientId ??
    (rawLines.length === 1 ? rawLines[0].ingredient_id : null);
  const selected =
    rawLines.find((item) => item.ingredient_id === selectedId) ?? null;
  const helperError = helperDraft?.error ?? null;
  const quantityEnabled = selected !== null;

  return (
    <div
      className={`flex flex-col gap-1 ${
        width === "full" ? "w-full items-stretch" : "min-w-44 items-end"
      }`}
    >
      {rawLines.length === 1 && selected ? (
        <p
          className={`w-full text-xs font-medium text-zinc-600 ${
            width === "full" ? "text-left" : "text-right"
          }`}
        >
          {formatFirstLevelRawSingleLabel(selected)}
        </p>
      ) : (
        <select
          value={selectedId ?? ""}
          onChange={(event) =>
            onHelperIngredientChange(line.id, line.recipe_id, event.target.value)
          }
          aria-label={`Reference ingredient for ${line.product_name}`}
          className="w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
        >
          <option value="">Select ingredient</option>
          {rawLines.map((item) => (
            <option key={item.ingredient_id} value={item.ingredient_id}>
              {formatFirstLevelRawOptionLabel(item)}
            </option>
          ))}
        </select>
      )}
      <input
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        disabled={!quantityEnabled}
        value={helperDraft?.raw ?? ""}
        onChange={(event) =>
          onHelperQuantityChange(line.id, line.recipe_id, event.target.value)
        }
        aria-label={
          selected
            ? `Actual ${selected.name} used for ${line.product_name}`
            : `Actual ingredient used for ${line.product_name}`
        }
        aria-invalid={helperError ? true : undefined}
        className={sessionNumberInputClass(Boolean(helperError), {
          disabled: true,
          width,
        })}
      />
      {helperError ? (
        <span className="text-xs text-red-600">{helperError}</span>
      ) : null}
    </div>
  );
}

export function ReadOnlyQuantity({
  value,
}: {
  value: number | null;
}) {
  return (
    <span className="text-zinc-700">
      {value === null ? "—" : formatSessionQuantity(value)}
    </span>
  );
}
