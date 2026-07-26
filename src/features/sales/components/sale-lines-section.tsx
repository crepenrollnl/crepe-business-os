"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import type { SaleDetailLine } from "../types/sale";
import { formatSaleMoney } from "../utils/format-sale";

export type SaleProductOption = {
  id: string;
  name: string;
};

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
    {},
  );
  const [addProductId, setAddProductId] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addUnitPrice, setAddUnitPrice] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const line of lines) {
      next[line.line_id] = formatNumericInput(line.quantity);
    }
    setQuantityDrafts(next);
  }, [lines]);

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

    if (!addProductId) {
      setAddError("Select a product.");
      return;
    }

    const quantity = parseNumericInput(addQuantity);
    const unitPrice = parseNumericInput(addUnitPrice);

    if (quantity === null || quantity <= 0) {
      setAddError("Enter a quantity greater than zero.");
      return;
    }

    if (unitPrice === null || unitPrice < 0) {
      setAddError("Enter a unit price of zero or greater.");
      return;
    }

    const ok = await onAddLine({
      product_id: addProductId,
      quantity,
      unit_price: unitPrice,
    });

    if (ok) {
      setAddProductId("");
      setAddQuantity("");
      setAddUnitPrice("");
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
                disabled={mutating || products.length === 0}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">
                  {products.length === 0
                    ? "No active products available"
                    : "Select product"}
                </option>
                {products.map((product) => (
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

            <label className="block text-sm text-zinc-600">
              <span className="mb-1.5 block font-medium text-zinc-700">
                Unit price
              </span>
              <NumericInput
                value={addUnitPrice}
                onChange={(value) => {
                  setAddUnitPrice(value);
                  setAddError(null);
                }}
                disabled={mutating}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
          </div>

          {addError || rowError ? (
            <p className="text-sm text-red-600">{addError ?? rowError}</p>
          ) : null}

          <button
            type="submit"
            disabled={mutating || products.length === 0}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutating ? "Saving..." : "Add line"}
          </button>
        </form>
      ) : null}
    </div>
  );
}
