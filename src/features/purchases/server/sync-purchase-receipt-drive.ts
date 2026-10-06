import type { SupabaseClient } from "@supabase/supabase-js";
import { PURCHASE_RECEIPT_BUCKET } from "../types/purchase-receipt";
import {
  DRIVE_ATTEMPT_CAP,
  DRIVE_AUTOMATIC_BATCH,
  DRIVE_MANUAL_BATCH,
  buildDriveReceiptFileName,
  clampDriveError,
  driveFoldersFromReceiptDate,
  safeDriveErrorMessage,
} from "../utils/drive-receipt-copy";
import {
  fetchGoogleAccessToken,
  findDriveFileByReceiptFileId,
  findOrCreateDriveFolder,
  uploadReceiptPhoto,
} from "./google-drive";
import {
  googleDriveSecretValues,
  type GoogleDriveSecrets,
} from "./google-drive-secrets";
import { SafeDriveFailure } from "./safe-drive-failure";

const PENDING_SELECT =
  "id, storage_path, page_number, mime_type, drive_attempts, purchase_receipts!inner(receipt_date, receipt_total, discarded_at, suppliers(name), purchase_receipt_files(id))";

export interface DriveSyncCounts {
  available: boolean;
  synced: number;
  failed: number;
  remaining: number;
}

interface PendingReceiptPage {
  id: string;
  storagePath: string;
  pageNumber: number;
  mimeType: string;
  driveAttempts: number;
  receiptDate: string;
  receiptTotal: number | null;
  supplierName: string | null;
  pageCount: number;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function supplierName(value: unknown): string | null {
  const record = firstRecord(value);
  return record && typeof record.name === "string" ? record.name : null;
}

function parsePendingPage(value: unknown): PendingReceiptPage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const receipt = firstRecord(row.purchase_receipts);
  if (
    typeof row.id !== "string" ||
    typeof row.storage_path !== "string" ||
    typeof row.page_number !== "number" ||
    typeof row.drive_attempts !== "number" ||
    !receipt ||
    typeof receipt.receipt_date !== "string" ||
    receipt.discarded_at
  ) {
    return null;
  }
  const nested = receipt.purchase_receipt_files;
  const pageCount = Array.isArray(nested) && nested.length > 0 ? nested.length : 1;
  const mimeType = typeof row.mime_type === "string" ? row.mime_type : "image/jpeg";
  return {
    id: row.id,
    storagePath: row.storage_path,
    pageNumber: row.page_number,
    mimeType,
    driveAttempts: row.drive_attempts,
    receiptDate: receipt.receipt_date,
    receiptTotal: toNumber(receipt.receipt_total),
    supplierName: supplierName(receipt.suppliers),
    pageCount,
  };
}

async function listPending(
  supabase: SupabaseClient,
  fileIds: string[] | null,
): Promise<PendingReceiptPage[]> {
  let query = supabase
    .from("purchase_receipt_files")
    .select(PENDING_SELECT)
    .is("drive_synced_at", null)
    .is("purchase_receipts.discarded_at", null)
    .order("created_at", { ascending: true });

  if (fileIds) {
    query = query.in("id", fileIds.slice(0, DRIVE_MANUAL_BATCH)).limit(DRIVE_MANUAL_BATCH);
  } else {
    query = query.lt("drive_attempts", DRIVE_ATTEMPT_CAP).limit(DRIVE_AUTOMATIC_BATCH);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data)) {
    throw new SafeDriveFailure("Could not load receipt photos.", "page");
  }
  return data.flatMap((row) => {
    const page = parsePendingPage(row);
    return page ? [page] : [];
  });
}

async function claim(supabase: SupabaseClient, page: PendingReceiptPage): Promise<"claimed" | "lost" | "error"> {
  const { data, error } = await supabase
    .from("purchase_receipt_files")
    .update({ drive_attempts: page.driveAttempts + 1 })
    .eq("id", page.id)
    .eq("drive_attempts", page.driveAttempts)
    .is("drive_synced_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return "error";
  }
  if (!data || typeof data !== "object" || !("id" in data)) {
    return "lost";
  }
  return "claimed";
}

async function markSynced(
  supabase: SupabaseClient,
  fileId: string,
  driveFileId: string,
): Promise<void> {
  const { error } = await supabase
    .from("purchase_receipt_files")
    .update({
      drive_file_id: driveFileId,
      drive_synced_at: new Date().toISOString(),
      drive_error: null,
    })
    .eq("id", fileId);

  if (error) {
    throw new SafeDriveFailure("Could not record the Drive copy.", "page");
  }
}

async function markFailed(
  supabase: SupabaseClient,
  fileId: string,
  message: string,
): Promise<void> {
  await supabase
    .from("purchase_receipt_files")
    .update({ drive_error: clampDriveError(message) })
    .eq("id", fileId);
}

async function countRemaining(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("purchase_receipt_files")
    .select("id, purchase_receipts!inner(id)", { count: "exact", head: true })
    .is("drive_synced_at", null)
    .lt("drive_attempts", DRIVE_ATTEMPT_CAP)
    .is("purchase_receipts.discarded_at", null);

  if (error || typeof count !== "number") {
    return 0;
  }
  return count;
}

function isGlobalDriveFailure(error: unknown): error is SafeDriveFailure {
  return error instanceof SafeDriveFailure && error.scope === "global";
}

async function releaseClaim(supabase: SupabaseClient, page: PendingReceiptPage): Promise<void> {
  await supabase
    .from("purchase_receipt_files")
    .update({ drive_attempts: page.driveAttempts })
    .eq("id", page.id)
    .eq("drive_attempts", page.driveAttempts + 1)
    .is("drive_synced_at", null);
}

async function downloadPhoto(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(PURCHASE_RECEIPT_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new SafeDriveFailure("Could not download the receipt photo.", "page");
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function copyReceiptPagesToDrive(
  supabase: SupabaseClient,
  secrets: GoogleDriveSecrets,
  fileIds: string[] | null,
  callerToken: string,
): Promise<DriveSyncCounts> {
  const pages = await listPending(supabase, fileIds);
  const secretValues = [...googleDriveSecretValues(secrets), callerToken];
  let accessToken: string | null = null;
  const folders = new Map<string, string>();

  async function token(): Promise<string> {
    if (!accessToken) {
      accessToken = await fetchGoogleAccessToken(secrets);
      secretValues.push(accessToken);
    }
    return accessToken;
  }

  async function folder(name: string, parentId: string): Promise<string> {
    const key = `${parentId}/${name}`;
    const cached = folders.get(key);
    if (cached) {
      return cached;
    }
    const id = await findOrCreateDriveFolder(await token(), name, parentId);
    folders.set(key, id);
    return id;
  }

  let synced = 0;
  let failed = 0;

  if (pages.length > 0) {
    try {
      await token();
    } catch {
      return {
        available: false,
        synced: 0,
        failed: 0,
        remaining: await countRemaining(supabase),
      };
    }
  }

  for (const page of pages) {
    try {
      const claimed = await claim(supabase, page);
      if (claimed === "lost") {
        continue;
      }
      if (claimed === "error") {
        failed += 1;
        await markFailed(supabase, page.id, "Could not reserve the receipt photo.");
        continue;
      }

      try {
        const existingId = await findDriveFileByReceiptFileId(await token(), page.id);
        let driveFileId = existingId;
        if (!driveFileId) {
          const foldersFromDate = driveFoldersFromReceiptDate(page.receiptDate);
          if (!foldersFromDate) {
            throw new SafeDriveFailure("The receipt date could not be used for a Drive folder.", "page");
          }
          const yearId = await folder(
            foldersFromDate.year,
            await folder(foldersFromDate.root, "root"),
          );
          const monthId = await folder(foldersFromDate.month, yearId);
          driveFileId = await uploadReceiptPhoto({
            accessToken: await token(),
            folderId: monthId,
            fileName: buildDriveReceiptFileName({
              receiptDate: page.receiptDate,
              supplierName: page.supplierName,
              receiptTotal: page.receiptTotal,
              pageNumber: page.pageNumber,
              pageCount: page.pageCount,
              fileId: page.id,
            }),
            receiptFileId: page.id,
            bytes: await downloadPhoto(supabase, page.storagePath),
            mimeType: page.mimeType,
          });
        }
        await markSynced(supabase, page.id, driveFileId);
        synced += 1;
      } catch (error) {
        const message = safeDriveErrorMessage(error, secretValues);
        if (isGlobalDriveFailure(error)) {
          await releaseClaim(supabase, page);
          failed += 1;
          await markFailed(supabase, page.id, message);
          return {
            available: false,
            synced,
            failed,
            remaining: await countRemaining(supabase),
          };
        }
        failed += 1;
        await markFailed(supabase, page.id, message);
      }
    } catch {
      failed += 1;
    }
  }

  const remaining = await countRemaining(supabase);
  return { available: true, synced, failed, remaining };
}
