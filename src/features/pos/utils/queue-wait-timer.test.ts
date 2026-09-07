import { describe, expect, it } from "vitest";
import {
  elapsedMsSince,
  formatElapsedClock,
  QUEUE_TIMER_CRITICAL_MINUTES,
  QUEUE_TIMER_WARNING_MINUTES,
  queueWaitLevel,
} from "./queue-wait-timer";

const MINUTE_MS = 60_000;
const WARNING_MS = QUEUE_TIMER_WARNING_MINUTES * MINUTE_MS;
const CRITICAL_MS = QUEUE_TIMER_CRITICAL_MINUTES * MINUTE_MS;

describe("elapsedMsSince", () => {
  it("returns the positive delta from startedAt to now", () => {
    expect(
      elapsedMsSince("2026-08-20T08:00:00.000Z", Date.parse("2026-08-20T08:03:45.000Z")),
    ).toBe(225_000);
  });

  it("clamps a future startedAt to zero instead of a negative wait", () => {
    expect(
      elapsedMsSince("2026-08-20T08:01:00.000Z", Date.parse("2026-08-20T08:00:00.000Z")),
    ).toBe(0);
  });

  it("returns zero for an invalid startedAt", () => {
    expect(elapsedMsSince("not-a-timestamp", Date.parse("2026-08-20T08:00:00.000Z"))).toBe(
      0,
    );
  });
});

describe("formatElapsedClock", () => {
  it("formats under an hour as m:ss without padding minutes", () => {
    expect(formatElapsedClock(225_000)).toBe("3:45");
    expect(formatElapsedClock(0)).toBe("0:00");
    expect(formatElapsedClock(5_000)).toBe("0:05");
    expect(formatElapsedClock(59_000)).toBe("0:59");
    expect(formatElapsedClock(60_000)).toBe("1:00");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatElapsedClock(3_930_000)).toBe("1:05:30");
    expect(formatElapsedClock(3_600_000)).toBe("1:00:00");
    expect(formatElapsedClock(90_000_000)).toBe("25:00:00");
  });

  it("does not emit NaN or a negative clock for broken input", () => {
    expect(formatElapsedClock(Number.NaN)).toBe("0:00");
    expect(formatElapsedClock(-90_000)).toBe("0:00");
  });
});

describe("queueWaitLevel", () => {
  it("stays normal below the 5-minute warning boundary", () => {
    expect(queueWaitLevel(WARNING_MS - 1)).toBe("normal");
  });

  it("switches to warning at exactly 5 minutes", () => {
    expect(queueWaitLevel(WARNING_MS)).toBe("warning");
    expect(queueWaitLevel(CRITICAL_MS - 1)).toBe("warning");
  });

  it("switches to critical at exactly 10 minutes", () => {
    expect(queueWaitLevel(CRITICAL_MS)).toBe("critical");
    expect(queueWaitLevel(CRITICAL_MS + MINUTE_MS)).toBe("critical");
  });

  it("treats invalid elapsed as normal", () => {
    expect(queueWaitLevel(Number.NaN)).toBe("normal");
    expect(queueWaitLevel(-1)).toBe("normal");
  });
});
