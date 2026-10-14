"use client";

import { useCallback, useState } from "react";
import { authService } from "@/features/auth/services/auth-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { isNavItemVisible, navItems } from "@/lib/navigation";
import { postingFailuresService } from "../services/posting-failures-service";
import type { PostingFailure } from "../types/posting-failure";

const POSTING_FAILURES_HREF = "/reports/posting-failures";

/**
 * Same role rule as the sidebar link (src/lib/navigation.ts), so the page and
 * the menu never disagree about who may see posting failures.
 */
function canViewPostingFailures(role: string | null): boolean {
  const item = navItems.find((navItem) => navItem.href === POSTING_FAILURES_HREF);
  return item ? isNavItemVisible(item, role) : false;
}

export type PostingFailuresAccess = "loading" | "allowed" | "denied";

export function usePostingFailures() {
  const [items, setItems] = useState<PostingFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<PostingFailuresAccess>("loading");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [repostingId, setRepostingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    const result = await postingFailuresService.listUnresolved();

    if (result.error || !result.data) {
      setItems([]);
      setError(result.error ?? "Failed to load posting failures");
      return;
    }

    setItems(result.data);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setActionError(null);

    const role = await authService.getMyRole();
    if (!canViewPostingFailures(role)) {
      setAccess("denied");
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    setAccess("allowed");
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

  const resolve = useCallback(async (id: string, note: string) => {
    setResolvingId(id);
    setActionError(null);
    setNotice(null);

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

  /**
   * "Post again" (sql/154). The database may close several rows at once
   * (repeated failures, the parts of one dish write-off), so the list is
   * reloaded on success. A failure stays on its row with the message.
   */
  const repost = useCallback(
    async (id: string) => {
      setRepostingId(id);
      setActionError(null);
      setNotice(null);
      clearRowError(id);

      const result = await postingFailuresService.repost(id);

      if (result.error || !result.data) {
        setRowErrors((current) => ({
          ...current,
          [id]: result.error ?? "Failed to post again",
        }));
        setRepostingId(null);
        return false;
      }

      setNotice(
        result.data.status === "posted"
          ? "Posted"
          : "Nothing to post — closed",
      );
      await fetchList();
      setRepostingId(null);
      return true;
    },
    [fetchList],
  );

  return {
    items,
    loading,
    error,
    access,
    resolvingId,
    repostingId,
    actionError,
    rowErrors,
    notice,
    resolve,
    repost,
    retry: load,
  };
}
