import type { ReceiptRecognitionRequestResult } from "../types/receipt-recognition";
import { getPurchaseReceiptAccessToken } from "./purchase-receipt-access-token";
import { parseStoredReceiptRecognition } from "./receipt-recognition-result";

const GENERIC_FAILURE = "Receipt reading failed. Try again.";
const MAX_MESSAGE_LENGTH = 200;

function errorResult(message: string = GENERIC_FAILURE): ReceiptRecognitionRequestResult {
  return { status: "error", message };
}

function serverMessage(body: Record<string, unknown> | null): string {
  const message = body?.error;
  return typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= MAX_MESSAGE_LENGTH
    ? message
    : GENERIC_FAILURE;
}

function parseResponse(ok: boolean, value: unknown): ReceiptRecognitionRequestResult {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!ok) {
    return errorResult(serverMessage(body));
  }
  if (body?.configured === false) {
    return { status: "not_configured" };
  }
  const result = parseStoredReceiptRecognition(body?.result);
  if (
    body?.configured !== true ||
    typeof body.cached !== "boolean" ||
    typeof body.recognitionId !== "string" ||
    !result
  ) {
    return errorResult();
  }
  return {
    status: "ok",
    cached: body.cached,
    recognitionId: body.recognitionId,
    result,
  };
}

/** Asks the server to read a receipt's photos. Never throws. */
export async function requestReceiptRecognition(
  receiptId: string,
  options: { force?: boolean } = {},
): Promise<ReceiptRecognitionRequestResult> {
  try {
    const token = await getPurchaseReceiptAccessToken();
    if (!token) {
      return errorResult();
    }

    const response = await fetch("/api/purchase-receipts/recognize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.force ? { receiptId, force: true } : { receiptId }),
    });

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return parseResponse(response.ok, body);
  } catch {
    return errorResult();
  }
}
