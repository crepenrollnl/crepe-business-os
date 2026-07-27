/**
 * Supplier Insights read service (DEV-119).
 *
 * Aggregates historical received purchase lines per ingredient.
 * Read-only — never modifies purchases or inventory.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  SupplierInsight,
  SupplierInsightPurchaseFact,
} from "../types/supplier-insight";
import {
  assertSupplierInsightHistoricallyConsistent,
  buildSupplierInsight,
} from "../utils/supplier-insight-builder";

interface PurchaseItemJoinRow {
  ingredient_id: string;
  unit_cost: number | string;
  purchases:
    | {
        id: string;
        supplier_id: string | null;
        purchased_at: string;
        status: string;
        suppliers:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }
    | {
        id: string;
        supplier_id: string | null;
        purchased_at: string;
        status: string;
        suppliers:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }[]
    | null;
}

function toNumber(value: number | string): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function mapInsightError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();
      if (
        (normalized.includes("purchase_items") ||
          normalized.includes("purchases")) &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Supplier insights are not available yet. Apply purchase history scripts and try again.";
      }

      return null;
    },
  });
}

function mapPurchaseFacts(
  rows: PurchaseItemJoinRow[],
): ServiceResult<SupplierInsightPurchaseFact[]> {
  const facts: SupplierInsightPurchaseFact[] = [];

  for (const row of rows) {
    const purchase = firstRelation(row.purchases);
    if (!purchase) {
      continue;
    }
    if (purchase.status !== "received") {
      continue;
    }

    const unitPrice = toNumber(row.unit_cost);
    if (unitPrice === null) {
      return fail("Purchase unit cost is invalid.");
    }

    const supplier = firstRelation(purchase.suppliers);
    const supplierId = purchase.supplier_id;
    const supplierName = supplier?.name ?? null;

    // Missing supplier is allowed — builder surfaces null names.
    if (supplierId && !supplierName) {
      // Keep id; name may be missing if join failed.
    }

    facts.push({
      ingredient_id: row.ingredient_id,
      supplier_id: supplierId,
      supplier_name: supplierName,
      purchased_at: purchase.purchased_at,
      unit_price: unitPrice,
    });
  }

  return ok(facts);
}

export const supplierInsightService = {
  buildSupplierInsight,
  assertSupplierInsightHistoricallyConsistent,

  /**
   * Read-only insights for all ingredients that appear in received purchases.
   * Ingredients with no history are omitted (UI treats missing as empty).
   */
  async getSupplierInsights(): Promise<ServiceResult<SupplierInsight[]>> {
    try {
      const { data, error } = await supabase
        .from("purchase_items")
        .select(
          `
          ingredient_id,
          unit_cost,
          purchases!inner (
            id,
            supplier_id,
            purchased_at,
            status,
            suppliers (
              id,
              name
            )
          )
        `,
        )
        .eq("purchases.status", "received");

      if (error) {
        return fail(
          mapInsightError(error, "Failed to load purchase history for insights"),
        );
      }

      const factsResult = mapPurchaseFacts(
        (data ?? []) as PurchaseItemJoinRow[],
      );
      if (factsResult.error || !factsResult.data) {
        return fail(
          factsResult.error ?? "Failed to map purchase history for insights",
        );
      }

      const byIngredient = new Map<string, SupplierInsightPurchaseFact[]>();
      for (const fact of factsResult.data) {
        const list = byIngredient.get(fact.ingredient_id) ?? [];
        list.push(fact);
        byIngredient.set(fact.ingredient_id, list);
      }

      const insights: SupplierInsight[] = [];
      for (const [ingredientId, purchases] of byIngredient) {
        const built = buildSupplierInsight({
          ingredient_id: ingredientId,
          purchases,
        });
        if (built.error || !built.data) {
          return fail(built.error ?? "Failed to build supplier insight");
        }
        insights.push(built.data);
      }

      return ok(insights);
    } catch (error) {
      return fail(
        mapInsightError(error, "Failed to load supplier insights"),
      );
    }
  },

  /**
   * Convenience map keyed by ingredient id for Inventory table enrichment.
   * Includes empty insights for requested ingredient ids with no history.
   */
  async getSupplierInsightMap(
    ingredientIds?: readonly string[],
  ): Promise<ServiceResult<Map<string, SupplierInsight>>> {
    const result = await this.getSupplierInsights();
    if (result.error || !result.data) {
      return fail(result.error ?? "Failed to load supplier insights");
    }

    const map = new Map(
      result.data.map((insight) => [insight.ingredient_id, insight]),
    );

    if (ingredientIds) {
      for (const id of ingredientIds) {
        if (!map.has(id)) {
          const empty = buildSupplierInsight({
            ingredient_id: id,
            purchases: [],
          });
          if (empty.data) {
            map.set(id, empty.data);
          }
        }
      }
    }

    return ok(map);
  },
};
