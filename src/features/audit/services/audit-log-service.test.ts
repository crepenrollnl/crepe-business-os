/**
 * Service-level coverage for auditLogService (DEV-048).
 *
 * Reads must go only through audit_log.
 * The service must not mutate data, recalculate events, or call RPCs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { auditLogService } from "./audit-log-service";
import type { AuditEvent } from "../types/audit";

const ENTITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const AUDIT_SELECT =
  "event_id, occurred_at, entity_type, entity_id, action, user_id, summary, metadata";

function auditRow(overrides?: Record<string, unknown>) {
  return {
    event_id: `sale.confirmed.${ENTITY_ID}`,
    occurred_at: "2026-07-24T16:00:00.000Z",
    entity_type: "sale",
    entity_id: ENTITY_ID,
    action: "confirmed",
    user_id: null,
    summary: "Sale S-000001 confirmed",
    metadata: {
      sale_number: "S-000001",
      status: "confirmed",
      total: 25,
    },
    ...overrides,
  };
}

function forbidOtherTables(table: string) {
  if (table !== "audit_log") {
    throw new Error(`Unexpected table: ${table}`);
  }
}

function mockAuditLogList(
  rows: Record<string, unknown>[],
  error: unknown = null,
) {
  const limitMock = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderSecond = vi.fn().mockReturnValue({
    limit: limitMock,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const selectMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidOtherTables(table);
    return {
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };
  });

  return { selectMock, orderFirst, orderSecond, limitMock };
}

function mockEntityHistory(
  rows: Record<string, unknown>[],
  error: unknown = null,
) {
  const orderSecond = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const eqSecond = vi.fn().mockReturnValue({
    order: orderFirst,
  });
  const eqFirst = vi.fn().mockReturnValue({
    eq: eqSecond,
  });
  const selectMock = vi.fn().mockReturnValue({
    eq: eqFirst,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidOtherTables(table);
    return {
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };
  });

  return { selectMock, eqFirst, eqSecond, orderFirst, orderSecond };
}

function expectReadOnly() {
  const tablesTouched = supabaseMock.from.mock.calls.map(
    (call) => call[0] as string,
  );
  expect(tablesTouched).toEqual(["audit_log"]);
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("auditLogService.getAuditLog (DEV-048)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries audit_log with default limit 100 and occurred_at DESC", async () => {
    const { selectMock, orderFirst, orderSecond, limitMock } = mockAuditLogList(
      [auditRow()],
    );

    const result = await auditLogService.getAuditLog();

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledWith("audit_log");
    expect(selectMock).toHaveBeenCalledWith(AUDIT_SELECT);
    expect(orderFirst).toHaveBeenCalledWith("occurred_at", {
      ascending: false,
    });
    expect(orderSecond).toHaveBeenCalledWith("event_id", { ascending: true });
    expect(limitMock).toHaveBeenCalledWith(100);
    expectReadOnly();
  });

  it("applies a custom limit", async () => {
    const { limitMock } = mockAuditLogList([auditRow()]);

    const result = await auditLogService.getAuditLog(25);

    expect(result.error).toBeNull();
    expect(limitMock).toHaveBeenCalledWith(25);
  });

  it("maps rows to typed AuditEvent DTOs with metadata passthrough", async () => {
    mockAuditLogList([
      auditRow({
        user_id: USER_ID,
        metadata: {
          sale_number: "S-000001",
          status: "confirmed",
          total: 25,
          nested: { ok: true },
        },
      }),
    ]);

    const result = await auditLogService.getAuditLog();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        eventId: `sale.confirmed.${ENTITY_ID}`,
        occurredAt: "2026-07-24T16:00:00.000Z",
        entityType: "sale",
        entityId: ENTITY_ID,
        action: "confirmed",
        userId: USER_ID,
        summary: "Sale S-000001 confirmed",
        metadata: {
          sale_number: "S-000001",
          status: "confirmed",
          total: 25,
          nested: { ok: true },
        },
      },
    ] satisfies AuditEvent[]);
  });

  it("returns an empty array when the view has no rows", async () => {
    mockAuditLogList([]);

    const result = await auditLogService.getAuditLog();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expectReadOnly();
  });

  it("maps missing-view errors", async () => {
    mockAuditLogList([], {
      message: 'relation "audit_log" does not exist',
      code: "42P01",
    });

    const result = await auditLogService.getAuditLog();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Audit log is not available yet. Apply the audit log database script and try again.",
    );
  });

  it("rejects invalid and oversized limits without querying", async () => {
    const invalid = await auditLogService.getAuditLog(0);
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe("Audit log limit must be a positive integer.");

    const oversized = await auditLogService.getAuditLog(501);
    expect(oversized.data).toBeNull();
    expect(oversized.error).toBe("Audit log limit must be 500 or fewer.");

    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("never mutates data", async () => {
    mockAuditLogList([auditRow()]);

    await auditLogService.getAuditLog(10);

    expectReadOnly();
  });
});

describe("auditLogService.getEntityHistory (DEV-048)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("filters by entity_type and entity_id ordered by occurred_at DESC", async () => {
    const { selectMock, eqFirst, eqSecond, orderFirst, orderSecond } =
      mockEntityHistory([
        auditRow({ action: "confirmed", occurred_at: "2026-07-24T16:00:00.000Z" }),
        auditRow({
          event_id: `sale.created.${ENTITY_ID}`,
          action: "created",
          occurred_at: "2026-07-24T15:00:00.000Z",
          summary: "Sale S-000001 created",
        }),
      ]);

    const result = await auditLogService.getEntityHistory("sale", ENTITY_ID);

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(supabaseMock.from).toHaveBeenCalledWith("audit_log");
    expect(selectMock).toHaveBeenCalledWith(AUDIT_SELECT);
    expect(eqFirst).toHaveBeenCalledWith("entity_type", "sale");
    expect(eqSecond).toHaveBeenCalledWith("entity_id", ENTITY_ID);
    expect(orderFirst).toHaveBeenCalledWith("occurred_at", {
      ascending: false,
    });
    expect(orderSecond).toHaveBeenCalledWith("event_id", { ascending: true });
    expectReadOnly();
  });

  it("returns an empty history array when no events exist", async () => {
    mockEntityHistory([]);

    const result = await auditLogService.getEntityHistory("customer", ENTITY_ID);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("rejects invalid entity type and id without querying", async () => {
    const badType = await auditLogService.getEntityHistory("widget", ENTITY_ID);
    expect(badType.data).toBeNull();
    expect(badType.error).toBe("Entity type is required.");

    const badId = await auditLogService.getEntityHistory("sale", "not-a-uuid");
    expect(badId.data).toBeNull();
    expect(badId.error).toBe("Entity id is required.");

    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps missing-view errors for entity history", async () => {
    mockEntityHistory([], {
      message: 'relation "audit_log" does not exist',
      code: "42P01",
    });

    const result = await auditLogService.getEntityHistory("sale", ENTITY_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Audit log is not available yet. Apply the audit log database script and try again.",
    );
  });

  it("passes metadata through without recalculation", async () => {
    mockEntityHistory([
      auditRow({
        metadata: { total: 999, status: "confirmed" },
      }),
    ]);

    const result = await auditLogService.getEntityHistory("sale", ENTITY_ID);

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.metadata).toEqual({
      total: 999,
      status: "confirmed",
    });
    expectReadOnly();
  });
});
