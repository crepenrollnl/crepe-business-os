/**
 * Production domain contracts.
 * Execution consumes recipe ingredients and produces finished goods.
 */

export type ProductionOrderStatus =
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface ProductionOrder {
  id: string;
  recipe_id: string;
  product_id: string | null;
  status: ProductionOrderStatus;
  planned_quantity: number;
  produced_quantity: number;
  scheduled_at: string | null;
  completed_at: string | null;
  transaction_id: string | null;
  created_at: string;
}

export interface ProductionItem {
  id: string;
  production_order_id: string;
  ingredient_id: string | null;
  product_id: string | null;
  quantity: number;
  direction: "input" | "output";
}
