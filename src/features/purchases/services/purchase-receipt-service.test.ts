import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, uploadMock, createSignedUrlsMock, getPublicUrlMock } = vi.hoisted(
  () => ({
    supabaseMock: {
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {
        from: vi.fn(),
      },
    },
    uploadMock: vi.fn(),
    createSignedUrlsMock: vi.fn(),
    getPublicUrlMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { purchaseReceiptService } from "./purchase-receipt-service";

const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID_2 = "33333333-3333-4333-8333-333333333333";

interface QueryChain {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (
    resolve: (value: { data?: unknown; error?: unknown; count?: number | null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
}

function chain(result: { data?: unknown; error?: unknown; count?: number | null }): QueryChain {
  const api: QueryChain = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    maybeSingle: vi.fn(async () => result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  const self = () => api;
  api.select.mockImplementation(self);
  api.insert.mockImplementation(self);
  api.update.mockImplementation(self);
  api.eq.mockImplementation(self);
  api.is.mockImplementation(self);
  api.gte.mockImplementation(self);
  api.order.mockImplementation(self);
  return api;
}

describe("purchaseReceiptService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    uploadMock.mockReset();
    createSignedUrlsMock.mockReset();
    getPublicUrlMock.mockReset();
    supabaseMock.from.mockReset();
    supabaseMock.rpc.mockReset();
    supabaseMock.storage.from.mockReset();
    supabaseMock.storage.from.mockReturnValue({
      upload: uploadMock,
      createSignedUrls: createSignedUrlsMock,
      getPublicUrl: getPublicUrlMock,
    });
    createSignedUrlsMock.mockResolvedValue({
      data: [{ path: "receipt/page.jpg", signedUrl: "https://signed.example/photo", error: null }],
      error: null,
    });
    const ids = [RECEIPT_ID, FILE_ID, FILE_ID_2];
    let index = 0;
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      () => (ids[index++] ?? RECEIPT_ID) as ReturnType<typeof crypto.randomUUID>,
    );
  });

  it("returns the upload error and does not call the RPC", async () => {
    uploadMock.mockResolvedValue({ error: { message: "bucket is full" } });

    const result = await purchaseReceiptService.save({
      receiptDate: "2026-10-05",
      supplierId: null,
      receiptTotal: null,
      note: null,
      pages: [{ blob: new Blob(["a"]), originalFilename: "a.jpg" }],
    });

    expect(result.error).toBe("bucket is full");
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(getPublicUrlMock).not.toHaveBeenCalled();
  });

  it("returns the RPC error verbatim after a successful upload", async () => {
    uploadMock.mockResolvedValue({ error: null });
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Receipt photo was not uploaded. Try again." },
    });

    const result = await purchaseReceiptService.save({
      receiptDate: "2026-10-05",
      supplierId: null,
      receiptTotal: 37.13,
      note: "note",
      pages: [{ blob: new Blob(["a"]), originalFilename: "a.jpg" }],
    });

    expect(result.error).toBe("Receipt photo was not uploaded. Try again.");
    expect(uploadMock).toHaveBeenCalledWith(
      `${RECEIPT_ID}/${FILE_ID}.jpg`,
      expect.any(Blob),
      { contentType: "image/jpeg", upsert: false },
    );
  });

  it("uploads pages in order and calls create_purchase_receipt", async () => {
    uploadMock.mockResolvedValue({ error: null });
    supabaseMock.rpc.mockResolvedValue({ data: RECEIPT_ID, error: null });
    const first = new Blob(["a"]);
    const second = new Blob(["b"]);

    const result = await purchaseReceiptService.save({
      receiptDate: "2026-10-05",
      supplierId: "supplier-1",
      receiptTotal: null,
      note: null,
      pages: [
        { blob: first, originalFilename: "a.jpg" },
        { blob: second, originalFilename: null },
      ],
    });

    expect(result).toEqual({ data: RECEIPT_ID, error: null });
    expect(supabaseMock.storage.from).toHaveBeenCalledWith("purchase-receipts");
    expect(supabaseMock.rpc).toHaveBeenCalledWith("create_purchase_receipt", {
      p_receipt_id: RECEIPT_ID,
      p_receipt_date: "2026-10-05",
      p_supplier_id: "supplier-1",
      p_receipt_total: null,
      p_note: null,
      p_files: [
        {
          storage_path: `${RECEIPT_ID}/${FILE_ID}.jpg`,
          mime_type: "image/jpeg",
          size_bytes: first.size,
          original_filename: "a.jpg",
        },
        {
          storage_path: `${RECEIPT_ID}/${FILE_ID_2}.jpg`,
          mime_type: "image/jpeg",
          size_bytes: second.size,
          original_filename: null,
        },
      ],
    });
    expect(getPublicUrlMock).not.toHaveBeenCalled();
  });

  it("loads a thumbnail with createSignedUrl and never getPublicUrl", async () => {
    const api = chain({
      data: [
        {
          id: RECEIPT_ID,
          purchase_id: null,
          supplier_id: null,
          receipt_date: "2026-10-05",
          receipt_total: null,
          note: null,
          created_at: "2026-10-05T10:00:00.000Z",
          suppliers: null,
          purchase_receipt_files: [
            { page_number: 1, storage_path: "receipt/page.jpg" },
          ],
        },
      ],
      error: null,
    });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.listUnassigned();

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.thumbnailUrl).toBe("https://signed.example/photo");
    expect(createSignedUrlsMock).toHaveBeenCalledWith(["receipt/page.jpg"], 3600);
    expect(getPublicUrlMock).not.toHaveBeenCalled();
    expect(api.is).toHaveBeenCalledWith("purchase_id", null);
    expect(api.is).toHaveBeenCalledWith("discarded_at", null);
  });

  it("signs every thumbnail in one call and keeps a failed path as a null thumbnail", async () => {
    createSignedUrlsMock.mockResolvedValue({
      data: [
        { path: "a.jpg", signedUrl: "https://signed.example/a", error: null },
        { path: "b.jpg", signedUrl: null, error: "Object not found" },
      ],
      error: null,
    });
    const api = chain({
      data: [
        {
          id: RECEIPT_ID,
          purchase_id: null,
          supplier_id: null,
          receipt_date: "2026-10-05",
          receipt_total: null,
          note: null,
          created_at: "2026-10-05T10:00:00.000Z",
          suppliers: null,
          purchase_receipt_files: [{ page_number: 1, storage_path: "a.jpg" }],
        },
        {
          id: FILE_ID,
          purchase_id: null,
          supplier_id: null,
          receipt_date: "2026-10-04",
          receipt_total: null,
          note: null,
          created_at: "2026-10-04T10:00:00.000Z",
          suppliers: null,
          purchase_receipt_files: [{ page_number: 1, storage_path: "b.jpg" }],
        },
      ],
      error: null,
    });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.listUnassigned();

    expect(result.error).toBeNull();
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock).toHaveBeenCalledWith(["a.jpg", "b.jpg"], 3600);
    expect(result.data?.map((card) => card.thumbnailUrl)).toEqual([
      "https://signed.example/a",
      null,
    ]);
    expect(getPublicUrlMock).not.toHaveBeenCalled();
  });

  it("discards with only discarded_at and refuses a linked receipt", async () => {
    const api = chain({ data: { id: RECEIPT_ID }, error: null });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.discard(RECEIPT_ID);

    expect(result).toEqual({ data: true, error: null });
    const payload = api.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["discarded_at"]);
    expect(typeof payload.discarded_at).toBe("string");
    expect(api.is).toHaveBeenCalledWith("purchase_id", null);

    const empty = chain({ data: null, error: null });
    supabaseMock.from.mockReturnValue(empty);
    const refused = await purchaseReceiptService.discard(RECEIPT_ID);
    expect(refused.error).toBe("Only an unassigned receipt can be discarded.");
  });

  it("updates only supplier, date, total, and note", async () => {
    const api = chain({
      data: {
        id: RECEIPT_ID,
        purchase_id: null,
        supplier_id: null,
        receipt_date: "2026-10-06",
        receipt_total: 37.13,
        note: "hello",
        created_at: "2026-10-05T10:00:00.000Z",
        suppliers: null,
        purchase_receipt_files: [],
      },
      error: null,
    });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.update(RECEIPT_ID, {
      supplierId: null,
      receiptDate: "2026-10-06",
      receiptTotal: 37.13,
      note: "hello",
    });

    expect(result.error).toBeNull();
    expect(api.update).toHaveBeenCalledWith({
      supplier_id: null,
      receipt_date: "2026-10-06",
      receipt_total: 37.13,
      note: "hello",
    });
    const payload = api.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("discarded_at");
    expect(payload).not.toHaveProperty("created_by");
    expect(payload).not.toHaveProperty("storage_path");
  });

  it("links and unlinks with a payload of only purchase_id", async () => {
    const api = chain({ data: { id: RECEIPT_ID }, error: null });
    supabaseMock.from.mockReturnValue(api);

    const linked = await purchaseReceiptService.linkToPurchase(RECEIPT_ID, "purchase-1");

    expect(linked).toEqual({ data: true, error: null });
    const linkPayload = api.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(linkPayload)).toEqual(["purchase_id"]);
    expect(linkPayload.purchase_id).toBe("purchase-1");
    expect(api.is).toHaveBeenCalledWith("purchase_id", null);
    expect(api.is).toHaveBeenCalledWith("discarded_at", null);

    const unlinkApi = chain({ data: { id: RECEIPT_ID }, error: null });
    supabaseMock.from.mockReturnValue(unlinkApi);
    const unlinked = await purchaseReceiptService.unlinkFromPurchase(RECEIPT_ID, "purchase-1");

    expect(unlinked).toEqual({ data: true, error: null });
    const unlinkPayload = unlinkApi.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(unlinkPayload)).toEqual(["purchase_id"]);
    expect(unlinkPayload.purchase_id).toBeNull();
    expect(unlinkApi.eq).toHaveBeenCalledWith("purchase_id", "purchase-1");
  });

  it("returns the unassigned message when the link updates zero rows", async () => {
    const api = chain({ data: null, error: null });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.linkToPurchase(RECEIPT_ID, "purchase-1");

    expect(result.error).toBe("This receipt is no longer unassigned.");
  });

  it("reads drive copy columns onto the card and still batches signed urls", async () => {
    const api = chain({
      data: [
        {
          id: RECEIPT_ID,
          purchase_id: null,
          supplier_id: null,
          receipt_date: "2026-10-05",
          receipt_total: null,
          note: null,
          created_at: "2026-10-05T10:00:00.000Z",
          suppliers: null,
          purchase_receipt_files: [
            {
              id: FILE_ID,
              page_number: 1,
              storage_path: "receipt/page.jpg",
              drive_synced_at: null,
              drive_error: "Could not reach Google Drive.",
            },
          ],
        },
      ],
      error: null,
    });
    supabaseMock.from.mockReturnValue(api);

    const result = await purchaseReceiptService.listUnassigned();

    expect(result.data?.[0]?.files).toEqual([
      {
        id: FILE_ID,
        driveSyncedAt: null,
        driveError: "Could not reach Google Drive.",
      },
    ]);
    expect(api.select).toHaveBeenCalledWith(expect.stringContaining("drive_synced_at"));
    expect(api.select).toHaveBeenCalledWith(expect.stringContaining("drive_error"));
    expect(createSignedUrlsMock).toHaveBeenCalledWith(["receipt/page.jpg"], 3600);
  });
});
