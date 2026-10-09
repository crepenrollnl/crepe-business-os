import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const API_KEY = "sk-ant-TEST-SECRET-123";
const USER_TOKEN = "supabase-user-token-MARKER";
const RECEIPT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RECEIPT_ID = "22222222-2222-4222-8222-222222222222";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { GET, POST } from "./route";
import { createAnthropicMessage } from "@/features/purchases/server/anthropic-messages";

interface RecognitionRow {
  id: string;
  receipt_id: string;
  status: string;
  model: string;
  result: unknown;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

interface Memory {
  userValid: boolean;
  role: string;
  receipt: Record<string, unknown> | null;
  recognitions: RecognitionRow[];
  photos: Map<string, Blob>;
  failInsert: boolean;
}

interface Filter {
  op: "eq" | "gt";
  column: string;
  value: unknown;
}

let memory: Memory;
let fetchMock = vi.fn();
let nextId = 0;

function pageFile(pageNumber: number, path: string) {
  return { page_number: pageNumber, storage_path: path, mime_type: "image/jpeg" };
}

function baseReceipt(): Record<string, unknown> {
  return {
    id: RECEIPT_ID,
    supplier_id: "supplier-1",
    receipt_date: "2026-10-05",
    discarded_at: null,
    suppliers: { name: "Sligro" },
    // Out of order on purpose: the core must send pages in page order.
    purchase_receipt_files: [pageFile(2, "r/page-2.jpg"), pageFile(1, "r/page-1.jpg")],
  };
}

function storedResult() {
  return {
    schemaVersion: 1,
    readable: true,
    storeName: "Sligro",
    receiptDate: "2026-10-05",
    currency: "EUR",
    total: 2.58,
    lines: [
      { text: "Melk", quantity: 2, unitPrice: 1.29, lineTotal: 2.58, vatRate: 9, kind: "item" },
    ],
  };
}

function modelJson(): string {
  return JSON.stringify({
    readable: true,
    store_name: "Sligro",
    receipt_date: "2026-10-05",
    currency: "EUR",
    total: 3.5,
    lines: [
      {
        text: " KIPFILET ",
        quantity: 0.5124,
        unit_price: 6.999,
        line_total: 3.5,
        vat_rate: 9,
        kind: "ITEM",
      },
    ],
  });
}

function recognitionRow(overrides: Partial<RecognitionRow>): RecognitionRow {
  nextId += 1;
  return {
    id: `recognition-${nextId}`,
    receipt_id: RECEIPT_ID,
    status: "failed",
    model: "claude-sonnet-5-5",
    result: null,
    error: "The receipt could not be read.",
    input_tokens: null,
    output_tokens: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function matches(row: RecognitionRow, filters: Filter[]): boolean {
  return filters.every((filter) => {
    const value = row[filter.column as keyof RecognitionRow];
    if (filter.op === "eq") {
      return value === filter.value;
    }
    return typeof value === "string" && value > String(filter.value);
  });
}

function queryBuilder(table: string) {
  const filters: Filter[] = [];
  let head = false;
  let inserted: Record<string, unknown> | null = null;

  const resolveMany = () => {
    if (table === "purchase_receipt_recognitions") {
      const rows = memory.recognitions.filter((row) => matches(row, filters));
      return { data: head ? null : rows, count: rows.length, error: null };
    }
    return { data: [], count: 0, error: null };
  };

  const resolveOne = () => {
    if (inserted) {
      if (memory.failInsert) {
        return { data: null, error: { message: "insert failed" } };
      }
      nextId += 1;
      const row: RecognitionRow = {
        id: `recognition-${nextId}`,
        created_at: new Date().toISOString(),
        receipt_id: String(inserted.receipt_id),
        status: String(inserted.status),
        model: String(inserted.model),
        result: inserted.result,
        error: typeof inserted.error === "string" ? inserted.error : null,
        input_tokens: typeof inserted.input_tokens === "number" ? inserted.input_tokens : null,
        output_tokens: typeof inserted.output_tokens === "number" ? inserted.output_tokens : null,
      };
      memory.recognitions.push(row);
      return { data: { id: row.id }, error: null };
    }
    if (table === "purchase_receipts") {
      const idFilter = filters.find((filter) => filter.column === "id");
      const receipt = memory.receipt;
      return { data: receipt && receipt.id === idFilter?.value ? receipt : null, error: null };
    }
    const rows = memory.recognitions
      .filter((row) => matches(row, filters))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    return { data: rows[0] ?? null, error: null };
  };

  const api = {
    select: (_columns?: string, options?: { head?: boolean }) => {
      head = options?.head === true;
      return api;
    },
    insert: (row: Record<string, unknown>) => {
      inserted = row;
      return api;
    },
    eq: (column: string, value: unknown) => {
      filters.push({ op: "eq", column, value });
      return api;
    },
    gt: (column: string, value: unknown) => {
      filters.push({ op: "gt", column, value });
      return api;
    },
    order: () => api,
    limit: () => api,
    maybeSingle: async () => resolveOne(),
    single: async () => resolveOne(),
    then: (
      resolve: (value: ReturnType<typeof resolveMany>) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolveMany()).then(resolve, reject),
  };
  return api;
}

function fakeClient() {
  return {
    auth: {
      getUser: async () =>
        memory.userValid
          ? { data: { user: { id: "user-1" } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } },
    },
    rpc: async () => ({ data: memory.role, error: null }),
    from: (table: string) => queryBuilder(table),
    storage: {
      from: () => ({
        download: async (path: string) => {
          const blob = memory.photos.get(path);
          return blob ? { data: blob, error: null } : { data: null, error: { message: "missing" } };
        },
      }),
    },
  };
}

function anthropicReply(text: string, stopReason = "end_turn") {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      stop_reason: stopReason,
      usage: { input_tokens: 1234, output_tokens: 321 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function post(body: unknown, token: string | null = USER_TOKEN): Request {
  return new Request("http://localhost/api/purchase-receipts/recognize", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function call(body: unknown = { receiptId: RECEIPT_ID }) {
  const response = await POST(post(body));
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown> };
}

function sentBody(index = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  nextId = 0;
  memory = {
    userValid: true,
    role: "owner",
    receipt: baseReceipt(),
    recognitions: [],
    photos: new Map([
      ["r/page-1.jpg", new Blob(["page-one"], { type: "image/jpeg" })],
      ["r/page-2.jpg", new Blob(["page-two"], { type: "image/jpeg" })],
    ]),
    failInsert: false,
  };
  createClientMock.mockImplementation(() => fakeClient());
  fetchMock = vi.fn(async () => anthropicReply(modelJson()));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
  vi.stubEnv("ANTHROPIC_API_KEY", API_KEY);
  vi.stubEnv("RECEIPT_AI_MODEL", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  createClientMock.mockReset();
});

describe("POST /api/purchase-receipts/recognize — access", () => {
  it("rejects other methods with 405", () => {
    expect(GET().status).toBe(405);
  });

  it("returns 401 without a token", async () => {
    const response = await POST(post({ receiptId: RECEIPT_ID }, null));

    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid session", async () => {
    memory.userValid = false;

    expect((await call()).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a seller", async () => {
    memory.role = "seller";

    expect((await call()).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the client from the publishable key and the caller's token", async () => {
    await call();

    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "publishable-key",
      expect.objectContaining({
        global: { headers: { Authorization: `Bearer ${USER_TOKEN}` } },
      }),
    );
  });

  it.each([
    ["not JSON", "{"],
    ["no receipt id", {}],
    ["a receipt id that is not a uuid", { receiptId: "receipt-1" }],
    ["force that is not boolean", { receiptId: RECEIPT_ID, force: "yes" }],
  ])("returns 400 for %s", async (_name, body) => {
    expect((await call(body)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns configured false and does nothing else without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  ");

    const result = await call();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memory.recognitions).toHaveLength(0);
  });

  it("returns 404 for a discarded receipt", async () => {
    memory.receipt = { ...baseReceipt(), discarded_at: "2026-10-06T10:00:00.000Z" };

    const result = await call();

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: "Receipt not found." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a receipt it cannot see", async () => {
    memory.receipt = null;

    expect((await call()).status).toBe(404);
  });
});

describe("recognizePurchaseReceipt", () => {
  it("returns a stored success without calling Anthropic", async () => {
    memory.recognitions.push(
      recognitionRow({
        id: "old-success",
        status: "succeeded",
        result: storedResult(),
        error: null,
        created_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const result = await call();

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      configured: true,
      cached: true,
      recognitionId: "old-success",
      model: "claude-sonnet-5-5",
      result: storedResult(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the stored success when forced", async () => {
    memory.recognitions.push(
      recognitionRow({ id: "old-success", status: "succeeded", result: storedResult(), error: null }),
    );

    const result = await call({ receiptId: RECEIPT_ID, force: true });

    expect(result.status).toBe(200);
    expect(result.body.cached).toBe(false);
    expect(result.body.recognitionId).not.toBe("old-success");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops at 5 readings of this receipt in 24 hours", async () => {
    for (let index = 0; index < 5; index += 1) {
      memory.recognitions.push(recognitionRow({}));
    }
    memory.recognitions.push(
      recognitionRow({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
    );

    const result = await call();

    expect(result.status).toBe(429);
    expect(result.body).toEqual({
      error:
        "This receipt was read too many times today. Enter the lines by hand or try tomorrow.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts only the last 24 hours for the per-receipt cap", async () => {
    for (let index = 0; index < 4; index += 1) {
      memory.recognitions.push(recognitionRow({}));
    }
    memory.recognitions.push(
      recognitionRow({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }),
    );

    expect((await call()).status).toBe(200);
  });

  it("stops at 100 readings of all receipts in 24 hours", async () => {
    for (let index = 0; index < 100; index += 1) {
      memory.recognitions.push(recognitionRow({ receipt_id: OTHER_RECEIPT_ID }));
    }

    const result = await call();

    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: "Daily limit for reading receipts reached." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when a photo cannot be downloaded", async () => {
    memory.photos.delete("r/page-2.jpg");

    const result = await call();

    expect(result.status).toBe(502);
    expect(result.body).toEqual({ error: "Could not load the receipt photos." });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memory.recognitions).toHaveLength(0);
  });

  it("returns 413 when the photos are over 20 MB as base64", async () => {
    const bigPage = new Uint8Array(8 * 1024 * 1024);
    memory.photos.set("r/page-1.jpg", new Blob([bigPage], { type: "image/jpeg" }));
    memory.photos.set("r/page-2.jpg", new Blob([bigPage], { type: "image/jpeg" }));

    const result = await call();

    expect(result.status).toBe(413);
    expect(result.body).toEqual({ error: "Receipt photos are too large to read." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the photos once and stores the normalized success", async () => {
    const result = await call();

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = sentBody();
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBe(4096);
    expect(typeof body.system).toBe("string");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toEqual([
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: Buffer.from("page-one").toString("base64"),
        },
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: Buffer.from("page-two").toString("base64"),
        },
      },
      {
        type: "text",
        text: "Supplier chosen in the app: Sligro. Receipt date entered in the app: 2026-10-05. The photos are 2 page(s) of one receipt, in order.",
      },
    ]);

    const normalized = {
      schemaVersion: 1,
      readable: true,
      storeName: "Sligro",
      receiptDate: "2026-10-05",
      currency: "EUR",
      total: 3.5,
      lines: [
        {
          text: "KIPFILET",
          quantity: 0.512,
          unitPrice: 7,
          lineTotal: 3.5,
          vatRate: 9,
          kind: "item",
        },
      ],
    };
    expect(memory.recognitions).toHaveLength(1);
    expect(memory.recognitions[0]).toMatchObject({
      receipt_id: RECEIPT_ID,
      status: "succeeded",
      model: "claude-sonnet-5-5",
      result: normalized,
      error: null,
      input_tokens: 1234,
      output_tokens: 321,
    });
    expect(result.body).toEqual({
      configured: true,
      cached: false,
      recognitionId: memory.recognitions[0]?.id,
      model: "claude-sonnet-5-5",
      result: normalized,
    });
  });

  it("uses a valid RECEIPT_AI_MODEL and ignores an unsafe one", async () => {
    vi.stubEnv("RECEIPT_AI_MODEL", " claude-opus-5-5 ");
    await call();
    expect(sentBody(0).model).toBe("claude-opus-5-5");

    vi.stubEnv("RECEIPT_AI_MODEL", "Claude Opus; drop");
    await call({ receiptId: RECEIPT_ID, force: true });
    expect(sentBody(1).model).toBe("claude-sonnet-5-5");
  });

  it("stores a failed row and returns 502 when the answer is cut off", async () => {
    fetchMock.mockImplementation(async () => anthropicReply(modelJson(), "max_tokens"));

    const result = await call();

    expect(result.status).toBe(502);
    expect(result.body).toEqual({
      error: "The receipt could not be read. Try again or enter the lines by hand.",
    });
    expect(memory.recognitions).toHaveLength(1);
    expect(memory.recognitions[0]).toMatchObject({
      status: "failed",
      result: null,
      error: "The receipt could not be read.",
      input_tokens: 1234,
      output_tokens: 321,
    });
  });

  it("stores a failed row and returns 502 for invalid JSON", async () => {
    fetchMock.mockImplementation(async () => anthropicReply("not json {"));

    const result = await call();

    expect(result.status).toBe(502);
    expect(memory.recognitions).toHaveLength(1);
    expect(memory.recognitions[0]?.status).toBe("failed");
  });

  it("stores a failed row and returns 502 when the JSON breaks a rule", async () => {
    fetchMock.mockImplementation(async () =>
      anthropicReply(JSON.stringify({ readable: true, lines: [] })),
    );

    expect((await call()).status).toBe(502);
    expect(memory.recognitions[0]?.status).toBe("failed");
  });

  it("stores a failed row without tokens for another Anthropic error", async () => {
    fetchMock.mockImplementation(async () => new Response("{}", { status: 400 }));

    expect((await call()).status).toBe(502);
    expect(memory.recognitions).toHaveLength(1);
    expect(memory.recognitions[0]).toMatchObject({
      status: "failed",
      input_tokens: null,
      output_tokens: null,
    });
  });

  it.each([
    [401, "Receipt reading is not available right now."],
    [403, "Receipt reading is not available right now."],
    [429, "Receipt reading is busy. Try again in a minute."],
    [529, "Receipt reading is busy. Try again in a minute."],
    [500, "Receipt reading is busy. Try again in a minute."],
  ])("returns 503 and stores nothing for Anthropic %i", async (status, message) => {
    fetchMock.mockImplementation(async () => new Response("{}", { status }));

    const result = await call();

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: message });
    expect(memory.recognitions).toHaveLength(0);
  });

  it("returns 503 and stores nothing on a network failure", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });

    expect((await call()).status).toBe(503);
    expect(memory.recognitions).toHaveLength(0);
  });

  it("aborts after 50 seconds and returns 503 without a row", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fetchStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      fetchStarted = resolve;
    });
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
          fetchStarted();
        }),
    );

    const pending = call();
    await started;
    await vi.advanceTimersByTimeAsync(49_999);
    expect(memory.recognitions).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: "Receipt reading is busy. Try again in a minute." });
    expect(memory.recognitions).toHaveLength(0);
  });

  it("returns a safe 500 when the row cannot be stored", async () => {
    memory.failInsert = true;

    const result = await call();

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "Receipt reading failed. Try again." });
  });
});

describe("secrets", () => {
  it("never puts the API key in a response, a stored row, or an error", async () => {
    const texts: string[] = [];

    texts.push((await call()).text);

    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: `invalid x-api-key ${API_KEY}` } }), {
          status: 401,
        }),
    );
    texts.push((await call({ receiptId: RECEIPT_ID, force: true })).text);

    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: `bad request for ${API_KEY}` } }), {
          status: 400,
        }),
    );
    texts.push((await call({ receiptId: RECEIPT_ID, force: true })).text);

    fetchMock.mockImplementation(async () =>
      anthropicReply(`{"readable": "${API_KEY}"}`),
    );
    texts.push((await call({ receiptId: RECEIPT_ID, force: true })).text);

    for (const status of [401, 400, 529]) {
      fetchMock.mockImplementation(
        async () => new Response(`echo ${API_KEY}`, { status }),
      );
      try {
        await createAnthropicMessage({
          apiKey: API_KEY,
          model: "claude-sonnet-5-5",
          system: "s",
          images: [],
          text: "t",
          schema: {},
        });
      } catch (error) {
        texts.push(error instanceof Error ? `${error.name} ${error.message} ${String(error.stack)}` : String(error));
      }
    }

    texts.push(JSON.stringify(memory.recognitions));
    expect(texts.length).toBeGreaterThan(5);
    for (const text of texts) {
      expect(text).not.toContain(API_KEY);
    }
  });
});
