"use client";

import { useState, type FormEvent } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import { calculateMoneyLineTotal } from "@/lib/money";
import type { SaleDetailLine } from "../types/sale";
import { formatSaleMoney } from "../utils/format-sale";

/**
 * A product the page knows about. selling_price null = no price set in
 * Recipes: still used to label existing lines, but never offered in the
 * Add line picker (audit D4 — the price always comes from Recipes).
 */
export type SaleProductOption = {
  id: string;
  name: string;
  selling_price: number | null;
};

type PricedSaleProductOption = SaleProductOption & { selling_price: number };

function isPriced(
  product: SaleProductOption,
): product is PricedSaleProductOption {
  return product.selling_price !== null;
}

type SaleLinesSectionProps = {
  lines: SaleDetailLine[];
  products: SaleProductOption[];
  canEdit: boolean;
  mutating: boolean;
  onAddLine: (input: {
    product_id: string;
    quantity: number;
    unit_price: number;
  }) => Promise<boolean>;
  onUpdateQuantity: (input: {
    sale_line_id: string;
    quantity: number;
  }) => Promise<boolean>;
  onDeleteLine: (input: { sale_line_id: string }) => Promise<boolean>;
};

function productLabel(
  productId: string,
  products: SaleProductOption[],
): string {
  const match = products.find((product) => product.id === productId);
  return match?.name ?? productId;
}

function buildQuantityDrafts(
  lines: SaleDetailLine[],
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const line of lines) {
    next[line.line_id] = formatNumericInput(line.quantity);
  }
  return next;
}

export function SaleLinesSection({
  lines,
  products,
  canEdit,
  mutating,
  onAddLine,
  onUpdateQuantity,
  onDeleteLine,
}: SaleLinesSectionProps) {
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    () => buildQuantityDrafts(lines),
  );
  const [prevLines, setPrevLines] = useState(lines);
  const [addProductId, setAddProductId] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  // Reset local quantity drafts to match the server-provided lines whenever
  // they change (e.g. after a save) — adjusted during render per
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes,
  // instead of an effect, since it's a pure reaction to a prop change.
  if (lines !== prevLines) {
    setPrevLines(lines);
    setQuantityDrafts(buildQuantityDrafts(lines));
  }

  // Same rule as POS / Quick Sale: only products with a price in Recipes.
  const pricedProducts = products.filter(isPriced);
  const selectedProduct =
    pricedProducts.find((product) => product.id === addProductId) ?? null;
  const previewQuantity = parseNumericInput(addQuantity);
  const previewLineTotal =
    selectedProduct && previewQuantity !== null && previewQuantity > 0
      ? calculateMoneyLineTotal(previewQuantity, selectedProduct.selling_price)
      : null;

  const handleUpdateQuantity = async (lineId: string) => {
    setRowError(null);
    const parsed = parseNumericInput(quantityDrafts[lineId] ?? "");

    if (parsed === null || parsed <= 0) {
      setRowError("Enter a quantity greater than zero.");
      return;
    }

    await onUpdateQuantity({
      sale_line_id: lineId,
      quantity: parsed,
    });
  };

  const handleDelete = async (lineId: string) => {
    setRowError(null);
    await onDeleteLine({ sale_line_id: lineId });
  };

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    setAddError(null);

    if (!selectedProduct) {
      setAddError("Select a product.");
      return;
    }

    const quantity = parseNumericInput(addQuantity);

    if (quantity === null || quantity <= 0) {
      setAddError("Enter a quantity greater than zero.");
      return;
    }

    // The price is never typed here: it is the product's selling_price from
    // Recipes, and add_sale_line (sql/146) stores that price regardless.
    const ok = await onAddLine({
      product_id: selectedProduct.id,
      quantity,
      unit_price: selectedProduct.selling_price,
    });

    if (ok) {
      setAddProductId("");
      setAddQuantity("");
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">Sale Lines</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {canEdit
            ? "Add products and adjust quantities. Totals come from the server after each change."
            : lines.length === 0
              ? "No lines on this sale."
              : "Line totals are provided by the sales read model."}
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">No lines</p>
          <p className="mt-1 text-sm text-zinc-500">
            {canEdit
              ? "Add a product line to build this draft sale."
              : "This sale has no product lines."}
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
                  Quantity
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Unit Price
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Line Total
                </th>
                {canEdit ? (
                  <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.line_id}
                  className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                >
                  <td className="px-4 py-4 font-medium text-zinc-900">
                    {productLabel(line.product_id, products)}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-2">
                        <NumericInput
                          value={quantityDrafts[line.line_id] ?? ""}
                          onChange={(value) => {
                            setQuantityDrafts((current) => ({
                              ...current,
                              [line.line_id]: value,
                            }));
                            setRowError(null);
                          }}
                          disabled={mutating}
                          aria-label={`Quantity for ${productLabel(line.product_id, products)}`}
                          className="w-28 rounded-lg border border-zinc-300 px-3 py-2 text-right text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleUpdateQuantity(line.line_id);
                          }}
                          disabled={mutating}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      line.quantity
                    )}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {formatSaleMoney(line.unit_price)}
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-zinc-900">
                    {formatSaleMoney(line.line_total)}
                  </td>
                  {canEdit ? (
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          void handleDelete(line.line_id);
                        }}
                        disabled={mutating}
                        className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <form
          onSubmit={(event) => {
            void handleAdd(event);
          }}
          className="space-y-4 border-t border-zinc-200 bg-zinc-50 px-4 py-4"
        >
          <p className="text-sm font-medium text-zinc-900">Add line</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-sm text-zinc-600 sm:col-span-2">
              <span className="mb-1.5 block font-medium text-zinc-700">
                Product
              </span>
              <select
                value={addProductId}
                onChange={(event) => {
                  setAddProductId(event.target.value);
                  setAddError(null);
                }}
                disabled={mutating || pricedProducts.length === 0}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {pricedProducts.length === 0
                    ? "No priced products available"
                    : "Select product"}
                </option>
                {pricedProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-sm text-zinc-600">
              <span className="mb-1.5 block font-medium text-zinc-700">
                Quantity
              </span>
              <NumericInput
                value={addQuantity}
                onChange={(value) => {
                  setAddQuantity(value);
                  setAddError(null);
                }}
                disabled={mutating}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>

            <div className="text-sm text-zinc-600">
              <span className="mb-1.5 block font-medium text-zinc-700">
                Price
              </span>
              <p
                data-testid="add-line-price"
                className="py-2 text-sm text-zinc-900"
              >
                {selectedProduct
                  ? `${formatSaleMoney(selectedProduct.selling_price)}, set in Recipes`
                  : "Select a product"}
              </p>
              {previewLineTotal !== null ? (
                <p className="text-xs text-zinc-500">
                  Line total {formatSaleMoney(previewLineTotal)}
                </p>
              ) : null}
            </div>
          </div>

          {pricedProducts.length === 0 && products.length > 0 ? (
            <p className="text-sm text-zinc-500">
              Set a selling price on an active assembly recipe in Recipes to
              add it here.
            </p>
          ) : null}

          {addError || rowError ? (
            <p className="text-sm text-red-600">{addError ?? rowError}</p>
          ) : null}

          <button
            type="submit"
            disabled={mutating || pricedProducts.length === 0}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutating ? "Saving..." : "Add line"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
