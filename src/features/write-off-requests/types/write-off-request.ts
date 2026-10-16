/**
 * Write-off requests (sql/157, audit S4/U5): a seller asks for a write-off,
 * the owner or a partner approves (possibly with a corrected quantity) or
 * rejects it. Requests carry no cost, value or price — approval runs the
 * normal record_write_off / record_dish_write_off on the server.
 */

import type { WriteOffReason } from "@/features/write-offs/types/write-off";

export const WRITE_OFF_REQUEST_ITEM_TYPES = [
  "dish",
  "finished_good",
  "ingredient",
] as const;

export type WriteOffRequestItemType =
  (typeof WRITE_OFF_REQUEST_ITEM_TYPES)[number];

export const WRITE_OFF_REQUEST_ITEM_TYPE_LABELS: Record<
  WriteOffRequestItemType,
  string
> = {
  dish: "Dish",
  finished_good: "Finished good",
  ingredient: "Ingredient",
};

export type WriteOffRequestStatus = "pending" | "approved" | "rejected";

export const WRITE_OFF_REQUEST_MIN_QUANTITY = 0.001;
export const WRITE_OFF_REQUEST_MAX_QUANTITY = 1000;
export const WRITE_OFF_REQUEST_NOTE_MAX_LENGTH = 500;

/** One row of write_off_request_list (security_invoker view, sql/157). */
export interface WriteOffRequest {
  id: string;
  item_type: WriteOffRequestItemType;
  ingredient_id: string | null;
  product_id: string | null;
  item_name: string | null;
  unit: string | null;
  quantity: number;
  approved_quantity: number | null;
  reason: WriteOffReason;
  note: string | null;
  status: WriteOffRequestStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_mine: boolean;
}

export interface RequestWriteOffInput {
  item_type: WriteOffRequestItemType;
  item_id: string;
  quantity: number;
  reason: WriteOffReason;
  note: string | null;
  /** One uuid per form attempt; the same one on retry (sql/157 returns the first request). */
  client_request_id: string;
}

export interface RequestWriteOffResult {
  id: string;
  status: WriteOffRequestStatus;
}

/** approve_write_off_request result, without the owner-only write_off details. */
export interface ApproveWriteOffRequestResult {
  id: string;
  status: "approved";
  approved_quantity: number;
}

export interface RejectWriteOffRequestResult {
  id: string;
  status: "rejected";
}

/** A cost-free item the request form can offer. */
export interface WriteOffRequestItemOption {
  id: string;
  name: string;
  unit: string | null;
}

export type WriteOffRequestItemOptions = Record<
  WriteOffRequestItemType,
  WriteOffRequestItemOption[]
>;
