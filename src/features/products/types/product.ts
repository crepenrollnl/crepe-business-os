/**
 * Products domain contracts.
 * Implementation belongs in a future Products sprint.
 */

export type ProductStatus = "active" | "inactive" | "archived";

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  description: string | null;
  status: ProductStatus;
  sale_price: number;
  recipe_id: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  status: ProductStatus;
  sale_price: number;
  recipe_id: string;
}
