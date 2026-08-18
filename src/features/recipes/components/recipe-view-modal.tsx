/**
 * Read-only recipe view (quick look from the recipes list).
 *
 * Deliberately not recipe-editor-modal.tsx in a disabled state — no form,
 * no validation, no Save. Same visual language as Sale Review
 * (sale-review-section.tsx): a fact grid (dl/dt/dd) followed by a table,
 * built from data the list's own "Edit" fetch already resolves in full
 * (recipeService.getRecipe -> RecipeWithRelations) — nothing new queried.
 */

import { formatMoney } from "@/lib/money";
import type { RecipeWithRelations } from "../types/recipe";

type RecipeViewModalProps = {
  isOpen: boolean;
  recipe: RecipeWithRelations | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onEdit: () => void;
};

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function RawBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
      Raw
    </span>
  );
}

export function RecipeViewModal({
  isOpen,
  recipe,
  isLoading,
  error,
  onClose,
  onEdit,
}: RecipeViewModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={onClose}
      />

      <div
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl"
        data-testid="recipe-view-modal"
      >
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
            <div className="h-4 w-72 animate-pulse rounded bg-zinc-200" />
            <div className="mt-6 h-32 animate-pulse rounded bg-zinc-200" />
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : recipe ? (
          <>
            <div className="mb-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl font-semibold text-zinc-900">
                  {recipe.name}
                </h2>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-semibold ${
                    recipe.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {recipe.is_active ? "Active" : "Inactive"}
                </span>
              </div>
              {recipe.description && (
                <p className="mt-1 text-sm text-zinc-500">
                  {recipe.description}
                </p>
              )}
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Yield
                </dt>
                <dd className="mt-0.5 text-zinc-800">
                  {formatQuantity(recipe.yield_quantity)} {recipe.yield_unit}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Recipe type
                </dt>
                <dd className="mt-0.5 text-zinc-800">
                  {recipe.recipe_role === "assembly"
                    ? "Assembly (sold dish)"
                    : "Component (produced ahead of time)"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Selling price
                </dt>
                <dd className="mt-0.5 text-zinc-800">
                  {recipe.selling_price === null
                    ? "—"
                    : formatMoney(recipe.selling_price)}
                </dd>
              </div>
            </dl>

            <div className="mt-6">
              {recipe.recipe_role === "component" ? (
                <>
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Ingredients
                  </h3>
                  <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead className="bg-zinc-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                              Ingredient
                            </th>
                            <th className="px-3 py-2 text-right text-sm font-semibold text-zinc-700">
                              Quantity
                            </th>
                            <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                              Unit
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.items.map((item) => (
                            <tr key={item.id} className="border-t border-zinc-200">
                              <td className="px-3 py-2 text-zinc-900">
                                {item.ingredient?.name ?? "Unknown ingredient"}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-800">
                                {formatQuantity(item.quantity)}
                              </td>
                              <td className="px-3 py-2 text-zinc-800">
                                {item.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {recipe.components.length > 0 && (
                    <>
                      <h3 className="mt-6 text-sm font-semibold text-zinc-900">
                        Sub-components
                      </h3>
                      <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
                        <div className="overflow-x-auto">
                          <table className="min-w-full">
                            <thead className="bg-zinc-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                                  Component
                                </th>
                                <th className="px-3 py-2 text-right text-sm font-semibold text-zinc-700">
                                  Quantity
                                </th>
                                <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                                  Unit
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {recipe.components.map((component) => (
                                <tr
                                  key={component.id}
                                  className="border-t border-zinc-200"
                                >
                                  <td className="px-3 py-2 text-zinc-900">
                                    {component.component?.name ??
                                      "Unknown component"}
                                  </td>
                                  <td className="px-3 py-2 text-right text-zinc-800">
                                    {formatQuantity(component.quantity)}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-800">
                                    {component.unit}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Components
                  </h3>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    Assembled from these at sale time.{" "}
                    <span className="font-semibold text-amber-700">Raw</span>{" "}
                    marks a raw ingredient add-in that skips production.
                  </p>
                  <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
                    <div className="overflow-x-auto">
                      <table className="min-w-full">
                        <thead className="bg-zinc-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                              Component / Ingredient
                            </th>
                            <th className="px-3 py-2 text-right text-sm font-semibold text-zinc-700">
                              Quantity
                            </th>
                            <th className="px-3 py-2 text-left text-sm font-semibold text-zinc-700">
                              Unit
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {recipe.components.map((component) => (
                            <tr
                              key={component.id}
                              className="border-t border-zinc-200"
                            >
                              <td className="px-3 py-2 text-zinc-900">
                                {component.ingredient_id ? (
                                  <>
                                    {component.ingredient?.name ??
                                      "Unknown ingredient"}
                                    <RawBadge />
                                  </>
                                ) : (
                                  (component.component?.name ??
                                  "Unknown component")
                                )}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-800">
                                {formatQuantity(component.quantity)}
                              </td>
                              <td className="px-3 py-2 text-zinc-800">
                                {component.unit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Close
          </button>
          {recipe && (
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
