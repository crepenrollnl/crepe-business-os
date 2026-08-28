"use client";

import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { IngredientMovementHistoryPanel } from "../components/ingredient-movement-history-panel";
import { useIngredientMovementHistory } from "../hooks/use-ingredient-movement-history";

type IngredientMovementHistoryPageProps = {
  ingredientId: string;
};

export function IngredientMovementHistoryPage({
  ingredientId,
}: IngredientMovementHistoryPageProps) {
  const { items, loading, error, retry } =
    useIngredientMovementHistory(ingredientId);
  const ingredientName = items[0]?.ingredient_name;

  return (
    <DashboardLayout activePath="/inventory">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <Link
            href="/inventory"
            className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Back to Inventory
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Movement history
          </h1>
          {ingredientName ? (
            <p className="mt-2 text-base text-zinc-600 sm:text-lg">
              {ingredientName}
            </p>
          ) : null}
        </div>

        <IngredientMovementHistoryPanel
          items={items}
          loading={loading}
          error={error}
          onRetry={retry}
        />
      </div>
    </DashboardLayout>
  );
}
