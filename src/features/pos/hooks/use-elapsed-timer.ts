"use client";

import { useEffect, useState } from "react";
import {
  elapsedMsSince,
  formatElapsedClock,
  QUEUE_TIMER_TICK_MS,
  queueWaitLevel,
  type QueueWaitLevel,
} from "../utils/queue-wait-timer";

export interface ElapsedTimerState {
  label: string;
  level: QueueWaitLevel;
}

function snapshot(startedAt: string | null, nowMs: number): ElapsedTimerState {
  const elapsedMs = startedAt ? elapsedMsSince(startedAt, nowMs) : 0;

  return {
    label: formatElapsedClock(elapsedMs),
    level: queueWaitLevel(elapsedMs),
  };
}

/**
 * Client-side mm:ss (or h:mm:ss) wait clock from a queue entry timestamp.
 * Ticks every QUEUE_TIMER_TICK_MS independently of the 15s kitchen poll.
 */
export function useElapsedTimer(startedAt: string | null): ElapsedTimerState {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowMs(Date.now());
    }, QUEUE_TIMER_TICK_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [startedAt]);

  return snapshot(startedAt, nowMs);
}
