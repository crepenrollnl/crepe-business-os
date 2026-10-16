/**
 * Write-off requests service (sql/157, audit S4/U5).
 *
 * Reads only cost-free sources: the write_off_request_list view, recipes
 * (dishes), the finished goods stock summary (sql/155) and ingredient stock
 * levels (sql/155). Writes only through the three RPCs; none of them
 * changes stock except approve, which runs the normal owner write-off on the
 * server. The approve result's write_off details (with its value) are never
 * passed on.
 */

import { finishedGoodsListService } from "@/features/finished-goods/services/finished-goods-list-service";
import { inventoryService } from "@/features/inventory/services/inventory-service";
import {
  WRITE_OFF_REASONS,
  type WriteOffReason,
} from "@/features/write-offs/types/write-off";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  WRITE_OFF_REQUEST_ITEM_TYPES,
  WRITE_OFF_REQUEST_MAX_QUANTITY,
  WRITE_OFF_REQUEST_MIN_QUANTITY,
  WRITE_OFF_REQUEST_NOTE_MAX_LENGTH,
  type ApproveWriteOffRequestResult,
  type RejectWriteOffRequestResult,
  type RequestWriteOffInput,
  type RequestWriteOffResult,
  type WriteOffRequest,
  type WriteOffRequestItemOption,
  type WriteOffRequestItemOptions,
  type WriteOffRequestItemType,
  type WriteOffRequestStatus,
} from "../types/write-off-request";

const LIST_VIEW = "write_off_request_list";
const LIST_LIMIT = 100;

/** Every column of write_off_request_list — none of them is a cost. */
export const WRITE_OFF_REQUEST_LIST_SELECT =
  "id, item_type, ingredient_id, product_id, item_name, unit, quantity, approved_quantity, reason, note, status, requested_by, requested_at, decided_by, decided_at, decision_note, is_mine";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DECIDE_PERMISSION_MESSAGE =
  "Only the owner or a partner can approve or reject write-off requests.";

interface WriteOffRequestSqlRow {
  id: string;
  item_type: string;
  ingredient_id: string | null;
  product_id: string | null;
  item_name: string | null;
  unit: string | null;
  quantity: number | string;
  approved_quantity: number | string | null;
  reason: string;
  note: string | null;
  status: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  is_mine: boolean | null;
}

interface DishRow {
  id: string;
  name: string;
  yield_unit: string | null;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function isItemType(value: string): value is WriteOffRequestItemType {
  return (WRITE_OFF_REQUEST_ITEM_TYPES as readonly string[]).includes(value);
}

function isReason(value: string): value is WriteOffReason {
  return (WRITE_OFF_REASONS as readonly string[]).includes(value);
}

function isStatus(value: string): value is WriteOffRequestStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

function mapRequestRow(row: WriteOffRequestSqlRow): WriteOffRequest {
  if (!isItemType(row.item_type) || !isReason(row.reason) || !isStatus(row.status)) {
    throw new Error("Write-off request row is invalid.");
  }

  return {
    id: row.id,
    item_type: row.item_type,
    ingredient_id: row.ingredient_id,
    product_id: row.product_id,
    item_name: row.item_name,
    unit: row.unit,
    quantity: toNumber(row.quantity),
    approved_quantity:
      row.approved_quantity === null ? null : toNumber(row.approved_quantity),
    reason: row.reason,
    note: row.note,
    status: row.status,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    decision_note: row.decision_note,
    is_mine: row.is_mine === true,
  };
}

function readMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return typeof error === "string" ? error : "";
}

/** require_role (42501) on approve/reject → a plain sentence. */
function mapDecideError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) =>
      readMessage(err).toLowerCase().includes("insufficient permissions")
        ? DECIDE_PERMISSION_MESSAGE
        : null,
  });
}

function readObject(data: unknown): Record<string, unknown> | null {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)
    : null;
}

/** Client-side check of what request_write_off also checks (sql/157). */
export function validateRequestWriteOffInput(
  input: RequestWriteOffInput,
): string | null {
  if (!isItemType(input.item_type)) {
    return "Choose what to write off: ingredient, finished good or dish.";
  }
  if (!UUID_RE.test(input.item_id.trim())) {
    return "Choose the item to write off.";
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return "Write-off quantity must be greater than zero.";
  }
  if (
    input.quantity < WRITE_OFF_REQUEST_MIN_QUANTITY ||
    input.quantity > WRITE_OFF_REQUEST_MAX_QUANTITY
  ) {
    return "Quantity must be between 0.001 and 1000.";
  }
  if (!isReason(input.reason)) {
    return "Write-off reason is invalid.";
  }
  if (input.note !== null && input.note.length > WRITE_OFF_REQUEST_NOTE_MAX_LENGTH) {
    return "Note is too long (500 characters at most).";
  }
  if (!UUID_RE.test(input.client_request_id)) {
    return "Request token is invalid.";
  }
  return null;
}

function byName(a: WriteOffRequestItemOption, b: WriteOffRequestItemOption): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export const writeOffRequestService = {
  /** Newest first, at most 100 (RLS: sellers get only their own rows). */
  async listRequests(): Promise<ServiceResult<WriteOffRequest[]>> {
    try {
      const { data, error } = await supabase
        .from(LIST_VIEW)
        .select(WRITE_OFF_REQUEST_LIST_SELECT)
        .order("requested_at", { ascending: false })
        .limit(LIST_LIMIT);

      if (error) {
        return fail(toUserError(error, "Failed to load write-off requests"));
      }

      return ok(((data as WriteOffRequestSqlRow[] | null) ?? []).map(mapRequestRow));
    } catch (error) {
      return fail(toUserError(error, "Failed to load write-off requests"));
    }
  },

  /** Number of pending requests (owner/partner: all of them, via RLS). */
  async countPending(): Promise<ServiceResult<number>> {
    try {
      const { count, error } = await supabase
        .from("write_off_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      if (error) {
        return fail(toUserError(error, "Failed to count write-off requests"));
      }

      return ok(count ?? 0);
    } catch (error) {
      return fail(toUserError(error, "Failed to count write-off requests"));
    }
  },

  async requestWriteOff(
    input: RequestWriteOffInput,
  ): Promise<ServiceResult<RequestWriteOffResult>> {
    try {
      const note = input.note?.trim() ? input.note.trim() : null;
      const normalized: RequestWriteOffInput = { ...input, note };
      const validationError = validateRequestWriteOffInput(normalized);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("request_write_off", {
        p_item_type: normalized.item_type,
        p_item_id: normalized.item_id.trim(),
        p_quantity: normalized.quantity,
        p_reason: normalized.reason,
        p_note: note,
        p_client_request_id: normalized.client_request_id,
      });

      if (error) {
        return fail(toUserError(error, "Failed to send the write-off request"));
      }

      const row = readObject(data);
      const status = typeof row?.status === "string" ? row.status : "";
      if (typeof row?.id !== "string" || !isStatus(status)) {
        return fail("Write-off request response was invalid.");
      }

      return ok({ id: row.id, status });
    } catch (error) {
      return fail(toUserError(error, "Failed to send the write-off request"));
    }
  },

  /** quantity null = approve as requested. */
  async approve(
    requestId: string,
    quantity: number | null,
  ): Promise<ServiceResult<ApproveWriteOffRequestResult>> {
    try {
      if (!UUID_RE.test(requestId)) {
        return fail("Write-off request id is required.");
      }
      if (
        quantity !== null &&
        (!Number.isFinite(quantity) ||
          quantity < WRITE_OFF_REQUEST_MIN_QUANTITY ||
          quantity > WRITE_OFF_REQUEST_MAX_QUANTITY)
      ) {
        return fail("Quantity must be between 0.001 and 1000.");
      }

      const { data, error } = await supabase.rpc("approve_write_off_request", {
        p_request_id: requestId,
        p_quantity: quantity,
      });

      if (error) {
        return fail(mapDecideError(error, "Failed to approve the request"));
      }

      const row = readObject(data);
      const approved = row?.approved_quantity;
      if (
        typeof row?.id !== "string" ||
        row.status !== "approved" ||
        (typeof approved !== "number" && typeof approved !== "string") ||
        Number.isNaN(toNumber(approved))
      ) {
        return fail("Write-off approval response was invalid.");
      }

      // row.write_off (with its value) is deliberately not passed on.
      return ok({
        id: row.id,
        status: "approved",
        approved_quantity: toNumber(approved),
      });
    } catch (error) {
      return fail(mapDecideError(error, "Failed to approve the request"));
    }
  },

  async reject(
    requestId: string,
    note: string | null,
  ): Promise<ServiceResult<RejectWriteOffRequestResult>> {
    try {
      if (!UUID_RE.test(requestId)) {
        return fail("Write-off request id is required.");
      }
      const trimmed = note?.trim() ? note.trim() : null;
      if (trimmed !== null && trimmed.length > WRITE_OFF_REQUEST_NOTE_MAX_LENGTH) {
        return fail("Note is too long (500 characters at most).");
      }

      const { data, error } = await supabase.rpc("reject_write_off_request", {
        p_request_id: requestId,
        p_note: trimmed,
      });

      if (error) {
        return fail(mapDecideError(error, "Failed to reject the request"));
      }

      const row = readObject(data);
      if (typeof row?.id !== "string" || row.status !== "rejected") {
        return fail("Write-off rejection response was invalid.");
      }

      return ok({ id: row.id, status: "rejected" });
    } catch (error) {
      return fail(mapDecideError(error, "Failed to reject the request"));
    }
  },

  /**
   * What the form can offer, all cost-free: dishes (active assembly
   * recipes), finished goods (finished_goods_stock_summary + yield unit) and
   * active ingredients (ingredient_stock_levels).
   */
  async listItemOptions(): Promise<ServiceResult<WriteOffRequestItemOptions>> {
    try {
      const [dishResult, finishedResult, ingredientResult] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, yield_unit")
          .eq("is_active", true)
          .eq("recipe_role", "assembly")
          .order("name"),
        finishedGoodsListService.listProductStock(),
        inventoryService.getStockLevels(),
      ]);

      if (dishResult.error) {
        return fail(toUserError(dishResult.error, "Failed to load dishes"));
      }
      if (finishedResult.error || !finishedResult.data) {
        return fail(finishedResult.error ?? "Failed to load finished goods");
      }
      if (ingredientResult.error || !ingredientResult.data) {
        return fail(ingredientResult.error ?? "Failed to load ingredients");
      }

      return ok({
        dish: ((dishResult.data as DishRow[] | null) ?? [])
          .map((row) => ({ id: row.id, name: row.name, unit: row.yield_unit }))
          .sort(byName),
        finished_good: finishedResult.data
          .map((row) => ({
            id: row.product_id,
            name: row.product_name ?? row.product_id,
            unit: row.yield_unit,
          }))
          .sort(byName),
        ingredient: ingredientResult.data
          .filter((row) => row.active)
          .map((row) => ({ id: row.id, name: row.name, unit: row.unit }))
          .sort(byName),
      });
    } catch (error) {
      return fail(toUserError(error, "Failed to load items"));
    }
  },
};
