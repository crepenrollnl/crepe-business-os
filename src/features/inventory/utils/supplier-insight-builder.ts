/**
 * Supplier Insights pure builder (DEV-119).
 *
 * Aggregates historical received purchase facts only.
 * No ranking scores beyond frequency counts.
 */

import type {
  BuildSupplierInsightInput,
  SupplierInsight,
  SupplierInsightPurchaseFact,
} from "../types/supplier-insight";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function validateSupplierInsightPurchaseFact(
  fact: SupplierInsightPurchaseFact,
): string | null {
  if (!fact.ingredient_id || !UUID_RE.test(fact.ingredient_id.trim())) {
    return "Ingredient id is required.";
  }

  if (fact.supplier_id !== null && fact.supplier_id !== undefined) {
    if (!UUID_RE.test(fact.supplier_id.trim())) {
      return "Supplier id is invalid.";
    }
  }

  if (!fact.purchased_at || !Number.isFinite(Date.parse(fact.purchased_at))) {
    return "Purchase date is invalid.";
  }

  if (!Number.isFinite(fact.unit_price) || fact.unit_price < 0) {
    return "Unit price must be a non-negative number.";
  }

  return null;
}

export function validateBuildSupplierInsightInput(
  input: BuildSupplierInsightInput,
): string | null {
  if (!input.ingredient_id || !UUID_RE.test(input.ingredient_id.trim())) {
    return "Ingredient id is required.";
  }

  for (const purchase of input.purchases) {
    if (purchase.ingredient_id.trim() !== input.ingredient_id.trim()) {
      return "Purchase fact ingredient id must match the insight ingredient.";
    }
    const factError = validateSupplierInsightPurchaseFact(purchase);
    if (factError) {
      return factError;
    }
  }

  return null;
}

function emptyInsight(ingredientId: string): SupplierInsight {
  return {
    ingredient_id: ingredientId,
    last_supplier_id: null,
    last_supplier_name: null,
    last_purchase_date: null,
    last_purchase_price: null,
    most_frequent_supplier_id: null,
    most_frequent_supplier_name: null,
    purchase_count: 0,
  };
}

/**
 * Build supplier insights for one ingredient from historical purchase facts.
 */
export function buildSupplierInsight(
  input: BuildSupplierInsightInput,
): { data: SupplierInsight | null; error: string | null } {
  const validationError = validateBuildSupplierInsightInput(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const ingredientId = input.ingredient_id.trim();
  const purchases = [...input.purchases];

  if (purchases.length === 0) {
    return { data: emptyInsight(ingredientId), error: null };
  }

  purchases.sort((a, b) => toTime(b.purchased_at) - toTime(a.purchased_at));

  const last = purchases[0];
  if (!last) {
    return { data: emptyInsight(ingredientId), error: null };
  }

  const frequency = new Map<
    string,
    { count: number; name: string | null; latestAt: number }
  >();

  for (const purchase of purchases) {
    if (!purchase.supplier_id) {
      continue;
    }
    const key = purchase.supplier_id.trim();
    const existing = frequency.get(key);
    const purchasedAt = toTime(purchase.purchased_at);
    if (!existing) {
      frequency.set(key, {
        count: 1,
        name: purchase.supplier_name,
        latestAt: purchasedAt,
      });
      continue;
    }
    existing.count += 1;
    if (purchasedAt > existing.latestAt) {
      existing.latestAt = purchasedAt;
      existing.name = purchase.supplier_name;
    }
  }

  let mostFrequentId: string | null = null;
  let mostFrequentName: string | null = null;
  let bestCount = 0;
  let bestLatest = Number.NEGATIVE_INFINITY;

  for (const [supplierId, stats] of frequency) {
    if (
      stats.count > bestCount ||
      (stats.count === bestCount && stats.latestAt > bestLatest)
    ) {
      bestCount = stats.count;
      bestLatest = stats.latestAt;
      mostFrequentId = supplierId;
      mostFrequentName = stats.name;
    }
  }

  return {
    data: {
      ingredient_id: ingredientId,
      last_supplier_id: last.supplier_id,
      last_supplier_name: last.supplier_name,
      last_purchase_date: last.purchased_at,
      last_purchase_price: last.unit_price,
      most_frequent_supplier_id: mostFrequentId,
      most_frequent_supplier_name: mostFrequentName,
      purchase_count: purchases.length,
    },
    error: null,
  };
}

/**
 * Assert identical historical facts produce an identical insight.
 */
export function assertSupplierInsightHistoricallyConsistent(input: {
  previous: SupplierInsight;
  next: SupplierInsight;
}): string | null {
  const { previous, next } = input;

  if (
    previous.ingredient_id !== next.ingredient_id ||
    previous.last_supplier_id !== next.last_supplier_id ||
    previous.last_supplier_name !== next.last_supplier_name ||
    previous.last_purchase_date !== next.last_purchase_date ||
    previous.last_purchase_price !== next.last_purchase_price ||
    previous.most_frequent_supplier_id !== next.most_frequent_supplier_id ||
    previous.most_frequent_supplier_name !==
      next.most_frequent_supplier_name ||
    previous.purchase_count !== next.purchase_count
  ) {
    return "Supplier insights are inconsistent for the same purchase history.";
  }

  return null;
}
