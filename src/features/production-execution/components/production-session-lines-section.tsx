"use client";

import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import {
  formatDifference,
  formatFirstLevelRawOptionLabel,
  formatFirstLevelRawSingleLabel,
  formatSessionQuantity,
  getDifferenceClass,
} from "../utils/format-production-session";
import { computeLineDifference } from "../utils/production-session";

type LineDraft = {
  raw: string;
  value: number | null;
  error: string | null;
};

type HelperDraft = {
  raw: string;
  selectedIngredientId: string | null;
  error: string | null;
};

type ProductionSessionLinesSectionProps = {
  lines: ProductionSessionLineView[];
  drafts: Record<string, LineDraft>;
  rawMaterialScaleDrafts: Record<string, LineDraft>;
  helperDrafts: Record<string, HelperDraft>;
  firstLevelRawByRecipeId: ReadonlyMap<string, readonly FirstLevelRawIngredient[]>;
  canEdit: boolean;
  onProducedChange: (lineId: string, raw: string) => void;
  onRawMaterialScaleChange: (lineId: string, raw: string) => void;
  onHelperQuantityChange: (lineId: string, recipeId: string, raw: string) => void;
  onHelperIngredientChange: (
    lineId: string,
    recipeId: string,
    ingredientId: string,
  ) => void;
};

const RAW_MATERIAL_SCALE_HELP =
  "Optional. Overrides automatic ingredient-scale calculation — useful when cooking loss/shrinkage makes the output smaller than what was actually cooked. Leave empty to calculate automatically from produced quantity.";

const HELPER_HELP =
  "Optional. Enter how much of one recipe ingredient you actually used. Recipe Batches Used is filled as entered ÷ the recipe quantity. You can still edit Recipe Batches Used by hand.";

function rawLinesForRecipe(
  recipeId: string,
  firstLevelRawByRecipeId: ReadonlyMap<string, readonly FirstLevelRawIngredient[]>,
): readonly FirstLevelRawIngredient[] {
  return firstLevelRawByRecipeId.get(recipeId) ?? [];
}

function RawScaleHelperCell({
  line,
  helperDraft,
  rawLines,
  onHelperQuantityChange,
  onHelperIngredientChange,
}: {
  line: ProductionSessionLineView;
  helperDraft: HelperDraft | undefined;
  rawLines: readonly FirstLevelRawIngredient[];
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
    <div className="flex min-w-44 flex-col items-end gap-1">
      {rawLines.length === 1 && selected ? (
        <p className="w-full text-right text-xs font-medium text-zinc-600">
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
        className={`w-28 rounded-lg border px-3 py-2 text-right text-sm text-zinc-900 shadow-sm outline-none transition focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400 ${
          helperError
            ? "border-red-300 focus:border-red-500"
            : "border-zinc-300 focus:border-amber-500"
        }`}
      />
      {helperError ? (
        <span className="text-xs text-red-600">{helperError}</span>
      ) : null}
    </div>
  );
}

export function ProductionSessionLinesSection({
  lines,
  drafts,
  rawMaterialScaleDrafts,
  helperDrafts,
  firstLevelRawByRecipeId,
  canEdit,
  onProducedChange,
  onRawMaterialScaleChange,
  onHelperQuantityChange,
  onHelperIngredientChange,
}: ProductionSessionLinesSectionProps) {
  const showHelperColumn =
    canEdit &&
    lines.some(
      (line) => rawLinesForRecipe(line.recipe_id, firstLevelRawByRecipeId).length > 0,
    );

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Planned Products
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {lines.length === 0
            ? "No products on this session."
            : "Enter actual produced quantity for each product. Difference is produced − planned."}
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">No products</p>
          <p className="mt-1 text-sm text-zinc-500">
            This session has no planned products.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Product
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Planned Quantity
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Actual Produced Quantity
                </th>
                {showHelperColumn ? (
                  <th
                    className="px-4 py-3 text-right text-sm font-semibold text-zinc-700"
                    title={HELPER_HELP}
                  >
                    Actual ingredient used
                  </th>
                ) : null}
                <th
                  className="px-4 py-3 text-right text-sm font-semibold text-zinc-700"
                  title={RAW_MATERIAL_SCALE_HELP}
                >
                  Recipe Batches Used
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Difference
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Unit
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const draft = drafts[line.id];
                const scaleDraft = rawMaterialScaleDrafts[line.id];
                const actualValue = draft?.value ?? line.actual_produced_quantity;
                const scaleValue =
                  scaleDraft?.value ?? line.raw_material_scale;
                const difference = computeLineDifference(
                  line.planned_quantity,
                  actualValue,
                );
                const fieldError = draft?.error ?? null;
                const scaleError = scaleDraft?.error ?? null;
                const rawLines = rawLinesForRecipe(
                  line.recipe_id,
                  firstLevelRawByRecipeId,
                );

                return (
                  <tr
                    key={line.id}
                    className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-4 font-medium text-zinc-900">
                      {line.product_name}
                    </td>
                    <td className="px-4 py-4 text-right text-zinc-700">
                      {formatSessionQuantity(line.planned_quantity)}
                    </td>
                    <td className="px-4 py-4 text-right">
                      {canEdit ? (
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            inputMode="decimal"
                            value={draft?.raw ?? ""}
                            onChange={(event) =>
                              onProducedChange(line.id, event.target.value)
                            }
                            aria-label={`Actual produced quantity for ${line.product_name}`}
                            aria-invalid={fieldError ? true : undefined}
                            className={`w-28 rounded-lg border px-3 py-2 text-right text-sm text-zinc-900 shadow-sm outline-none transition focus:ring-2 focus:ring-amber-500/20 ${
                              fieldError
                                ? "border-red-300 focus:border-red-500"
                                : "border-zinc-300 focus:border-amber-500"
                            }`}
                          />
                          {fieldError ? (
                            <span className="text-xs text-red-600">
                              {fieldError}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-700">
                          {actualValue === null
                            ? "—"
                            : formatSessionQuantity(actualValue)}
                        </span>
                      )}
                    </td>
                    {showHelperColumn ? (
                      <td className="px-4 py-4 text-right">
                        <RawScaleHelperCell
                          line={line}
                          helperDraft={helperDrafts[line.id]}
                          rawLines={rawLines}
                          onHelperQuantityChange={onHelperQuantityChange}
                          onHelperIngredientChange={onHelperIngredientChange}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-4 text-right">
                      {canEdit ? (
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="number"
                            min={0.001}
                            step="any"
                            inputMode="decimal"
                            value={scaleDraft?.raw ?? ""}
                            onChange={(event) =>
                              onRawMaterialScaleChange(
                                line.id,
                                event.target.value,
                              )
                            }
                            aria-label={`Recipe batches used for ${line.product_name}`}
                            aria-invalid={scaleError ? true : undefined}
                            className={`w-28 rounded-lg border px-3 py-2 text-right text-sm text-zinc-900 shadow-sm outline-none transition focus:ring-2 focus:ring-amber-500/20 ${
                              scaleError
                                ? "border-red-300 focus:border-red-500"
                                : "border-zinc-300 focus:border-amber-500"
                            }`}
                          />
                          {scaleError ? (
                            <span className="text-xs text-red-600">
                              {scaleError}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-700">
                          {scaleValue === null
                            ? "—"
                            : formatSessionQuantity(scaleValue)}
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-4 text-right font-medium ${getDifferenceClass(
                        difference,
                      )}`}
                    >
                      {formatDifference(difference)}
                    </td>
                    <td className="px-4 py-4 text-zinc-600">{line.yield_unit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
