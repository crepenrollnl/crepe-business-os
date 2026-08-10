"use client";

import type { ProductionSessionLineView } from "../types/production-session";
import {
  formatDifference,
  formatSessionQuantity,
  getDifferenceClass,
} from "../utils/format-production-session";
import { computeLineDifference } from "../utils/production-session";

type LineDraft = {
  raw: string;
  value: number | null;
  error: string | null;
};

type ProductionSessionLinesSectionProps = {
  lines: ProductionSessionLineView[];
  drafts: Record<string, LineDraft>;
  canEdit: boolean;
  onProducedChange: (lineId: string, raw: string) => void;
};

export function ProductionSessionLinesSection({
  lines,
  drafts,
  canEdit,
  onProducedChange,
}: ProductionSessionLinesSectionProps) {
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
                const actualValue = draft?.value ?? line.actual_produced_quantity;
                const difference = computeLineDifference(
                  line.planned_quantity,
                  actualValue,
                );
                const fieldError = draft?.error ?? null;

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
