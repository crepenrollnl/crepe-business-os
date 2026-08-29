"use client";

import type { IngredientWithRelations } from "@/features/inventory/types/inventory";
import { usePosStock } from "../hooks/use-pos-stock";
import { PosSaleableNowSection } from "./pos-saleable-now-section";

type StockStatus = "ok" | "low" | "out";

function getStockStatus(item: IngredientWithRelations): StockStatus {
  if (item.current_stock === 0) {
    return "out";
  }

  if (item.current_stock <= item.minimum_stock) {
    return "low";
  }

  return "ok";
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

function StockBadge({ status }: { status: StockStatus }) {
  if (status === "ok") {
    return null;
  }

  const label = status === "out" ? "Out" : "Low";
  const className =
    status === "out"
      ? "bg-red-200 text-red-800"
      : "bg-amber-100 text-amber-800";

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

export function PosStockPane() {
  const { items, loading, error, retry } = usePosStock();

  return (
    <div className="space-y-6">
      <PosSaleableNowSection />
      <PosIngredientStockSection
        items={items}
        loading={loading}
        error={error}
        retry={retry}
      />
    </div>
  );
}

function PosIngredientStockSection({
  items,
  loading,
  error,
  retry,
}: {
  items: IngredientWithRelations[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const body = (() => {
    if (loading) {
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
          Loading stock…
        </div>
      );
    }

    if (error) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm">
          <p className="text-base font-medium text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => {
              void retry();
            }}
            className="mt-4 min-h-12 rounded-lg bg-red-600 px-4 py-2 text-base font-semibold text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
          <p className="text-base font-medium text-zinc-900">No ingredients</p>
          <p className="mt-1 text-sm text-zinc-500">
            Inventory is empty. Add ingredients in the OS Inventory module.
          </p>
        </div>
      );
    }

    return (
      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        {items.map((item) => {
          const status = getStockStatus(item);

          return (
            <li
              key={item.id}
              className="flex items-center justify-between gap-4 px-4 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-zinc-900">
                  {item.name}
                </p>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {formatQuantity(item.current_stock)} {item.unit}
                </p>
              </div>
              <StockBadge status={status} />
            </li>
          );
        })}
      </ul>
    );
  })();

  return (
    <section aria-labelledby="pos-ingredient-stock-heading" className="space-y-3">
      <h2
        id="pos-ingredient-stock-heading"
        className="text-base font-semibold text-zinc-900"
      >
        Ingredients
      </h2>
      {body}
    </section>
  );
}
