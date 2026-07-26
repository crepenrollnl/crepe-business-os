export interface IngredientCategory {
  id: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
}

export interface Ingredient {
  id: string;
  name: string;
  category_id: string | null;
  supplier_id: string | null;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  cost_per_unit: number;
  created_at?: string;
  updated_at?: string;
}

export interface IngredientWithRelations extends Ingredient {
  category: IngredientCategory | null;
  supplier: Supplier | null;
}

export interface IngredientFormValues {
  name: string;
  category_id: string;
  supplier_id: string;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  cost_per_unit: number;
}

export type CreateIngredientInput = IngredientFormValues;
export type UpdateIngredientInput = IngredientFormValues;

export type InventorySortField =
  | "name"
  | "current_stock"
  | "minimum_stock"
  | "cost_per_unit";

export type InventorySortDirection = "asc" | "desc";

export type { ServiceResult } from "@/types/service";
