/**
 * Service-level coverage for inventoryAlertService (DEV-045).
 *
 * Reads must go only through inventory_alerts.
 * The service must not query ingredients / report tables, call RPCs,
 * recalculate alerts, or mutate stock.
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

import { inventoryAlertService } from "./inventory-alert-service";
import type { InventoryAlert } from "../types/inventory-alert";

const INGREDIENT_LOW = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_OUT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INGREDIENT_NEG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const ALERTS_SELECT =
  "alert_type, ingredient_id, ingredient_name, current_quantity, minimum_quantity, severity, created_at";

function alertRow(overrides?: Record<string, unknown>) {
  return {
    alert_type: "LOW_STOCK",
    ingredient_id: INGREDIENT_LOW,
    ingredient_name: "Flour",
    current_quantity: "3",
    minimum_quantity: "5",
    severity: "medium",
    created_at: "2026-07-24T10:00:00.000Z",
    ...overrides,
  };
}

function forbidOtherTables(table: string) {
  if (table !== "inventory_alerts") {
    throw new Error(`Unexpected table: ${table}`);
  }
}

function mockAlertsView(
  rows: Record<string, unknown>[],
  error: unknown = null,
) {
  const orderThird = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderSecond = vi.fn().mockReturnValue({
    order: orderThird,
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

  return { selectMock, orderFirst, orderSecond, orderThird };
}

function expectReadOnly() {
  const tablesTouched = supabaseMock.from.mock.calls.map(
    (call) => call[0] as string,
  );
  expect(tablesTouched).toEqual(["inventory_alerts"]);
  expect(tablesTouched).not.toContain("ingredients");
  expect(tablesTouched).not.toContain("report_inventory_summary");
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("inventoryAlertService.getInventoryAlerts (DEV-045)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries only inventory_alerts and returns typed alerts", async () => {
    const { selectMock, orderFirst, orderSecond, orderThird } = mockAlertsView([
      alertRow({
        alert_type: "NEGATIVE_STOCK",
        ingredient_id: INGREDIENT_NEG,
        ingredient_name: "Milk",
        current_quantity: "-1",
        minimum_quantity: "2",
        severity: "critical",
      }),
      alertRow({
        alert_type: "OUT_OF_STOCK",
        ingredient_id: INGREDIENT_OUT,
        ingredient_name: "Butter",
        current_quantity: "0",
        minimum_quantity: "1",
        severity: "high",
      }),
      alertRow(),
    ]);

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        alertType: "NEGATIVE_STOCK",
        ingredientId: INGREDIENT_NEG,
        ingredientName: "Milk",
        currentQuantity: -1,
        minimumQuantity: 2,
        severity: "critical",
        createdAt: "2026-07-24T10:00:00.000Z",
      },
      {
        alertType: "OUT_OF_STOCK",
        ingredientId: INGREDIENT_OUT,
        ingredientName: "Butter",
        currentQuantity: 0,
        minimumQuantity: 1,
        severity: "high",
        createdAt: "2026-07-24T10:00:00.000Z",
      },
      {
        alertType: "LOW_STOCK",
        ingredientId: INGREDIENT_LOW,
        ingredientName: "Flour",
        currentQuantity: 3,
        minimumQuantity: 5,
        severity: "medium",
        createdAt: "2026-07-24T10:00:00.000Z",
      },
    ] satisfies InventoryAlert[]);
    expect(supabaseMock.from).toHaveBeenCalledWith("inventory_alerts");
    expect(selectMock).toHaveBeenCalledWith(ALERTS_SELECT);
    expect(orderFirst).toHaveBeenCalledWith("severity", { ascending: true });
    expect(orderSecond).toHaveBeenCalledWith("ingredient_name", {
      ascending: true,
    });
    expect(orderThird).toHaveBeenCalledWith("ingredient_id", {
      ascending: true,
    });
    expectReadOnly();
  });

  it("maps LOW_STOCK, OUT_OF_STOCK, and NEGATIVE_STOCK alert types", async () => {
    mockAlertsView([
      alertRow({ alert_type: "LOW_STOCK", severity: "medium" }),
      alertRow({
        alert_type: "OUT_OF_STOCK",
        ingredient_id: INGREDIENT_OUT,
        severity: "high",
        current_quantity: "0",
      }),
      alertRow({
        alert_type: "NEGATIVE_STOCK",
        ingredient_id: INGREDIENT_NEG,
        severity: "critical",
        current_quantity: "-2.5",
      }),
    ]);

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.error).toBeNull();
    expect(result.data?.map((alert) => alert.alertType)).toEqual([
      "LOW_STOCK",
      "OUT_OF_STOCK",
      "NEGATIVE_STOCK",
    ]);
    expect(result.data?.map((alert) => alert.severity)).toEqual([
      "medium",
      "high",
      "critical",
    ]);
  });

  it("returns an empty array when the view has no rows", async () => {
    mockAlertsView([]);

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expectReadOnly();
  });

  it("maps missing-view errors", async () => {
    mockAlertsView([], {
      message: 'relation "inventory_alerts" does not exist',
      code: "42P01",
    });

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Inventory alerts are not available yet. Apply the inventory alerts database script and try again.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid alert payloads without mutating", async () => {
    mockAlertsView([
      alertRow({
        alert_type: "UNKNOWN_ALERT",
      }),
    ]);

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Inventory alerts response was invalid.");
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("never mutates data or recalculates quantities", async () => {
    mockAlertsView([
      alertRow({
        current_quantity: "3",
        minimum_quantity: "10",
      }),
    ]);

    const result = await inventoryAlertService.getInventoryAlerts();

    expect(result.error).toBeNull();
    // Values come from the view as-is — never recomputed in TypeScript.
    expect(result.data?.[0]?.currentQuantity).toBe(3);
    expect(result.data?.[0]?.minimumQuantity).toBe(10);
    expectReadOnly();
  });
});
