import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLIENT_ID = "google-client-id-MARKER";
const CLIENT_SECRET = "google-client-secret-MARKER";
const REFRESH_TOKEN = "google-refresh-token-MARKER";
const ACCESS_TOKEN = "ya29.google-access-MARKER";
const SUPABASE_TOKEN = "supabase-user-token-MARKER";
const SERVICE_ROLE = "service-role-MARKER";
const SECRETS = [CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, SUPABASE_TOKEN];

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

import { GET, POST } from "./route";

interface MemoryFile {
  id: string;
  receiptId: string;
  storagePath: string;
  pageNumber: number;
  mimeType: string;
  driveAttempts: number;
  driveSyncedAt: string | null;
  driveFileId: string | null;
  driveError: string | null;
  createdAt: string;
}

interface MemoryReceipt {
  id: string;
  receiptDate: string;
  receiptTotal: number | null;
  discardedAt: string | null;
  supplierName: string | null;
}

interface Memory {
  role: string;
  files: MemoryFile[];
  receipts: MemoryReceipt[];
  loseClaims: Set<string>;
  existingDriveIds: Map<string, string>;
  failUploadIds: Set<string>;
  uploadStatus: Map<string, number>;
  missingPaths: Set<string>;
  throwGoogle: boolean;
  throwAfterToken: boolean;
}

interface Filter {
  op: "eq" | "is" | "lt" | "in";
  column: string;
  value: unknown;
}

interface Op {
  action: "select" | "update";
  payload: Record<string, unknown> | null;
  filters: Filter[];
  head: boolean;
  limit: number | null;
  applied: boolean;
}

let memory: Memory;
const uploadBodies: string[] = [];
let fetchMock = vi.fn();

function receiptFor(file: MemoryFile): MemoryReceipt | undefined {
  return memory.receipts.find((receipt) => receipt.id === file.receiptId);
}

function matches(file: MemoryFile, filters: Filter[]): boolean {
  const receipt = receiptFor(file);
  return filters.every((filter) => {
    if (filter.op === "eq" && filter.column === "id") {
      return file.id === filter.value;
    }
    if (filter.op === "eq" && filter.column === "drive_attempts") {
      return file.driveAttempts === filter.value;
    }
    if (filter.op === "is" && filter.column === "drive_synced_at") {
      return file.driveSyncedAt === null;
    }
    if (filter.op === "is" && filter.column === "purchase_receipts.discarded_at") {
      return receipt?.discardedAt === null;
    }
    if (filter.op === "lt" && filter.column === "drive_attempts") {
      return file.driveAttempts < Number(filter.value);
    }
    if (filter.op === "in" && filter.column === "id") {
      return Array.isArray(filter.value) && filter.value.includes(file.id);
    }
    return true;
  });
}

function toRow(file: MemoryFile): Record<string, unknown> {
  const receipt = receiptFor(file);
  const siblings = memory.files.filter((item) => item.receiptId === file.receiptId);
  return {
    id: file.id,
    storage_path: file.storagePath,
    page_number: file.pageNumber,
    mime_type: file.mimeType,
    drive_attempts: file.driveAttempts,
    purchase_receipts: {
      receipt_date: receipt?.receiptDate ?? "",
      receipt_total: receipt?.receiptTotal ?? null,
      discarded_at: receipt?.discardedAt ?? null,
      suppliers: receipt?.supplierName ? { name: receipt.supplierName } : null,
      purchase_receipt_files: siblings.map((item) => ({ id: item.id })),
    },
  };
}

function apply(op: Op): { data: unknown; error: { message: string } | null; count: number | null } {
  if (op.applied) {
    return { data: null, error: null, count: null };
  }
  op.applied = true;
  const matched = memory.files
    .filter((file) => matches(file, op.filters))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const limited = op.limit === null ? matched : matched.slice(0, op.limit);

  if (op.action === "update" && op.payload && "drive_attempts" in op.payload) {
    const file = limited[0];
    if (!file || memory.loseClaims.has(file.id)) {
      return { data: null, error: null, count: null };
    }
    file.driveAttempts = Number(op.payload.drive_attempts);
    return { data: { id: file.id }, error: null, count: null };
  }

  if (op.action === "update" && op.payload && "drive_file_id" in op.payload) {
    for (const file of limited) {
      file.driveFileId = String(op.payload.drive_file_id);
      file.driveSyncedAt = String(op.payload.drive_synced_at);
      file.driveError = null;
    }
    return { data: limited, error: null, count: null };
  }

  if (op.action === "update" && op.payload && "drive_error" in op.payload) {
    for (const file of limited) {
      file.driveError = String(op.payload.drive_error);
    }
    return { data: limited, error: null, count: null };
  }

  if (op.head) {
    return { data: null, error: null, count: limited.length };
  }
  return { data: limited.map(toRow), error: null, count: null };
}

interface DriveResult {
  data: unknown;
  error: { message: string } | null;
  count: number | null;
}

interface DriveChain extends PromiseLike<DriveResult> {
  select: (columns: string, options?: { head?: boolean }) => DriveChain;
  update: (payload: Record<string, unknown>) => DriveChain;
  eq: (column: string, value: unknown) => DriveChain;
  is: (column: string, value: null) => DriveChain;
  lt: (column: string, value: number) => DriveChain;
  in: (column: string, value: string[]) => DriveChain;
  order: () => DriveChain;
  limit: (count: number) => DriveChain;
  maybeSingle: () => Promise<DriveResult>;
}

function chain(): DriveChain {
  const op: Op = {
    action: "select",
    payload: null,
    filters: [],
    head: false,
    limit: null,
    applied: false,
  };
  const api: DriveChain = {
    select(columns: string, options?: { head?: boolean }) {
      void columns;
      op.head = options?.head === true;
      return api;
    },
    update(payload: Record<string, unknown>) {
      op.action = "update";
      op.payload = payload;
      return api;
    },
    eq(column: string, value: unknown) {
      op.filters.push({ op: "eq", column, value });
      return api;
    },
    is(column: string, value: null) {
      op.filters.push({ op: "is", column, value });
      return api;
    },
    lt(column: string, value: number) {
      op.filters.push({ op: "lt", column, value });
      return api;
    },
    in(column: string, value: string[]) {
      op.filters.push({ op: "in", column, value });
      return api;
    },
    order() {
      return api;
    },
    limit(count: number) {
      op.limit = count;
      return api;
    },
    maybeSingle() {
      return Promise.resolve(apply(op));
    },
    then(resolve, reject) {
      return Promise.resolve(apply(op)).then(resolve, reject);
    },
  };
  return api;
}

function installClient(): void {
  createClientMock.mockImplementation(() => ({
    auth: {
      getUser: async (jwt: string) =>
        jwt === SUPABASE_TOKEN
          ? { data: { user: { id: "user-1" } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } },
    },
    rpc: async () => ({ data: memory.role, error: null }),
    from: () => chain(),
    storage: {
      from: () => ({
        download: async (path: string) => {
          if (memory.missingPaths.has(path)) {
            return { data: null, error: { message: CLIENT_SECRET } };
          }
          return {
            data: new Blob([new Uint8Array([1, 2, 3])]),
            error: null,
          };
        },
      }),
    },
  }));
}

function bodyText(body: BodyInit | null | undefined): string {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  return "";
}

function installFetch(): void {
  const folders = new Map<string, string>();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("oauth2.googleapis.com/token")) {
        if (memory.throwGoogle) {
          throw new Error(`network ${CLIENT_SECRET} ${ACCESS_TOKEN} ${SUPABASE_TOKEN}`);
        }
        return Response.json({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN });
      }
      if (memory.throwGoogle || memory.throwAfterToken) {
        throw new Error(`network ${CLIENT_SECRET} ${ACCESS_TOKEN} ${SUPABASE_TOKEN}`);
      }
      if (url.includes("uploadType=multipart")) {
        const text = bodyText(init?.body);
        uploadBodies.push(text);
        const receiptFileId = /"receiptFileId":"([^"]+)"/.exec(text)?.[1] ?? "";
        const status =
          memory.uploadStatus.get(receiptFileId) ??
          (memory.failUploadIds.has(receiptFileId) ? 403 : null);
        if (status) {
          return new Response(JSON.stringify({ error: CLIENT_SECRET, token: ACCESS_TOKEN }), {
            status,
          });
        }
        return Response.json({ id: `drive-${receiptFileId.slice(0, 8)}` });
      }
      if (url.includes("www.googleapis.com/drive") && method === "GET") {
        const query = new URL(url).searchParams.get("q") ?? "";
        if (query.includes("appProperties")) {
          const receiptFileId = /value='([^']+)'/.exec(query)?.[1] ?? "";
          const existing = memory.existingDriveIds.get(receiptFileId);
          return Response.json({ files: existing ? [{ id: existing }] : [] });
        }
        const name = /name = '([^']+)'/.exec(query)?.[1] ?? "";
        const parent = /'([^']+)' in parents/.exec(query)?.[1] ?? "";
        const existing = folders.get(`${parent}/${name}`);
        return Response.json({ files: existing ? [{ id: existing }] : [] });
      }
      if (url.includes("www.googleapis.com/drive") && method === "POST") {
        const meta = JSON.parse(bodyText(init?.body)) as { name: string; parents: string[] };
        const id = `folder-${folders.size + 1}`;
        folders.set(`${meta.parents[0]}/${meta.name}`, id);
        return Response.json({ id });
      }
      return new Response("unexpected", { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function seed(file: Partial<MemoryFile> & { id: string }, receipt?: Partial<MemoryReceipt>): void {
  const receiptId = file.receiptId ?? `receipt-${file.id}`;
  memory.receipts.push({
    id: receiptId,
    receiptDate: "2026-10-05",
    receiptTotal: 13.2,
    discardedAt: null,
    supplierName: "Makro",
    ...receipt,
  });
  memory.files.push({
    receiptId,
    storagePath: `${file.id}.jpg`,
    pageNumber: 1,
    mimeType: "image/jpeg",
    driveAttempts: 0,
    driveSyncedAt: null,
    driveFileId: null,
    driveError: null,
    createdAt: "2026-10-05T00:00:00.000Z",
    ...file,
  });
}

function setDriveEnv(present: boolean): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
  if (present) {
    process.env.GOOGLE_DRIVE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = CLIENT_SECRET;
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN = REFRESH_TOKEN;
    return;
  }
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
}

function post(token: string | null, body?: unknown): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return POST(
    new Request("http://localhost/api/purchase-receipts/drive-sync", {
      method: "POST",
      headers,
      body: body === undefined ? "{}" : JSON.stringify(body),
    }),
  );
}

function assertClean(value: string): void {
  for (const secret of SECRETS) {
    expect(value).not.toContain(secret);
  }
  expect(value).not.toContain(SERVICE_ROLE);
}

describe("POST /api/purchase-receipts/drive-sync", () => {
  beforeEach(() => {
    memory = {
      role: "owner",
      files: [],
      receipts: [],
      loseClaims: new Set(),
      existingDriveIds: new Map(),
      failUploadIds: new Set(),
      uploadStatus: new Map(),
      missingPaths: new Set(),
      throwGoogle: false,
      throwAfterToken: false,
    };
    uploadBodies.length = 0;
    createClientMock.mockReset();
    installClient();
    installFetch();
    setDriveEnv(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 without a token", async () => {
    const response = await post(null);
    expect(response.status).toBe(401);
    expect(createClientMock).not.toHaveBeenCalled();
    assertClean(await response.text());
  });

  it("returns 403 for a seller", async () => {
    memory.role = "seller";
    const response = await post(SUPABASE_TOKEN);
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    assertClean(await response.text());
  });

  it("returns 405 for GET", () => {
    const response = GET();
    expect(response.status).toBe(405);
  });

  it("returns configured false and does not call Google when the env is missing", async () => {
    setDriveEnv(false);
    seed({ id: "file-1" });
    const response = await post(SUPABASE_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(memory.files[0]?.driveFileId).toBeNull();
  });

  it("claims, uploads, and writes the drive pair with the error cleared", async () => {
    seed({ id: "22222222-2222-4222-8222-222222222222", driveError: "old failure" });
    const response = await post(SUPABASE_TOKEN);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      configured: true,
      available: true,
      synced: 1,
      failed: 0,
      remaining: 0,
    });
    expect(Object.keys(body).sort()).toEqual([
      "available",
      "configured",
      "failed",
      "remaining",
      "synced",
    ]);
    const file = memory.files[0];
    expect(file?.driveAttempts).toBe(1);
    expect(file?.driveFileId).toBe("drive-22222222");
    expect(file?.driveSyncedAt).not.toBeNull();
    expect(file?.driveError).toBeNull();
    expect(uploadBodies[0]).toContain("2026-10-05_Makro_13.20_22222222.jpg");
    expect(uploadBodies[0]).toContain("receiptFileId");
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
    expect(JSON.stringify(createClientMock.mock.calls)).not.toContain(SERVICE_ROLE);
    expect(JSON.stringify(createClientMock.mock.calls)).not.toContain(CLIENT_SECRET);
  });

  it("skips a lost claim and does not upload", async () => {
    seed({ id: "file-lost" });
    memory.loseClaims.add("file-lost");
    const response = await post(SUPABASE_TOKEN);
    const body = (await response.json()) as { synced: number; failed: number };
    expect(body.synced).toBe(0);
    expect(body.failed).toBe(0);
    expect(uploadBodies).toHaveLength(0);
    expect(memory.files[0]?.driveAttempts).toBe(0);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("uploadType=multipart");
  });

  it("reuses an existing Drive file and does not upload again", async () => {
    seed({ id: "file-existing" });
    memory.existingDriveIds.set("file-existing", "drive-already");
    const response = await post(SUPABASE_TOKEN);
    expect(await response.json()).toMatchObject({ synced: 1, failed: 0 });
    expect(uploadBodies).toHaveLength(0);
    expect(memory.files[0]?.driveFileId).toBe("drive-already");
    expect(memory.files[0]?.driveError).toBeNull();
  });

  it("releases an upload 403, writes the safe error, and leaves the next page untouched", async () => {
    seed({
      id: "file-fail",
      driveAttempts: 2,
      createdAt: "2026-10-05T00:00:00.000Z",
    });
    seed({
      id: "file-ok",
      createdAt: "2026-10-05T00:01:00.000Z",
      receiptId: "receipt-ok",
    });
    memory.failUploadIds.add("file-fail");
    const response = await post(SUPABASE_TOKEN);
    const body = await response.json();
    expect(body).toEqual({
      configured: true,
      available: false,
      synced: 0,
      failed: 1,
      remaining: 2,
    });
    const failed = memory.files.find((file) => file.id === "file-fail");
    const next = memory.files.find((file) => file.id === "file-ok");
    expect(failed?.driveAttempts).toBe(2);
    expect(failed?.driveError).toBe("Google Drive refused the upload (403).");
    expect(failed?.driveSyncedAt).toBeNull();
    expect(next?.driveAttempts).toBe(0);
    expect(next?.driveFileId).toBeNull();
    expect(next?.driveError).toBeNull();
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
  });

  it("releases a 5xx the same way and does not claim the next page", async () => {
    seed({ id: "file-500", driveAttempts: 0, createdAt: "2026-10-05T00:00:00.000Z" });
    seed({
      id: "file-after-500",
      createdAt: "2026-10-05T00:01:00.000Z",
      receiptId: "receipt-after-500",
    });
    memory.uploadStatus.set("file-500", 503);
    const response = await post(SUPABASE_TOKEN);
    const body = await response.json();
    expect(body).toMatchObject({ available: false, synced: 0, failed: 1 });
    const failed = memory.files.find((file) => file.id === "file-500");
    const next = memory.files.find((file) => file.id === "file-after-500");
    expect(failed?.driveAttempts).toBe(0);
    expect(failed?.driveError).toBe("Google Drive refused the upload (503).");
    expect(next?.driveAttempts).toBe(0);
    expect(next?.driveFileId).toBeNull();
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
  });

  it("keeps the attempt for a missing photo and still copies the next page", async () => {
    seed({ id: "file-missing", createdAt: "2026-10-05T00:00:00.000Z" });
    seed({
      id: "file-after-missing",
      createdAt: "2026-10-05T00:01:00.000Z",
      receiptId: "receipt-after-missing",
    });
    memory.missingPaths.add("file-missing.jpg");
    const response = await post(SUPABASE_TOKEN);
    const body = await response.json();
    expect(body).toMatchObject({ available: true, synced: 1, failed: 1 });
    const failed = memory.files.find((file) => file.id === "file-missing");
    const copied = memory.files.find((file) => file.id === "file-after-missing");
    expect(failed?.driveAttempts).toBe(1);
    expect(failed?.driveError).toBe("Could not download the receipt photo.");
    expect(copied?.driveFileId).toBe("drive-file-aft");
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
  });

  it("keeps the attempt for a Drive 400 and still copies the next page", async () => {
    seed({ id: "file-400", createdAt: "2026-10-05T00:00:00.000Z" });
    seed({
      id: "file-after-400",
      createdAt: "2026-10-05T00:01:00.000Z",
      receiptId: "receipt-after-400",
    });
    memory.uploadStatus.set("file-400", 400);
    const response = await post(SUPABASE_TOKEN);
    const body = await response.json();
    expect(body).toMatchObject({ available: true, synced: 1, failed: 1 });
    const failed = memory.files.find((file) => file.id === "file-400");
    const copied = memory.files.find((file) => file.id === "file-after-400");
    expect(failed?.driveAttempts).toBe(1);
    expect(failed?.driveError).toBe("Google Drive refused the upload (400).");
    expect(copied?.driveFileId).toBe("drive-file-aft");
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
  });

  it("respects the attempts cap unless file ids are sent", async () => {
    seed({ id: "file-capped", driveAttempts: 5 });
    const automatic = await post(SUPABASE_TOKEN);
    expect(await automatic.json()).toMatchObject({ synced: 0, failed: 0 });
    expect(uploadBodies).toHaveLength(0);

    const manual = await post(SUPABASE_TOKEN, { fileIds: ["file-capped"] });
    expect(await manual.json()).toMatchObject({ synced: 1, failed: 0 });
    expect(uploadBodies).toHaveLength(1);
    expect(memory.files[0]?.driveAttempts).toBe(6);
  });

  it("does not copy a discarded receipt", async () => {
    seed({ id: "file-discarded" }, { discardedAt: "2026-10-06T00:00:00.000Z" });
    const response = await post(SUPABASE_TOKEN);
    expect(await response.json()).toMatchObject({ synced: 0, failed: 0 });
    expect(uploadBodies).toHaveLength(0);
    expect(memory.files[0]?.driveFileId).toBeNull();
  });

  it("does not burn attempts or store a secret when Google cannot be reached", async () => {
    seed({ id: "file-throw", createdAt: "2026-10-05T00:00:00.000Z" });
    seed({
      id: "file-throw-2",
      createdAt: "2026-10-05T00:02:00.000Z",
      receiptId: "receipt-throw-2",
    });
    memory.throwGoogle = true;
    const response = await post(SUPABASE_TOKEN);
    const text = await response.text();
    assertClean(text);
    expect(JSON.parse(text)).toEqual({
      configured: true,
      available: false,
      synced: 0,
      failed: 0,
      remaining: 2,
    });
    for (const file of memory.files) {
      expect(file.driveAttempts).toBe(0);
      expect(file.driveError).toBeNull();
      expect(file.driveSyncedAt).toBeNull();
    }
    assertClean(JSON.stringify(memory.files));
  });

  it("releases a claim when Google becomes unreachable after the token is issued", async () => {
    seed({ id: "file-late", driveAttempts: 1, createdAt: "2026-10-05T00:00:00.000Z" });
    seed({
      id: "file-later",
      driveAttempts: 1,
      createdAt: "2026-10-05T00:02:00.000Z",
      receiptId: "receipt-later",
    });
    memory.throwAfterToken = true;
    const response = await post(SUPABASE_TOKEN);
    const body = await response.json();
    expect(body).toMatchObject({ available: false, synced: 0, failed: 1 });
    const first = memory.files.find((file) => file.id === "file-late");
    const next = memory.files.find((file) => file.id === "file-later");
    expect(first?.driveAttempts).toBe(1);
    expect(first?.driveError).toBe("Could not reach Google Drive.");
    expect(next?.driveAttempts).toBe(1);
    expect(next?.driveError).toBeNull();
    expect(next?.driveFileId).toBeNull();
    assertClean(JSON.stringify(body));
    assertClean(JSON.stringify(memory.files));
  });
});
