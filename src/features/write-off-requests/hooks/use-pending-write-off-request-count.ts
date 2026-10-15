"use client";

import { useCallback, useEffect, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { writeOffRequestService } from "../services/write-off-request-service";
import { WRITE_OFF_REQUESTS_CHANGED_EVENT } from "../utils/write-off-request-events";

/**
 * Pending write-off requests for the menu counter. Only reads when
 * `enabled` (owner/partner) — a seller never asks. Read on mount (the menu
 * mounts with every page, so on every route change) and again whenever a
 * request is sent, approved or rejected. No realtime subscription.
 */
export function usePendingWriteOffRequestCount(enabled: boolean): number {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const result = await writeOffRequestService.countPending();
    setCount(result.error || result.data === null ? 0 : result.data);
  }, [enabled]);

  useAsyncEffect(load, [load]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onChanged = () => {
      void load();
    };
    window.addEventListener(WRITE_OFF_REQUESTS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(WRITE_OFF_REQUESTS_CHANGED_EVENT, onChanged);
    };
  }, [enabled, load]);

  return enabled ? count : 0;
}
