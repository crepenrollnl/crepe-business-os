export const WRITE_OFF_ITEM_TYPES = ["ingredient", "finished_good"] as const;

export type WriteOffItemType = (typeof WRITE_OFF_ITEM_TYPES)[number];

export const WRITE_OFF_REASONS = [
  "spoilage",
  "damaged",
  "quality_reject",
  "staff_use",
  "theft",
  "other",
] as const;

export type WriteOffReason = (typeof WRITE_OFF_REASONS)[number];

export const WRITE_OFF_REASON_LABELS: Record<WriteOffReason, string> = {
  spoilage: "Spoiled / Expired",
  damaged: "Broken / Damaged",
  quality_reject: "Quality reject",
  staff_use: "Staff meal / Tasting",
  theft: "Theft / Missing",
  other: "Other",
};

export interface WriteOffRecord {
  id: string;
  item_type: WriteOffItemType;
  ingredient_id: string | null;
  product_id: string | null;
  quantity: number;
  unit_cost: number;
  total_value: number;
  reason: WriteOffReason;
  note: string | null;
  created_by: string | null;
  created_at: string;
  item_name: string | null;
}

export interface WriteOffIngredientOption {
  id: string;
  name: string;
  unit: string;
}

export interface WriteOffProductOption {
  id: string;
  name: string;
  /** Recipe's yield_unit (same source as Finished Goods' item.yield_unit) — null if unset. */
  unit: string | null;
}

export interface RecordWriteOffInput {
  itemType: WriteOffItemType;
  ingredientId: string | null;
  productId: string | null;
  quantity: number;
  reason: WriteOffReason;
  note: string | null;
}

export interface RecordWriteOffRpcResult {
  id: string;
  item_type: WriteOffItemType;
  total_value: number;
}

export const WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE =
  "Write-off recorded. No cost is on record for this item, so no accounting entry was created.";

export interface RecordWriteOffAndPostResult {
  writeOff: RecordWriteOffRpcResult;
  postingError: string | null;
  /** Expected skip of the journal when total_value is 0 — not a posting failure. */
  accountingNote: string | null;
}

export interface WriteOffPeriodTotals {
  totalValue: number;
  byReason: Record<WriteOffReason, number>;
}

export type { ServiceResult } from "@/types/service";
