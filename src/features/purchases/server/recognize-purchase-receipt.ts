import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PURCHASE_RECEIPT_BUCKET } from "../types/purchase-receipt";
import type { ReceiptRecognitionResult } from "../types/receipt-recognition";
import {
  RECEIPT_JSON_SCHEMA,
  parseReceiptRecognition,
  parseStoredReceiptRecognition,
} from "../utils/receipt-recognition-result";
import {
  SafeAiFailure,
  createAnthropicMessage,
  type AnthropicImage,
  type AnthropicMessageResponse,
  type AnthropicUsage,
} from "./anthropic-messages";
import type { ReceiptAiConfig } from "./receipt-ai-config";

export const RECEIPT_PROMPT = `You read photos of shop receipts from Dutch supermarkets and wholesalers. The buyer is a food truck. Extract only what is printed; never invent items.
- One entry in lines per printed purchase line, top to bottom, across all photos. The photos are pages of one receipt in order; do not repeat a line that appears on two overlapping photos.
- text: the product text exactly as printed, abbreviations kept, without the price.
- quantity: the count or the weight in kg when printed ("2 x 1,29" → 2, "0,512 kg" → 0.512); null when not printed.
- unit_price: price per unit or per kg when printed, else null.
- line_total: the amount printed for the line, in euros (decimal comma → number).
- kind: discount for KORTING / BONUS / ACTIE / VOORDEEL lines (negative line_total); deposit for STATIEGELD / EMBALLAGE; bag for TAS / DRAAGTAS; other for non-product lines that still carry an amount; item otherwise. Never put subtotal, total, payment, change, VAT summary or loyalty lines in lines.
- vat_rate: the line's VAT percentage from its BTW code and the receipt's BTW legend (usually 9 or 21); null when unclear.
- total: the amount to pay (TOTAAL / TE BETALEN), else null.
- receipt_date as YYYY-MM-DD, store_name as printed in the header, currency "EUR" for euros; null when not printed.
- readable false and lines [] if it is not a receipt or too blurry.`;

export const RECEIPT_NOT_FOUND = "Receipt not found.";
export const RECEIPT_READ_TOO_OFTEN =
  "This receipt was read too many times today. Enter the lines by hand or try tomorrow.";
export const DAILY_READ_LIMIT = "Daily limit for reading receipts reached.";
export const PHOTOS_NOT_LOADED = "Could not load the receipt photos.";
export const PHOTOS_TOO_LARGE = "Receipt photos are too large to read.";
export const READING_UNAVAILABLE = "Receipt reading is not available right now.";
export const READING_BUSY = "Receipt reading is busy. Try again in a minute.";
export const RECEIPT_UNREADABLE =
  "The receipt could not be read. Try again or enter the lines by hand.";
export const READING_FAILED = "Receipt reading failed. Try again.";

/** Stored on failed rows; short and free of external text. */
const STORED_FAILURE = "The receipt could not be read.";

export const PER_RECEIPT_DAILY_CAP = 5;
export const GLOBAL_DAILY_CAP = 100;
export const MAX_BASE64_BYTES = 20 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECOGNITIONS_TABLE = "purchase_receipt_recognitions";
const RECEIPT_SELECT =
  "id, supplier_id, receipt_date, discarded_at, suppliers(name), purchase_receipt_files(page_number, storage_path, mime_type)";
const IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export type RecognizeOutcome =
  | {
      ok: true;
      cached: boolean;
      recognitionId: string;
      model: string;
      result: ReceiptRecognitionResult;
    }
  | { ok: false; status: number; error: string };

interface ReceiptPage {
  pageNumber: number;
  storagePath: string;
  mimeType: string | null;
}

interface LoadedReceipt {
  supplierName: string | null;
  receiptDate: string;
  pages: ReceiptPage[];
}

function failure(status: number, error: string): RecognizeOutcome {
  return { ok: false, status, error };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function supplierName(value: unknown): string | null {
  const record = Array.isArray(value) ? asRecord(value[0]) : asRecord(value);
  return record && typeof record.name === "string" ? record.name : null;
}

function parsePage(value: unknown): ReceiptPage | null {
  const row = asRecord(value);
  if (!row || typeof row.page_number !== "number" || typeof row.storage_path !== "string") {
    return null;
  }
  return {
    pageNumber: row.page_number,
    storagePath: row.storage_path,
    mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
  };
}

async function loadReceipt(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<LoadedReceipt | null> {
  const { data, error } = await supabase
    .from("purchase_receipts")
    .select(RECEIPT_SELECT)
    .eq("id", receiptId)
    .order("page_number", { foreignTable: "purchase_receipt_files", ascending: true })
    .maybeSingle();
  if (error) {
    throw new Error("receipt query failed");
  }
  const row = asRecord(data);
  if (!row || typeof row.receipt_date !== "string" || row.discarded_at !== null) {
    return null;
  }
  const files = Array.isArray(row.purchase_receipt_files) ? row.purchase_receipt_files : [];
  const pages = files
    .map(parsePage)
    .filter((page): page is ReceiptPage => page !== null)
    .sort((left, right) => left.pageNumber - right.pageNumber);
  return {
    supplierName: supplierName(row.suppliers),
    receiptDate: row.receipt_date,
    pages,
  };
}

async function findCachedRecognition(
  supabase: SupabaseClient,
  receiptId: string,
): Promise<RecognizeOutcome | null> {
  const { data, error } = await supabase
    .from(RECOGNITIONS_TABLE)
    .select("id, model, result")
    .eq("receipt_id", receiptId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("recognition query failed");
  }
  const row = asRecord(data);
  if (!row || typeof row.id !== "string" || typeof row.model !== "string") {
    return null;
  }
  const result = parseStoredReceiptRecognition(row.result);
  if (!result) {
    return null;
  }
  return { ok: true, cached: true, recognitionId: row.id, model: row.model, result };
}

async function countRecentRecognitions(
  supabase: SupabaseClient,
  since: string,
  receiptId: string | null,
): Promise<number> {
  let query = supabase
    .from(RECOGNITIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .gt("created_at", since);
  if (receiptId) {
    query = query.eq("receipt_id", receiptId);
  }
  const { count, error } = await query;
  if (error) {
    throw new Error("recognition count failed");
  }
  return count ?? 0;
}

type PhotoLoad = { images: AnthropicImage[] } | { error: RecognizeOutcome };

async function loadPhotos(
  supabase: SupabaseClient,
  pages: ReceiptPage[],
): Promise<PhotoLoad> {
  if (pages.length === 0) {
    return { error: failure(502, PHOTOS_NOT_LOADED) };
  }
  const images: AnthropicImage[] = [];
  let totalBytes = 0;
  for (const page of pages) {
    let blob: Blob | null = null;
    try {
      const { data, error } = await supabase.storage
        .from(PURCHASE_RECEIPT_BUCKET)
        .download(page.storagePath);
      blob = error ? null : data;
    } catch {
      blob = null;
    }
    if (!blob) {
      return { error: failure(502, PHOTOS_NOT_LOADED) };
    }
    const mediaType = [page.mimeType, blob.type].find(
      (candidate): candidate is string =>
        typeof candidate === "string" && IMAGE_MEDIA_TYPES.has(candidate),
    );
    if (!mediaType) {
      return { error: failure(502, PHOTOS_NOT_LOADED) };
    }
    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    totalBytes += base64.length;
    if (totalBytes > MAX_BASE64_BYTES) {
      return { error: failure(413, PHOTOS_TOO_LARGE) };
    }
    images.push({ mediaType, base64 });
  }
  return { images };
}

function contextText(receipt: LoadedReceipt, pageCount: number): string {
  const supplier = receipt.supplierName?.trim() ? receipt.supplierName.trim() : "unknown";
  return `Supplier chosen in the app: ${supplier}. Receipt date entered in the app: ${receipt.receiptDate}. The photos are ${pageCount} page(s) of one receipt, in order.`;
}

function parseModelText(text: string | null): ReceiptRecognitionResult | null {
  if (text === null) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  return parseReceiptRecognition(json);
}

async function insertRecognition(
  supabase: SupabaseClient,
  row: {
    receipt_id: string;
    status: "succeeded" | "failed";
    model: string;
    result: ReceiptRecognitionResult | null;
    error: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from(RECOGNITIONS_TABLE)
    .insert(row)
    .select("id")
    .single();
  const inserted = asRecord(data);
  if (error || !inserted || typeof inserted.id !== "string") {
    return null;
  }
  return inserted.id;
}

async function storeFailure(
  supabase: SupabaseClient,
  receiptId: string,
  model: string,
  usage: AnthropicUsage,
): Promise<RecognizeOutcome> {
  const id = await insertRecognition(supabase, {
    receipt_id: receiptId,
    status: "failed",
    model,
    result: null,
    error: STORED_FAILURE,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });
  return id ? failure(502, RECEIPT_UNREADABLE) : failure(500, READING_FAILED);
}

/**
 * Reads a receipt's photos with Claude under the caller's own Supabase session
 * (RLS applies). Reuses a stored success unless forced; failed readings are
 * stored, unavailable/busy outcomes are not.
 */
export async function recognizePurchaseReceipt(
  supabase: SupabaseClient,
  config: ReceiptAiConfig,
  receiptId: string,
  force: boolean,
): Promise<RecognizeOutcome> {
  const receipt = await loadReceipt(supabase, receiptId);
  if (!receipt) {
    return failure(404, RECEIPT_NOT_FOUND);
  }

  if (!force) {
    const cached = await findCachedRecognition(supabase, receiptId);
    if (cached) {
      return cached;
    }
  }

  const since = new Date(Date.now() - DAY_MS).toISOString();
  if ((await countRecentRecognitions(supabase, since, receiptId)) >= PER_RECEIPT_DAILY_CAP) {
    return failure(429, RECEIPT_READ_TOO_OFTEN);
  }
  if ((await countRecentRecognitions(supabase, since, null)) >= GLOBAL_DAILY_CAP) {
    return failure(429, DAILY_READ_LIMIT);
  }

  const photos = await loadPhotos(supabase, receipt.pages);
  if ("error" in photos) {
    return photos.error;
  }

  let message: AnthropicMessageResponse;
  try {
    message = await createAnthropicMessage({
      apiKey: config.apiKey,
      model: config.model,
      system: RECEIPT_PROMPT,
      images: photos.images,
      text: contextText(receipt, photos.images.length),
      schema: RECEIPT_JSON_SCHEMA,
    });
  } catch (error) {
    if (!(error instanceof SafeAiFailure)) {
      throw error;
    }
    if (error.kind === "unavailable") {
      return failure(503, READING_UNAVAILABLE);
    }
    if (error.kind === "busy") {
      return failure(503, READING_BUSY);
    }
    return storeFailure(supabase, receiptId, config.model, {
      inputTokens: null,
      outputTokens: null,
    });
  }

  const result = message.stopReason === "end_turn" ? parseModelText(message.text) : null;
  if (!result) {
    return storeFailure(supabase, receiptId, config.model, message.usage);
  }

  const recognitionId = await insertRecognition(supabase, {
    receipt_id: receiptId,
    status: "succeeded",
    model: config.model,
    result,
    error: null,
    input_tokens: message.usage.inputTokens,
    output_tokens: message.usage.outputTokens,
  });
  if (!recognitionId) {
    return failure(500, READING_FAILED);
  }
  return { ok: true, cached: false, recognitionId, model: config.model, result };
}
