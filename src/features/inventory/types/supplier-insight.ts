/**
 * Supplier Insights contracts (DEV-119).
 *
 * Advisory historical facts from received purchases.
 * Never modifies purchases or inventory.
 */

export interface SupplierInsight {
  ingredient_id: string;
  /** Supplier on the most recent received purchase line. */
  last_supplier_id: string | null;
  last_supplier_name: string | null;
  last_purchase_date: string | null;
  last_purchase_price: number | null;
  /** Mode of supplier_id across received lines (tie → most recent). */
  most_frequent_supplier_id: string | null;
  most_frequent_supplier_name: string | null;
  /** Count of received purchase lines for the ingredient. */
  purchase_count: number;
}

/** One historical received purchase line fact. */
export interface SupplierInsightPurchaseFact {
  ingredient_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  purchased_at: string;
  unit_price: number;
}

export interface BuildSupplierInsightInput {
  ingredient_id: string;
  purchases: SupplierInsightPurchaseFact[];
}
