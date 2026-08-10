/**
 * Service-level coverage for inventoryForecastService (DEV-117).
 *
 * Read-only: ingredients + production_out movements. No inventory writes.
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

import { inventoryForecastService } from "./inventory-forecast-service";

const FLOUR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MILK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function mockIngredients(rows: Record<string, unknown>[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn().mockReturnValue({ order });
  return { select, order };
}

function mockMovements(rows: Record<string, unknown>[]) {
  const gte = vi.fn().mockResolvedValue({ data: rows, error: null });
  const not = vi.fn().mockReturnValue({ gte });
  const eq = vi.fn().mockReturnValue({ not });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, not, gte };
}

describe("inventoryForecastService (DEV-117)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("builds forecasts from current stock and production_out history", async () => {
    const ingredients = mockIngredients([
      {
        id: FLOUR_ID,
        name: "Flour",
        unit: "kg",
        current_stock: 30,
      },
      {
        id: MILK_ID,
        name: "Milk",
        unit: "L",
        current_stock: 10,
      },
    ]);
    const movements = mockMovements([
      {
        ingredient_id: FLOUR_ID,
        quantity: 30,
        occurred_at: "2026-07-20T10:00:00.000Z",
        movement_type: "production_out",
      },
      {
        ingredient_id: FLOUR_ID,
        quantity: 30,
        occurred_at: "2026-07-25T10:00:00.000Z",
        movement_type: "production_out",
      },
      {
        ingredient_id: MILK_ID,
        quantity: 60,
        occurred_at: "2026-07-22T10:00:00.000Z",
        movement_type: "production_out",
      },
    ]);

    let call = 0;
    supabaseMock.from.mockImplementation((table: string) => {
      call += 1;
      if (call === 1) {
        expect(table).toBe("ingredients");
        return {
          select: ingredients.select,
          insert: insertMock,
          update: updateMock,
          delete: deleteMock,
        };
      }
      expect(table).toBe("stock_movements");
      return {
        select: movements.select,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
      };
    });

    const result = await inventoryForecastService.getInventoryForecasts({
      criticalDaysRemaining: 3,
      lowDaysRemaining: 7,
      lookbackDays: 30,
    });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);

    const flour = result.data?.find((row) => row.ingredient_id === FLOUR_ID);
    expect(flour).toEqual(
      expect.objectContaining({
        current_quantity: 30,
        average_daily_consumption: 2,
        days_remaining: 15,
        status: "healthy",
      }),
    );

    const milk = result.data?.find((row) => row.ingredient_id === MILK_ID);
    // avg = 2/day, days = 5 → low
    expect(milk).toEqual(
      expect.objectContaining({
        current_quantity: 10,
        average_daily_consumption: 2,
        days_remaining: 5,
        status: "low",
      }),
    );

    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("handles zero consumption / missing history as null days", async () => {
    const ingredients = mockIngredients([
      {
        id: FLOUR_ID,
        name: "Flour",
        unit: "kg",
        current_stock: 20,
      },
    ]);
    const movements = mockMovements([]);

    let call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return { select: ingredients.select };
      }
      return { select: movements.select };
    });

    const result = await inventoryForecastService.getInventoryForecasts();

    expect(result.error).toBeNull();
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({
        average_daily_consumption: 0,
        days_remaining: null,
        status: null,
      }),
    );
  });

  it("marks zero inventory with usage as critical", async () => {
    const ingredients = mockIngredients([
      {
        id: FLOUR_ID,
        name: "Flour",
        unit: "kg",
        current_stock: 0,
      },
    ]);
    const movements = mockMovements([
      {
        ingredient_id: FLOUR_ID,
        quantity: 15,
        occurred_at: "2026-07-20T10:00:00.000Z",
        movement_type: "production_out",
      },
    ]);

    let call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return { select: ingredients.select };
      }
      return { select: movements.select };
    });

    const result = await inventoryForecastService.getInventoryForecasts();

    expect(result.error).toBeNull();
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({
        current_quantity: 0,
        days_remaining: 0,
        status: "critical",
      }),
    );
  });

  it("surfaces negative inventory as critical without inventing days", async () => {
    const ingredients = mockIngredients([
      {
        id: FLOUR_ID,
        name: "Flour",
        unit: "kg",
        current_stock: -2,
      },
    ]);
    const movements = mockMovements([]);

    let call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return { select: ingredients.select };
      }
      return { select: movements.select };
    });

    const result = await inventoryForecastService.getInventoryForecasts();

    expect(result.error).toBeNull();
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({
        current_quantity: -2,
        days_remaining: null,
        status: "critical",
      }),
    );
  });

  it("applies configurable critical thresholds", async () => {
    const ingredients = mockIngredients([
      {
        id: FLOUR_ID,
        name: "Flour",
        unit: "kg",
        current_stock: 20,
      },
    ]);
    const movements = mockMovements([
      {
        ingredient_id: FLOUR_ID,
        quantity: 60,
        occurred_at: "2026-07-20T10:00:00.000Z",
        movement_type: "production_out",
      },
    ]);

    let call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return { select: ingredients.select };
      }
      return { select: movements.select };
    });

    // avg = 2/day, days = 10 → healthy with default low=7, but critical with low=14
    const defaultResult = await inventoryForecastService.getInventoryForecasts({
      criticalDaysRemaining: 3,
      lowDaysRemaining: 7,
      lookbackDays: 30,
    });
    expect(defaultResult.data?.[0]?.status).toBe("healthy");

    call = 0;
    supabaseMock.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return { select: ingredients.select };
      }
      return { select: movements.select };
    });

    const tightResult = await inventoryForecastService.getInventoryForecasts({
      criticalDaysRemaining: 5,
      lowDaysRemaining: 14,
      lookbackDays: 30,
    });
    expect(tightResult.data?.[0]?.days_remaining).toBe(10);
    expect(tightResult.data?.[0]?.status).toBe("low");
  });

  it("rejects invalid threshold configuration without querying", async () => {
    const result = await inventoryForecastService.getInventoryForecasts({
      criticalDaysRemaining: 10,
      lowDaysRemaining: 5,
      lookbackDays: 30,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/low days threshold/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
