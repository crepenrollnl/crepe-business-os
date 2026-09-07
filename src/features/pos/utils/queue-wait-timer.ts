export const QUEUE_TIMER_WARNING_MINUTES = 5;
export const QUEUE_TIMER_CRITICAL_MINUTES = 10;
export const QUEUE_TIMER_TICK_MS = 1_000;

export type QueueWaitLevel = "normal" | "warning" | "critical";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3_600;

export function elapsedMsSince(startedAt: string, nowMs: number): number {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
    return 0;
  }

  return Math.max(0, nowMs - startMs);
}

export function formatElapsedClock(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(safeMs / MS_PER_SECOND);
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor(
    (totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }

  return `${minutes}:${paddedSeconds}`;
}

export function queueWaitLevel(elapsedMs: number): QueueWaitLevel {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const elapsedMinutes = safeMs / (MS_PER_SECOND * SECONDS_PER_MINUTE);

  if (elapsedMinutes >= QUEUE_TIMER_CRITICAL_MINUTES) {
    return "critical";
  }

  if (elapsedMinutes >= QUEUE_TIMER_WARNING_MINUTES) {
    return "warning";
  }

  return "normal";
}

export const QUEUE_WAIT_LEVEL_CLASS: Record<QueueWaitLevel, string> = {
  normal: "text-zinc-900",
  warning: "text-yellow-600",
  critical: "text-red-600",
};
