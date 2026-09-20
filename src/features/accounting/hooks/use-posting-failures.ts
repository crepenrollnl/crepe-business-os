"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { postingFailuresService } from "../services/posting-failures-service";
import type { PostingFailure } from "../types/posting-failure";

export function usePostingFailures() {
  const [items, setItems] = useState<PostingFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    const result = await postingFailuresService.listUnresolved();

    if (result.error || !result.data) {
      setItems([]);
      setError(result.error ?? "Failed to load posting failures");
      setLoading(false);
      return;
    }

    setItems(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useAsyncEffect(load, [load]);

  const resolve = useCallback(async (id: string, note: string) => {
    setResolvingId(id);
    setActionError(null);

    const result = await postingFailuresService.resolve(id, note);

    if (result.error) {
      setActionError(result.error);
      setResolvingId(null);
      return false;
    }

    setItems((current) => current.filter((item) => item.id !== id));
    setResolvingId(null);
    return true;
  }, []);

  return {
    items,
    loading,
    error,
    resolvingId,
    actionError,
    resolve,
    retry: load,
  };
}
