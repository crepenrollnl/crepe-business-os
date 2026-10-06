"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { getPurchaseReceiptAccessToken } from "../utils/purchase-receipt-access-token";
import { requestDriveReceiptSync } from "../utils/request-drive-receipt-sync";

const MAX_ROUNDS = 5;

export function useDriveReceiptSync(enabled: boolean, onBatch?: () => void) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const onBatchRef = useRef(onBatch);
  const runId = useRef(0);

  useEffect(() => {
    onBatchRef.current = onBatch;
  }, [onBatch]);

  const run = useCallback(async () => {
    const id = ++runId.current;
    if (!enabled) {
      return;
    }

    let rounds = 0;
    while (rounds < MAX_ROUNDS) {
      const result = await requestDriveReceiptSync(getPurchaseReceiptAccessToken);
      if (id !== runId.current) {
        return;
      }
      rounds += 1;
      if (!result || !result.configured) {
        if (result && !result.configured) {
          setConfigured(false);
          setUnavailable(false);
        }
        return;
      }
      setConfigured(true);
      setUnavailable(!result.available);
      if (result.synced > 0) {
        onBatchRef.current?.();
      }
      if (!result.available || !(result.remaining > 0 && result.synced > 0)) {
        return;
      }
    }
  }, [enabled]);

  useAsyncEffect(() => {
    void run();
  }, [run]);

  const retryFiles = useCallback(async (fileIds: string[]) => {
    const result = await requestDriveReceiptSync(getPurchaseReceiptAccessToken, fileIds);
    if (!result) {
      return;
    }
    if (!result.configured) {
      setConfigured(false);
      setUnavailable(false);
      return;
    }
    setConfigured(true);
    setUnavailable(!result.available);
    onBatchRef.current?.();
  }, []);

  return { configured, unavailable, retryFiles };
}
