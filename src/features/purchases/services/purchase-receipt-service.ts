import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  PURCHASE_RECEIPT_BUCKET,
  type PurchaseReceiptCard,
  type PurchaseReceiptSupplierOption,
  type SavePurchaseReceiptInput,
  type UpdatePurchaseReceiptInput,
} from "../types/purchase-receipt";
import { RECEIPT_NO_LONGER_UNASSIGNED } from "../utils/receipt-purchase-link";
import { addCalendarDays, amsterdamToday } from "../utils/amsterdam-date";

const SIGNED_URL_SECONDS = 60 * 60;
const RECENT_RECEIPT_DAYS = 60;

const RECEIPT_SELECT =
  "id, purchase_id, supplier_id, receipt_date, receipt_total, note, created_at, suppliers(name), purchase_receipt_files(page_number, storage_path)";

interface ReceiptFileRow {
  page_number: number;
  storage_path: string;
}

interface ReceiptQueryRow {
  id: string;
  purchase_id: string | null;
  supplier_id: string | null;
  receipt_date: string;
  receipt_total: number | string | null;
  note: string | null;
  created_at: string;
  suppliers: { name: string } | { name: string }[] | null;
  purchase_receipt_files: ReceiptFileRow[] | null;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function supplierName(
  value: ReceiptQueryRow["suppliers"],
): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value[0]?.name ?? null;
  }
  return value.name;
}

function isFileRow(value: unknown): value is ReceiptFileRow {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row.page_number === "number" && typeof row.storage_path === "string";
}

function isReceiptQueryRow(value: unknown): value is ReceiptQueryRow {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.receipt_date === "string";
}

function cardFromRow(row: ReceiptQueryRow): PurchaseReceiptCard {
  const files = (row.purchase_receipt_files ?? [])
    .filter(isFileRow)
    .slice()
    .sort((left, right) => left.page_number - right.page_number);
  const pagePaths = files.map((file) => file.storage_path);

  return {
    id: row.id,
    purchaseId: row.purchase_id,
    supplierId: row.supplier_id,
    supplierName: supplierName(row.suppliers),
    receiptDate: row.receipt_date,
    receiptTotal: toNumber(row.receipt_total),
    note: row.note,
    pageCount: pagePaths.length,
    pagePaths,
    thumbnailUrl: null,
  };
}

async function signPaths(paths: string[]): Promise<Map<string, string | null>> {
  const unique = [...new Set(paths)];
  const signed = new Map<string, string | null>();
  for (const path of unique) {
    signed.set(path, null);
  }
  if (unique.length === 0) {
    return signed;
  }

  const { data, error } = await supabase.storage
    .from(PURCHASE_RECEIPT_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_SECONDS);

  if (error || !Array.isArray(data)) {
    return signed;
  }

  for (const item of data) {
    if (!item || item.error || typeof item.path !== "string" || item.path.length === 0) {
      continue;
    }
    if (typeof item.signedUrl === "string" && item.signedUrl.length > 0) {
      signed.set(item.path, item.signedUrl);
    }
  }

  return signed;
}

async function loadCards(
  rows: unknown,
): Promise<ServiceResult<PurchaseReceiptCard[]>> {
  if (!Array.isArray(rows)) {
    return ok([]);
  }

  const cards = rows.flatMap((row) => (isReceiptQueryRow(row) ? [cardFromRow(row)] : []));
  let signed = new Map<string, string | null>();
  try {
    signed = await signPaths(
      cards.flatMap((card) => (card.pagePaths[0] ? [card.pagePaths[0]] : [])),
    );
  } catch {
    signed = new Map();
  }

  return ok(
    cards.map((card) => ({
      ...card,
      thumbnailUrl: card.pagePaths[0] ? (signed.get(card.pagePaths[0]) ?? null) : null,
    })),
  );
}

export const purchaseReceiptService = {
  async listActiveSuppliers(): Promise<
    ServiceResult<PurchaseReceiptSupplierOption[]>
  > {
    try {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");

      if (error) {
        return fail(toUserError(error, "Failed to load suppliers"));
      }

      const suppliers = (Array.isArray(data) ? data : []).flatMap((row) => {
        if (!row || typeof row !== "object") {
          return [];
        }
        const record = row as Record<string, unknown>;
        if (typeof record.id !== "string" || typeof record.name !== "string") {
          return [];
        }
        return [{ id: record.id, name: record.name }];
      });

      return ok(suppliers);
    } catch (error) {
      return fail(toUserError(error, "Failed to load suppliers"));
    }
  },

  async countUnassigned(): Promise<ServiceResult<number>> {
    try {
      const { count, error } = await supabase
        .from("purchase_receipts")
        .select("id", { count: "exact", head: true })
        .is("purchase_id", null)
        .is("discarded_at", null);

      if (error) {
        return fail(toUserError(error, "Failed to count receipts"));
      }

      return ok(count ?? 0);
    } catch (error) {
      return fail(toUserError(error, "Failed to count receipts"));
    }
  },

  async listForPurchase(
    purchaseId: string,
  ): Promise<ServiceResult<PurchaseReceiptCard[]>> {
    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .select(RECEIPT_SELECT)
        .eq("purchase_id", purchaseId)
        .is("discarded_at", null)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("page_number", {
          foreignTable: "purchase_receipt_files",
          ascending: true,
        });

      if (error) {
        return fail(toUserError(error, "Failed to load receipts"));
      }

      return loadCards(data);
    } catch (error) {
      return fail(toUserError(error, "Failed to load receipts"));
    }
  },

  async listUnassigned(): Promise<ServiceResult<PurchaseReceiptCard[]>> {
    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .select(RECEIPT_SELECT)
        .is("purchase_id", null)
        .is("discarded_at", null)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("page_number", {
          foreignTable: "purchase_receipt_files",
          ascending: true,
        });

      if (error) {
        return fail(toUserError(error, "Failed to load receipts"));
      }

      return loadCards(data);
    } catch (error) {
      return fail(toUserError(error, "Failed to load receipts"));
    }
  },

  async listRecent(): Promise<ServiceResult<PurchaseReceiptCard[]>> {
    try {
      const fromDate = addCalendarDays(amsterdamToday(), -RECENT_RECEIPT_DAYS);
      const { data, error } = await supabase
        .from("purchase_receipts")
        .select(RECEIPT_SELECT)
        .gte("receipt_date", fromDate)
        .is("discarded_at", null)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("page_number", {
          foreignTable: "purchase_receipt_files",
          ascending: true,
        });

      if (error) {
        return fail(toUserError(error, "Failed to load receipts"));
      }

      return loadCards(data);
    } catch (error) {
      return fail(toUserError(error, "Failed to load receipts"));
    }
  },

  async signStoragePaths(paths: string[]): Promise<ServiceResult<Array<string | null>>> {
    try {
      const signed = await signPaths(paths);
      return ok(paths.map((path) => signed.get(path) ?? null));
    } catch (error) {
      return fail(toUserError(error, "Could not open the photo."));
    }
  },

  async save(
    input: SavePurchaseReceiptInput,
  ): Promise<ServiceResult<string>> {
    const receiptId = crypto.randomUUID();
    const files: Array<{
      storage_path: string;
      mime_type: "image/jpeg";
      size_bytes: number;
      original_filename: string | null;
    }> = [];

    try {
      for (const page of input.pages) {
        const storagePath = `${receiptId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage
          .from(PURCHASE_RECEIPT_BUCKET)
          .upload(storagePath, page.blob, {
            contentType: "image/jpeg",
            upsert: false,
          });

        if (error) {
          return fail(toUserError(error, "Could not upload the photo."));
        }

        files.push({
          storage_path: storagePath,
          mime_type: "image/jpeg",
          size_bytes: page.blob.size,
          original_filename: page.originalFilename,
        });
      }

      const { data, error } = await supabase.rpc("create_purchase_receipt", {
        p_receipt_id: receiptId,
        p_receipt_date: input.receiptDate,
        p_supplier_id: input.supplierId,
        p_receipt_total: input.receiptTotal,
        p_note: input.note,
        p_files: files,
      });

      if (error) {
        return fail(toUserError(error, "Could not save the receipt."));
      }

      if (typeof data !== "string" || data.length === 0) {
        return fail("Could not save the receipt.");
      }

      return ok(data);
    } catch (error) {
      return fail(toUserError(error, "Could not save the receipt."));
    }
  },

  async update(
    id: string,
    input: UpdatePurchaseReceiptInput,
  ): Promise<ServiceResult<PurchaseReceiptCard>> {
    const payload = {
      supplier_id: input.supplierId,
      receipt_date: input.receiptDate,
      receipt_total: input.receiptTotal,
      note: input.note,
    };

    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .update(payload)
        .eq("id", id)
        .select(RECEIPT_SELECT)
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Could not update the receipt."));
      }

      if (!isReceiptQueryRow(data)) {
        return fail("Could not update the receipt.");
      }

      const card = cardFromRow(data);
      const signed = await signPaths(card.pagePaths[0] ? [card.pagePaths[0]] : []);
      return ok({
        ...card,
        thumbnailUrl: card.pagePaths[0] ? (signed.get(card.pagePaths[0]) ?? null) : null,
      });
    } catch (error) {
      return fail(toUserError(error, "Could not update the receipt."));
    }
  },

  async discard(id: string): Promise<ServiceResult<true>> {
    const payload = {
      discarded_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .update(payload)
        .eq("id", id)
        .is("purchase_id", null)
        .is("discarded_at", null)
        .select("id")
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Could not discard the receipt."));
      }

      if (!data || typeof data !== "object" || !("id" in data)) {
        return fail("Only an unassigned receipt can be discarded.");
      }

      return ok(true);
    } catch (error) {
      return fail(toUserError(error, "Could not discard the receipt."));
    }
  },

  async linkToPurchase(
    receiptId: string,
    purchaseId: string,
  ): Promise<ServiceResult<true>> {
    const payload = { purchase_id: purchaseId };

    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .update(payload)
        .eq("id", receiptId)
        .is("purchase_id", null)
        .is("discarded_at", null)
        .select("id")
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Could not attach the receipt."));
      }

      if (!data || typeof data !== "object" || !("id" in data)) {
        return fail(RECEIPT_NO_LONGER_UNASSIGNED);
      }

      return ok(true);
    } catch (error) {
      return fail(toUserError(error, "Could not attach the receipt."));
    }
  },

  async unlinkFromPurchase(
    receiptId: string,
    purchaseId: string,
  ): Promise<ServiceResult<true>> {
    const payload = { purchase_id: null };

    try {
      const { data, error } = await supabase
        .from("purchase_receipts")
        .update(payload)
        .eq("id", receiptId)
        .eq("purchase_id", purchaseId)
        .is("discarded_at", null)
        .select("id")
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Could not unlink the receipt."));
      }

      if (!data || typeof data !== "object" || !("id" in data)) {
        return fail("This receipt is no longer linked to this purchase.");
      }

      return ok(true);
    } catch (error) {
      return fail(toUserError(error, "Could not unlink the receipt."));
    }
  },
};
