"use client";

import { useCallback, useMemo, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { writeOffRequestService } from "../services/write-off-request-service";
import type { WriteOffRequest } from "../types/write-off-request";
import { notifyWriteOffRequestsChanged } from "../utils/write-off-request-events";

/**
 * Write-off requests list plus the owner/partner decisions. Sellers get
 * only their own rows (RLS); approve/reject are refused for them by the
 * database anyway and the page never offers them.
 */
export function useWriteOffRequests() {
  const [items, setItems] = useState<WriteOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    const result = await writeOffRequestService.listRequests();

    if (result.error || !result.data) {
      setError(result.error ?? "Failed to load write-off requests");
      return;
    }

    setItems(result.data);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await fetchList();
    setLoading(false);
  }, [fetchList]);

  useAsyncEffect(load, [load]);

  const clearRowError = (id: string) => {
    setRowErrors((current) => {
      if (!(id in current)) {
        return current;
      }
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const decide = useCallback(
    async (
      id: string,
      run: () => Promise<{ error: string | null }>,
      successNotice: string,
    ) => {
      setBusyId(id);
      setNotice(null);
      clearRowError(id);

      const result = await run();

      if (result.error) {
        // The request stays pending on the server; keep the row and show why.
        setRowErrors((current) => ({ ...current, [id]: result.error ?? "" }));
        setBusyId(null);
        return false;
      }

      setNotice(successNotice);
      await fetchList();
      notifyWriteOffRequestsChanged();
      setBusyId(null);
      return true;
    },
    [fetchList],
  );

  /** quantity null = approve as requested. */
  const approve = useCallback(
    (id: string, quantity: number | null) =>
      decide(id, () => writeOffRequestService.approve(id, quantity), "Approved — stock written off."),
    [decide],
  );

  const reject = useCallback(
    (id: string, note: string | null) =>
      decide(id, () => writeOffRequestService.reject(id, note), "Request rejected."),
    [decide],
  );

  const pending = useMemo(
    () => items.filter((item) => item.status === "pending"),
    [items],
  );
  const decided = useMemo(
    () => items.filter((item) => item.status !== "pending"),
    [items],
  );
  const mine = useMemo(() => items.filter((item) => item.is_mine), [items]);

  return {
    items,
    pending,
    decided,
    mine,
    loading,
    error,
    busyId,
    rowErrors,
    notice,
    approve,
    reject,
    reload: fetchList,
    retry: load,
  };
}
