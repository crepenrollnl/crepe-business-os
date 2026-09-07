"use client";

import { useElapsedTimer } from "../hooks/use-elapsed-timer";
import { QUEUE_WAIT_LEVEL_CLASS } from "../utils/queue-wait-timer";

type PosQueueWaitTimerProps = {
  startedAt: string;
};

export function PosQueueWaitTimer({ startedAt }: PosQueueWaitTimerProps) {
  const { label, level } = useElapsedTimer(startedAt);

  return (
    <time
      dateTime={startedAt}
      aria-label={`Waiting ${label}`}
      className={`mt-1 block text-4xl font-semibold tabular-nums tracking-tight ${QUEUE_WAIT_LEVEL_CLASS[level]}`}
    >
      {label}
    </time>
  );
}
