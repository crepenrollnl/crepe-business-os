import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import {
  formatDifference,
  formatSessionQuantity,
  getDifferenceClass,
} from "../utils/format-production-session";
import { computeLineDifference } from "../utils/production-session";
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

export const ADJUST_INGREDIENT_SCALE_SUMMARY =
  "Adjust ingredient scale (optional)";

type ProductionSessionLineCardProps = {
  line: ProductionSessionLineView;
  draft: LineDraft | undefined;
  scaleDraft: LineDraft | undefined;
  helperDraft: HelperDraft | undefined;
  rawLines: readonly FirstLevelRawIngredient[];
  showHelper: boolean;
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

export function ProductionSessionLineCard({
  line,
  draft,
  scaleDraft,
  helperDraft,
  rawLines,
  showHelper,
  canEdit,
  onProducedChange,
  onRawMaterialScaleChange,
  onHelperQuantityChange,
  onHelperIngredientChange,
}: ProductionSessionLineCardProps) {
  const actualValue = draft?.value ?? line.actual_produced_quantity;
  const scaleValue = scaleDraft?.value ?? line.raw_material_scale;
  const difference = computeLineDifference(line.planned_quantity, actualValue);
  const hasOptionalError = Boolean(scaleDraft?.error || helperDraft?.error);

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-zinc-900">
          {line.product_name}
        </h3>
        <span className="shrink-0 text-sm font-medium text-zinc-500">
          {line.yield_unit}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Planned
          </dt>
          <dd className="mt-0.5 text-base text-zinc-800">
            {formatSessionQuantity(line.planned_quantity)} {line.yield_unit}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Difference
          </dt>
          <dd
            className={`mt-0.5 text-base font-medium ${getDifferenceClass(
              difference,
            )}`}
          >
            {formatDifference(difference)}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-sm font-semibold text-zinc-800">
          Actual produced quantity
        </p>
        <div className="mt-2">
          {canEdit ? (
            <ProducedQuantityField
              line={line}
              draft={draft}
              width="full"
              onProducedChange={onProducedChange}
            />
          ) : (
            <p className="text-lg font-medium text-zinc-900">
              <ReadOnlyQuantity value={actualValue} />
            </p>
          )}
        </div>
      </div>

      {canEdit ? (
        <details
          className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
          open={hasOptionalError ? true : undefined}
        >
          <summary className="cursor-pointer text-sm font-medium text-zinc-800">
            {ADJUST_INGREDIENT_SCALE_SUMMARY}
          </summary>
          <div className="mt-3 space-y-3">
            {showHelper ? (
              <div>
                <p className="text-sm font-medium text-zinc-700">
                  Actual ingredient used
                </p>
                <p className="mt-1 text-xs text-zinc-500">{HELPER_HELP}</p>
                <div className="mt-2">
                  <RawScaleHelperField
                    line={line}
                    helperDraft={helperDraft}
                    rawLines={rawLines}
                    width="full"
                    onHelperQuantityChange={onHelperQuantityChange}
                    onHelperIngredientChange={onHelperIngredientChange}
                  />
                </div>
              </div>
            ) : null}
            <div>
              <p className="text-sm font-medium text-zinc-700">
                Recipe Batches Used
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {RAW_MATERIAL_SCALE_HELP}
              </p>
              <div className="mt-2">
                <RecipeBatchesUsedField
                  line={line}
                  scaleDraft={scaleDraft}
                  width="full"
                  onRawMaterialScaleChange={onRawMaterialScaleChange}
                />
              </div>
            </div>
          </div>
        </details>
      ) : (
        <div className="mt-4 text-sm text-zinc-600">
          <span className="font-medium text-zinc-500">Recipe Batches Used</span>{" "}
          <ReadOnlyQuantity value={scaleValue} />
        </div>
      )}
    </article>
  );
}
