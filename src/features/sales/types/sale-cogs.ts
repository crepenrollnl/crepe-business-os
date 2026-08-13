/**
 * Sales COGS contracts (DEV-108).
 *
 * Frozen sale valuation built only from Finished Goods batch consumptions
 * (DEV-107 ledger). Unit costs are never recalculated.
 *
 * Does not define profit, accounting postings, or tax.
 * Specs: docs/SALES.md, docs/BATCH_CONSUMPTION.md
 */

/**
 * One immutable COGS layer, from either ledger a completed sale can draw
 * from (sql/089): a Finished Goods FIFO consumption (component_recipe_id
 * part of an assembly) or a direct raw-ingredient stock movement
 * (ingredient_id part of an assembly, decremented straight from
 * ingredients.current_stock — no production batch involved).
 */
export interface SaleCogsBatchLayer {
  consumption_id: string;
  sale_line_id: string;
  /** null for an "ingredient" layer — there is no production batch. */
  production_batch_id: string | null;
  batch_number: number | null;
  quantity: number;
  /** Frozen unit cost from the consumption ledger (batch snapshot). */
  unit_cost: number;
  /** Stored layer cost from the ledger — never recomputed in Sales. */
  total_cost: number;
  produced_at: string | null;
  /** Which ledger this layer came from. */
  source: "finished_goods" | "ingredient";
  /** Set only when source === "ingredient". */
  ingredient_id: string | null;
  /** Set only when source === "ingredient". */
  ingredient_name: string | null;
}

/** Per sale-line COGS rollup (sum of stored layer total_cost). */
export interface SaleLineCostSummary {
  sale_line_id: string;
  consumed_quantity: number;
  line_cogs: number;
  layers: SaleCogsBatchLayer[];
}

/**
 * Frozen sale cost summary for a completed sale.
 * Immutable after confirmation — rebuilt only by re-reading the ledger.
 */
export interface SaleCostSummary {
  sale_id: string;
  /** Σ stored consumption total_cost for this sale. */
  total_cogs: number;
  consumed_quantity: number;
  layers: SaleCogsBatchLayer[];
  line_summaries: SaleLineCostSummary[];
  /** True — valuation is frozen from append-only ledger rows. */
  is_frozen: true;
}

/** Input facts for the pure COGS builder (already-stored consumption). */
export interface SaleCogsBuilderInput {
  sale_id: string;
  sale_status: "draft" | "confirmed" | "paid" | "cancelled";
  layers: readonly SaleCogsBatchLayer[];
  /**
   * Optional set of sale ids that already have a built frozen summary
   * (duplicate generation guard for the same completion event).
   */
  alreadyBuiltSaleIds?: readonly string[];
}
