export const INVENTORY_ADJUSTMENT_DIRECTIONS = [
  "increase",
  "decrease",
] as const;

export type InventoryAdjustmentDirection =
  (typeof INVENTORY_ADJUSTMENT_DIRECTIONS)[number];

export const INVENTORY_ADJUSTMENT_REASONS = [
  "opening_stock",
  "physical_count",
  "data_entry_correction",
  "other",
] as const;

export type InventoryAdjustmentReason =
  (typeof INVENTORY_ADJUSTMENT_REASONS)[number];

export const INVENTORY_ADJUSTMENT_REASON_LABELS: Record<
  InventoryAdjustmentReason,
  string
> = {
  opening_stock: "Opening stock",
  physical_count: "Physical count",
  data_entry_correction: "Data-entry correction",
  other: "Other",
};

export const INVENTORY_ADJUSTMENT_ROLES = ["owner", "partner"] as const;

export function canAdjustInventoryStock(role: string | null): boolean {
  return role === "owner" || role === "partner";
}

export interface RecordInventoryAdjustmentInput {
  ingredientId: string;
  direction: InventoryAdjustmentDirection;
  quantity: number;
  reason: InventoryAdjustmentReason;
  note: string | null;
}

export interface RecordInventoryAdjustmentResult {
  id: string;
  movement_id: string;
  current_stock: number;
}

export type { ServiceResult } from "@/types/service";
