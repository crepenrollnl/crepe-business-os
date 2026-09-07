import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEUE_TIMER_TICK_MS } from "../utils/queue-wait-timer";
import { useElapsedTimer } from "./use-elapsed-timer";

const STARTED_AT = "2026-08-20T08:00:00.000Z";

describe("useElapsedTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T08:03:45.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats the wait from startedAt as m:ss on the first render", () => {
    const { result } = renderHook(() => useElapsedTimer(STARTED_AT));

    expect(result.current.label).toBe("3:45");
    expect(result.current.level).toBe("normal");
  });

  it("ticks up every second without waiting for the 15s queue poll", () => {
    const { result } = renderHook(() => useElapsedTimer(STARTED_AT));

    act(() => {
      vi.advanceTimersByTime(QUEUE_TIMER_TICK_MS);
    });

    expect(result.current.label).toBe("3:46");

    act(() => {
      vi.advanceTimersByTime(14_000);
    });

    expect(result.current.label).toBe("4:00");
    expect(result.current.level).toBe("normal");
  });

  it("crosses warning at exactly 5 minutes and critical at exactly 10", () => {
    vi.setSystemTime(new Date("2026-08-20T08:04:59.000Z"));
    const { result } = renderHook(() => useElapsedTimer(STARTED_AT));

    expect(result.current.label).toBe("4:59");
    expect(result.current.level).toBe("normal");

    act(() => {
      vi.advanceTimersByTime(QUEUE_TIMER_TICK_MS);
    });

    expect(result.current.label).toBe("5:00");
    expect(result.current.level).toBe("warning");

    act(() => {
      vi.advanceTimersByTime(5 * 60 * QUEUE_TIMER_TICK_MS - QUEUE_TIMER_TICK_MS);
    });

    expect(result.current.label).toBe("9:59");
    expect(result.current.level).toBe("warning");

    act(() => {
      vi.advanceTimersByTime(QUEUE_TIMER_TICK_MS);
    });

    expect(result.current.label).toBe("10:00");
    expect(result.current.level).toBe("critical");
  });

  it("switches to h:mm:ss after an hour", () => {
    vi.setSystemTime(new Date("2026-08-20T09:05:30.000Z"));
    const { result } = renderHook(() => useElapsedTimer(STARTED_AT));

    expect(result.current.label).toBe("1:05:30");
    expect(result.current.level).toBe("critical");
  });

  it("clamps invalid or future startedAt to 0:00 normal", () => {
    const invalid = renderHook(() => useElapsedTimer("not-a-timestamp"));
    expect(invalid.result.current.label).toBe("0:00");
    expect(invalid.result.current.level).toBe("normal");

    const future = renderHook(() => useElapsedTimer("2026-08-20T10:00:00.000Z"));
    expect(future.result.current.label).toBe("0:00");
    expect(future.result.current.level).toBe("normal");

    const missing = renderHook(() => useElapsedTimer(null));
    expect(missing.result.current.label).toBe("0:00");
    expect(missing.result.current.level).toBe("normal");
  });
});
