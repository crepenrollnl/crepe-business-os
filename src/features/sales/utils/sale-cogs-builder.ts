/**
 * Sales COGS builder (DEV-108).
 *
 * Builds a frozen sale cost summary from Finished Goods consumption layers.
 * Uses stored quantity / unit_cost / total_cost only — never recalculates
 * unit costs or invents COGS from recipe / average / selling price.
 *
 * Does not calculate profit or emit accounting events.
 */

import { roundMoney } from "@/lib/money";
import type {
  SaleCogsBatchLayer,
  SaleCogsBuilderInput,
  SaleCostSummary,
  SaleLineCostSummary,
} from "../types/sale-cogs";

function toNumber(value: number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Validate a single stored consumption layer before including it in COGS.
 */
export function validateSaleCogsLayer(
  layer: SaleCogsBatchLayer,
): string | null {
  if (!layer.consumption_id?.trim()) {
    return "Consumption id is required for COGS.";
  }

  if (!layer.sale_line_id?.trim()) {
    return "Sale line id is required for COGS.";
  }

  if (layer.source === "ingredient") {
    if (!layer.ingredient_id?.trim()) {
      return "Ingredient id is required for COGS.";
    }
  } else if (!layer.production_batch_id?.trim()) {
    return "Production batch id is required for COGS.";
  }

  const quantity = toNumber(layer.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return "COGS consumption quantity must be greater than zero.";
  }

  const unitCost = toNumber(layer.unit_cost);
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    return "COGS unit cost is invalid.";
  }

  const totalCost = toNumber(layer.total_cost);
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    return "COGS layer total cost is invalid.";
  }

  return null;
}

/**
 * Reject regenerating a mutable second COGS snapshot for the same sale.
 * Re-reading the ledger into an identical frozen summary is allowed when
 * the sale is not already marked as built in the current generation pass.
 */
export function assertUniqueSaleCogsGeneration(
  saleId: string,
  alreadyBuiltSaleIds: readonly string[],
): string | null {
  const trimmed = saleId?.trim() ?? "";
  if (!trimmed) {
    return "Sale id is required.";
  }

  if (alreadyBuiltSaleIds.includes(trimmed)) {
    return "Sale COGS has already been generated for this sale.";
  }

  return null;
}

function buildLineSummaries(
  layers: readonly SaleCogsBatchLayer[],
): SaleLineCostSummary[] {
  const byLine = new Map<string, SaleCogsBatchLayer[]>();

  for (const layer of layers) {
    const existing = byLine.get(layer.sale_line_id) ?? [];
    existing.push(layer);
    byLine.set(layer.sale_line_id, existing);
  }

  return [...byLine.entries()].map(([sale_line_id, lineLayers]) => {
    const consumed_quantity = lineLayers.reduce(
      (sum, layer) => sum + toNumber(layer.quantity),
      0,
    );
    const line_cogs = roundMoney(
      lineLayers.reduce((sum, layer) => sum + toNumber(layer.total_cost), 0),
    );

    return {
      sale_line_id,
      consumed_quantity,
      line_cogs,
      layers: lineLayers,
    };
  });
}

/**
 * Build frozen sale COGS from stored Finished Goods consumption layers.
 */
export function buildSaleCostSummary(
  input: SaleCogsBuilderInput,
):
  | { ok: true; summary: SaleCostSummary }
  | { ok: false; error: string } {
  const saleId = input.sale_id?.trim() ?? "";
  if (!saleId) {
    return { ok: false, error: "Sale id is required." };
  }

  const duplicateError = assertUniqueSaleCogsGeneration(
    saleId,
    input.alreadyBuiltSaleIds ?? [],
  );
  if (duplicateError) {
    return { ok: false, error: duplicateError };
  }

  if (input.sale_status === "draft") {
    return {
      ok: false,
      error: "Draft sales do not have frozen COGS yet.",
    };
  }

  if (input.layers.length === 0) {
    return {
      ok: false,
      error: "Sale has no Finished Goods consumption layers for COGS.",
    };
  }

  for (const layer of input.layers) {
    if (layer.quantity === 0) {
      return {
        ok: false,
        error: "COGS consumption quantity must be greater than zero.",
      };
    }

    const layerError = validateSaleCogsLayer(layer);
    if (layerError) {
      return { ok: false, error: layerError };
    }
  }

  const total_cogs = roundMoney(
    input.layers.reduce((sum, layer) => sum + toNumber(layer.total_cost), 0),
  );
  const consumed_quantity = input.layers.reduce(
    (sum, layer) => sum + toNumber(layer.quantity),
    0,
  );

  return {
    ok: true,
    summary: {
      sale_id: saleId,
      total_cogs,
      consumed_quantity,
      layers: [...input.layers],
      line_summaries: buildLineSummaries(input.layers),
      is_frozen: true,
    },
  };
}

/**
 * Assert historical COGS immutability: stored layer unit costs must not change.
 */
export function assertSaleCogsImmutable(input: {
  previous: SaleCostSummary;
  next: SaleCostSummary;
}): string | null {
  if (input.previous.sale_id !== input.next.sale_id) {
    return "Sale COGS sale id is immutable.";
  }

  if (input.previous.total_cogs !== input.next.total_cogs) {
    return "Sale COGS is immutable after completion.";
  }

  if (input.previous.layers.length !== input.next.layers.length) {
    return "Sale COGS batch breakdown is immutable after completion.";
  }

  const prevById = new Map(
    input.previous.layers.map((layer) => [layer.consumption_id, layer]),
  );

  for (const nextLayer of input.next.layers) {
    const prev = prevById.get(nextLayer.consumption_id);
    if (!prev) {
      return "Sale COGS batch breakdown is immutable after completion.";
    }

    if (
      prev.unit_cost !== nextLayer.unit_cost ||
      prev.quantity !== nextLayer.quantity ||
      prev.total_cost !== nextLayer.total_cost ||
      prev.production_batch_id !== nextLayer.production_batch_id
    ) {
      return "Sale COGS is immutable after completion.";
    }
  }

  return null;
}
