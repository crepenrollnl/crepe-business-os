/**
 * Hook coverage for useGlobalSearch (DEV-047).
 *
 * Debounces input and calls only globalSearchService.search.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "../types/search";

const searchMock = vi.fn();

vi.mock("../services/global-search-service", () => ({
  globalSearchService: {
    search: (...args: unknown[]) => searchMock(...args),
  },
}));

import { useGlobalSearch } from "./use-global-search";

const SAMPLE_RESULT: SearchResult = {
  entityType: "ingredient",
  entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "ING-001",
  title: "Flour",
  subtitle: "kg",
  status: "ok",
};

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useGlobalSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not call search when query length is less than 2", async () => {
    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("a");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(searchMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.hasSearched).toBe(false);
    expect(result.current.results).toEqual([]);
  });

  it("debounces 300ms before calling search", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("fl");
    });

    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(searchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flushMicrotasks();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("fl");
  });

  it("sets loading true while the search is pending", async () => {
    let resolveSearch!: (value: {
      data: SearchResult[] | null;
      error: string | null;
    }) => void;

    searchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("flour");
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(result.current.loading).toBe(true);
    expect(searchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSearch({ data: [SAMPLE_RESULT], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.results).toEqual([SAMPLE_RESULT]);
  });

  it("maps empty results to hasSearched true and results []", async () => {
    searchMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("zz");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(result.current.hasSearched).toBe(true);
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("maps service errors onto error state", async () => {
    searchMock.mockResolvedValue({
      data: null,
      error: "Global search is not available yet.",
    });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("flour");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(result.current.error).toBe("Global search is not available yet.");
    expect(result.current.results).toEqual([]);
    expect(result.current.hasSearched).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("returns successful SearchResult DTOs as-is", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("flour");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(result.current.results).toEqual([SAMPLE_RESULT]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasSearched).toBe(true);
  });

  it("clear() resets the query and search state", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    const { result } = renderHook(() => useGlobalSearch());

    act(() => {
      result.current.setQuery("flour");
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(result.current.results).toHaveLength(1);

    act(() => {
      result.current.clear();
    });

    expect(result.current.query).toBe("");
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.hasSearched).toBe(false);
  });
});
