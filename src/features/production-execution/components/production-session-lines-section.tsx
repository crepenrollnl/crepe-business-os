"use client";

import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import {
  formatDifference,
  formatSessionQuantity,
  getDifferenceClass,
} from "../utils/format-production-session";
import { useIsDesktopLayout } from "../hooks/use-is-desktop-layout";
import { computeLineDifference } from "../utils/production-session";
import { ProductionSessionLineCard } from "./production-session-line-card";
import {
  HELPER_HELP,
  type HelperDraft,
  type LineDraft,
  ProducedQuantityField,
  RAW_MATERIAL_SCALE_HELP,
  RawScaleHelperField,
  ReadOnlyQuantity,
  RecipeBatchesUsedField,
} from "./production-session-line-fields";

export { HELPER_HELP, RAW_MATERIAL_SCALE_HELP };

export const SESSION_LINES_TABLE_TEST_ID = "session-lines-table";
export const SESSION_LINES_CARDS_TEST_ID = "session-lines-cards";

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

function rawLinesForRecipe(
  recipeId: string,
  firstLevelRawByRecipeId: ReadonlyMap<string, readonly FirstLevelRawIngredient[]>,
): readonly FirstLevelRawIngredient[] {
  return firstLevelRawByRecipeId.get(recipeId) ?? [];
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
  const isDesktopLayout = useIsDesktopLayout();
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
        <>
          {isDesktopLayout ? (
          <div
            className="overflow-x-auto"
            data-testid={SESSION_LINES_TABLE_TEST_ID}
          >
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
                    <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                      <span className="block">Actual ingredient used</span>
                      <span className="mt-1 block text-xs font-normal text-zinc-500">
                        {HELPER_HELP}
                      </span>
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                    <span className="block">Recipe Batches Used</span>
                    <span className="mt-1 block text-xs font-normal text-zinc-500">
                      {RAW_MATERIAL_SCALE_HELP}
                    </span>
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
                  const actualValue =
                    draft?.value ?? line.actual_produced_quantity;
                  const scaleValue =
                    scaleDraft?.value ?? line.raw_material_scale;
                  const difference = computeLineDifference(
                    line.planned_quantity,
                    actualValue,
                  );
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
                          <ProducedQuantityField
                            line={line}
                            draft={draft}
                            onProducedChange={onProducedChange}
                          />
                        ) : (
                          <ReadOnlyQuantity value={actualValue} />
                        )}
                      </td>
                      {showHelperColumn ? (
                        <td className="px-4 py-4 text-right">
                          <RawScaleHelperField
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
                          <RecipeBatchesUsedField
                            line={line}
                            scaleDraft={scaleDraft}
                            onRawMaterialScaleChange={onRawMaterialScaleChange}
                          />
                        ) : (
                          <ReadOnlyQuantity value={scaleValue} />
                        )}
                      </td>
                      <td
                        className={`px-4 py-4 text-right font-medium ${getDifferenceClass(
                          difference,
                        )}`}
                      >
                        {formatDifference(difference)}
                      </td>
                      <td className="px-4 py-4 text-zinc-600">
                        {line.yield_unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          ) : (
          <div
            className="space-y-3 bg-zinc-50 p-3"
            data-testid={SESSION_LINES_CARDS_TEST_ID}
          >
            {lines.map((line) => (
              <ProductionSessionLineCard
                key={line.id}
                line={line}
                draft={drafts[line.id]}
                scaleDraft={rawMaterialScaleDrafts[line.id]}
                helperDraft={helperDrafts[line.id]}
                rawLines={rawLinesForRecipe(
                  line.recipe_id,
                  firstLevelRawByRecipeId,
                )}
                showHelper={showHelperColumn}
                canEdit={canEdit}
                onProducedChange={onProducedChange}
                onRawMaterialScaleChange={onRawMaterialScaleChange}
                onHelperQuantityChange={onHelperQuantityChange}
                onHelperIngredientChange={onHelperIngredientChange}
              />
            ))}
          </div>
          )}
        </>
      )}
    </div>
  );
}
