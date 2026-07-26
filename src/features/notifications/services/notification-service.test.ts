/**
 * Service-level coverage for notificationService (DEV-050).
 *
 * Reads must go only through notifications.
 * The service must not mutate data, recalculate alerts/events, or call RPCs.
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

import { notificationService } from "./notification-service";
import type { Notification } from "../types/notification";

const ENTITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const NOTIFICATIONS_SELECT =
  "id, notification_type, severity, title, message, entity_type, entity_id, created_at, is_read";

function notificationRow(overrides?: Record<string, unknown>) {
  return {
    id: `notification.low_stock.${ENTITY_ID}`,
    notification_type: "LOW_STOCK",
    severity: "medium",
    title: "Low stock",
    message: "Flour is below minimum (5 / min 10)",
    entity_type: "ingredient",
    entity_id: ENTITY_ID,
    created_at: "2026-07-25T12:00:00.000Z",
    is_read: false,
    ...overrides,
  };
}

function forbidOtherTables(table: string) {
  if (table !== "notifications") {
    throw new Error(`Unexpected table: ${table}`);
  }
}

function mockNotificationsList(
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

function mockNotificationsByEntity(
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
  expect(tablesTouched).toEqual(["notifications"]);
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("notificationService.getNotifications (DEV-050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries notifications with default limit 50 and created_at DESC", async () => {
    const { selectMock, orderFirst, orderSecond, limitMock } =
      mockNotificationsList([notificationRow()]);

    const result = await notificationService.getNotifications();

    expect(result.error).toBeNull();
    expect(supabaseMock.from).toHaveBeenCalledWith("notifications");
    expect(selectMock).toHaveBeenCalledWith(NOTIFICATIONS_SELECT);
    expect(orderFirst).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(orderSecond).toHaveBeenCalledWith("id", { ascending: true });
    expect(limitMock).toHaveBeenCalledWith(50);
    expectReadOnly();
  });

  it("applies a custom limit", async () => {
    const { limitMock } = mockNotificationsList([notificationRow()]);

    const result = await notificationService.getNotifications(25);

    expect(result.error).toBeNull();
    expect(limitMock).toHaveBeenCalledWith(25);
  });

  it("maps rows to typed Notification DTOs", async () => {
    mockNotificationsList([
      notificationRow({
        id: `notification.sale_confirmed.${SALE_ID}`,
        notification_type: "SALE_CONFIRMED",
        severity: "info",
        title: "Sale confirmed",
        message: "Sale S-000001 confirmed",
        entity_type: "sale",
        entity_id: SALE_ID,
        created_at: "2026-07-25T14:00:00.000Z",
        is_read: false,
      }),
    ]);

    const result = await notificationService.getNotifications();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: `notification.sale_confirmed.${SALE_ID}`,
        notificationType: "SALE_CONFIRMED",
        severity: "info",
        title: "Sale confirmed",
        message: "Sale S-000001 confirmed",
        entityType: "sale",
        entityId: SALE_ID,
        createdAt: "2026-07-25T14:00:00.000Z",
        isRead: false,
      },
    ] satisfies Notification[]);
  });

  it("returns an empty array when the view has no rows", async () => {
    mockNotificationsList([]);

    const result = await notificationService.getNotifications();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expectReadOnly();
  });

  it("maps missing-view errors", async () => {
    mockNotificationsList([], {
      message: 'relation "notifications" does not exist',
      code: "42P01",
    });

    const result = await notificationService.getNotifications();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Notifications are not available yet. Apply the notifications database script and try again.",
    );
  });

  it("rejects invalid and oversized limits without querying", async () => {
    const invalid = await notificationService.getNotifications(0);
    expect(invalid.data).toBeNull();
    expect(invalid.error).toBe(
      "Notifications limit must be a positive integer.",
    );

    const oversized = await notificationService.getNotifications(501);
    expect(oversized.data).toBeNull();
    expect(oversized.error).toBe(
      "Notifications limit must be 500 or fewer.",
    );

    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects invalid DTO payloads from the view", async () => {
    mockNotificationsList([
      notificationRow({
        notification_type: "UNKNOWN_TYPE",
      }),
    ]);

    const result = await notificationService.getNotifications();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Notifications response was invalid.");
  });

  it("never mutates data or writes tables", async () => {
    mockNotificationsList([notificationRow()]);

    await notificationService.getNotifications(10);

    expectReadOnly();
  });
});

describe("notificationService.getNotificationsByEntity (DEV-050)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("filters by entity_type and entity_id ordered by created_at DESC", async () => {
    const { selectMock, eqFirst, eqSecond, orderFirst, orderSecond } =
      mockNotificationsByEntity([
        notificationRow({
          id: `notification.sale_confirmed.${SALE_ID}`,
          notification_type: "SALE_CONFIRMED",
          severity: "info",
          title: "Sale confirmed",
          message: "Sale S-000001 confirmed",
          entity_type: "sale",
          entity_id: SALE_ID,
          created_at: "2026-07-25T16:00:00.000Z",
        }),
      ]);

    const result = await notificationService.getNotificationsByEntity(
      "sale",
      SALE_ID,
    );

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(supabaseMock.from).toHaveBeenCalledWith("notifications");
    expect(selectMock).toHaveBeenCalledWith(NOTIFICATIONS_SELECT);
    expect(eqFirst).toHaveBeenCalledWith("entity_type", "sale");
    expect(eqSecond).toHaveBeenCalledWith("entity_id", SALE_ID);
    expect(orderFirst).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(orderSecond).toHaveBeenCalledWith("id", { ascending: true });
    expectReadOnly();
  });

  it("returns an empty array when no entity notifications exist", async () => {
    mockNotificationsByEntity([]);

    const result = await notificationService.getNotificationsByEntity(
      "ingredient",
      ENTITY_ID,
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it("rejects invalid entity type and id without querying", async () => {
    const badType = await notificationService.getNotificationsByEntity(
      "widget",
      ENTITY_ID,
    );
    expect(badType.data).toBeNull();
    expect(badType.error).toBe("Entity type is required.");

    const badId = await notificationService.getNotificationsByEntity(
      "sale",
      "not-a-uuid",
    );
    expect(badId.data).toBeNull();
    expect(badId.error).toBe("Entity id is required.");

    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("maps missing-view errors for entity notifications", async () => {
    mockNotificationsByEntity([], {
      message: 'relation "notifications" does not exist',
      code: "42P01",
    });

    const result = await notificationService.getNotificationsByEntity(
      "sale",
      SALE_ID,
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Notifications are not available yet. Apply the notifications database script and try again.",
    );
  });

  it("maps entity rows to typed Notification DTOs without recalculation", async () => {
    mockNotificationsByEntity([
      notificationRow({
        id: `notification.purchase_received.${ENTITY_ID}`,
        notification_type: "PURCHASE_RECEIVED",
        severity: "info",
        title: "Purchase received",
        message: "Purchase received INV-100",
        entity_type: "purchase",
        entity_id: ENTITY_ID,
        created_at: "2026-07-25T11:00:00.000Z",
        is_read: false,
      }),
    ]);

    const result = await notificationService.getNotificationsByEntity(
      "purchase",
      ENTITY_ID,
    );

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        id: `notification.purchase_received.${ENTITY_ID}`,
        notificationType: "PURCHASE_RECEIVED",
        severity: "info",
        title: "Purchase received",
        message: "Purchase received INV-100",
        entityType: "purchase",
        entityId: ENTITY_ID,
        createdAt: "2026-07-25T11:00:00.000Z",
        isRead: false,
      },
    ] satisfies Notification[]);
    expectReadOnly();
  });
});
