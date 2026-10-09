import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));

vi.mock("./purchase-receipt-access-token", () => ({
  getPurchaseReceiptAccessToken: () => getToken(),
}));

import { requestReceiptRecognition } from "./request-receipt-recognition";

const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";

const RESULT = {
  schemaVersion: 1,
  readable: true,
  storeName: "Sligro",
  receiptDate: "2026-10-05",
  currency: "EUR",
  total: 2.58,
  lines: [
    {
      text: "Melk",
      quantity: 2,
      unitPrice: 1.29,
      lineTotal: 2.58,
      vatRate: 9,
      kind: "item",
    },
  ],
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe("requestReceiptRecognition", () => {
  beforeEach(() => {
    getToken.mockResolvedValue("token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    getToken.mockReset();
  });

  it("never throws when fetch is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toEqual({
      status: "error",
      message: "Receipt reading failed. Try again.",
    });
  });

  it("never throws when the token lookup fails or the body is not JSON", async () => {
    getToken.mockRejectedValueOnce(new Error("no session"));
    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toMatchObject({
      status: "error",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: () => Promise.reject(new Error("bad")) })),
    );
    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toMatchObject({
      status: "error",
    });
  });

  it("does not call the server without a token", async () => {
    const fetchMock = respond(200, { configured: false });
    vi.stubGlobal("fetch", fetchMock);
    getToken.mockResolvedValue(null);

    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toMatchObject({
      status: "error",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports not_configured", async () => {
    vi.stubGlobal("fetch", respond(200, { configured: false }));

    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toEqual({
      status: "not_configured",
    });
  });

  it("returns the result and sends the token and force flag", async () => {
    const fetchMock = respond(200, {
      configured: true,
      cached: false,
      recognitionId: "recognition-1",
      model: "claude-sonnet-5-5",
      result: RESULT,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestReceiptRecognition(RECEIPT_ID, { force: true })).resolves.toEqual({
      status: "ok",
      cached: false,
      recognitionId: "recognition-1",
      result: RESULT,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/purchase-receipts/recognize", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ receiptId: RECEIPT_ID, force: true }),
    });
  });

  it("passes the server's safe message on an error status", async () => {
    vi.stubGlobal(
      "fetch",
      respond(429, { error: "Daily limit for reading receipts reached." }),
    );

    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toEqual({
      status: "error",
      message: "Daily limit for reading receipts reached.",
    });
  });

  it("treats a malformed success body as an error", async () => {
    vi.stubGlobal(
      "fetch",
      respond(200, { configured: true, cached: false, recognitionId: "r", result: { lines: [] } }),
    );

    await expect(requestReceiptRecognition(RECEIPT_ID)).resolves.toMatchObject({
      status: "error",
    });
  });
});
