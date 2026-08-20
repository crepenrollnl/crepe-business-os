/**
 * Kitchen-queue hook: first load shows loading, background poll ticks do not.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedSale } from "@/features/sales/types/sale";

const {
  listQueuedSalesMock,
  markSaleFulfilledMock,
  getRecipesMock,
} = vi.hoisted(() => ({
  listQueuedSalesMock: vi.fn(),
  markSaleFulfilledMock: vi.fn(),
  getRecipesMock: vi.fn(),
}));

vi.mock("@/features/sales/services/sales-read-service", () => ({
  salesReadService: {
    listQueuedSales: (...args: unknown[]) => listQueuedSalesMock(...args),
  },
}));

vi.mock("@/features/sales/services/sales-service", () => ({
  salesService: {
    markSaleFulfilled: (...args: unknown[]) => markSaleFulfilledMock(...args),
  },
}));

vi.mock("@/features/recipes/services/recipe-service", () => ({
  recipeService: {
    getRecipes: (...args: unknown[]) => getRecipesMock(...args),
  },
}));

import { POS_QUEUE_POLL_MS, usePosQueue } from "./use-pos-queue";

const SALE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function queuedSale(overrides?: Partial<QueuedSale>): QueuedSale {
  return {
    sale_id: SALE_ID,
    sale_number: "S-000034",
    confirmed_at: "2026-08-20T08:00:00.000Z",
    total: 28.5,
    lines: [
      {
        product_id: PRODUCT_ID,
        quantity: 3,
      },
    ],
    ...overrides,
  };
}

describe("usePosQueue", () => {
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  let pollTick: (() => void) | null;
  const pollTimerIds = new Set<number>();

  beforeEach(() => {
    vi.clearAllMocks();
    pollTick = null;
    pollTimerIds.clear();
    listQueuedSalesMock.mockResolvedValue({
      data: [queuedSale()],
      error: null,
    });
    markSaleFulfilledMock.mockResolvedValue({
      data: { id: SALE_ID },
      error: null,
    });
    getRecipesMock.mockResolvedValue({
      data: [{ id: PRODUCT_ID, name: "Chicken Crepe" }],
      error: null,
    });

    globalThis.setInterval = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === POS_QUEUE_POLL_MS && typeof handler === "function") {
        pollTick = handler as () => void;
        const id = 15_000;
        pollTimerIds.add(id);
        return id;
      }

      return realSetInterval(handler, delay, ...args);
    }) as typeof setInterval;

    globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
      if (typeof id === "number" && pollTimerIds.has(id)) {
        pollTimerIds.delete(id);
        pollTick = null;
        return;
      }

      realClearInterval(id);
    }) as typeof clearInterval;
  });

  afterEach(() => {
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });

  it("loads the queue on mount and resolves recipe names once", async () => {
    const { result } = renderHook(() => usePosQueue());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items[0]?.lines[0]?.name).toBe("Chicken Crepe");
    });

    expect(listQueuedSalesMock).toHaveBeenCalledTimes(1);
    expect(getRecipesMock).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([
      {
        sale_id: SALE_ID,
        sale_number: "S-000034",
        confirmed_at: "2026-08-20T08:00:00.000Z",
        total: 28.5,
        lines: [
          {
            product_id: PRODUCT_ID,
            quantity: 3,
            name: "Chicken Crepe",
          },
        ],
      },
    ]);
    expect(result.current.error).toBeNull();
  });

  it("does not flip loading=true on a background poll tick", async () => {
    const { result } = renderHook(() => usePosQueue());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listQueuedSalesMock).toHaveBeenCalledTimes(1);
    expect(pollTick).not.toBeNull();

    listQueuedSalesMock.mockResolvedValue({
      data: [queuedSale({ sale_number: "S-000035" })],
      error: null,
    });

    await act(async () => {
      pollTick?.();
    });

    await waitFor(() => {
      expect(listQueuedSalesMock).toHaveBeenCalledTimes(2);
    });

    expect(result.current.loading).toBe(false);
    expect(getRecipesMock).toHaveBeenCalledTimes(1);
    expect(result.current.items[0]?.sale_number).toBe("S-000035");
  });

  it("removes a ticket from the local list after markFulfilled succeeds", async () => {
    const { result } = renderHook(() => usePosQueue());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);

    await act(async () => {
      await result.current.markFulfilled(SALE_ID);
    });

    expect(markSaleFulfilledMock).toHaveBeenCalledWith(SALE_ID);
    expect(result.current.items).toEqual([]);
    expect(result.current.actionError).toBeNull();
  });
});
