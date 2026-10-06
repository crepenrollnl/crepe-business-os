import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDriveReceiptSync } from "./request-drive-receipt-sync";

describe("requestDriveReceiptSync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when fetch is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );

    await expect(
      requestDriveReceiptSync(() => Promise.resolve("token")),
    ).resolves.toBeNull();
  });

  it("returns null when the body cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      })),
    );

    await expect(
      requestDriveReceiptSync(() => Promise.resolve("token")),
    ).resolves.toBeNull();
  });
});
