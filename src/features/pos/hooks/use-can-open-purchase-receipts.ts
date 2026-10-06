"use client";

import { useCallback, useState } from "react";
import { authService } from "@/features/auth/services/auth-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";

export type PosReceiptsAccessStatus = "loading" | "allowed" | "denied" | "error";

function canOpenPurchaseReceipts(role: string): boolean {
  return role === "owner" || role === "partner";
}

export function useCanOpenPurchaseReceipts(): { status: PosReceiptsAccessStatus } {
  const [status, setStatus] = useState<PosReceiptsAccessStatus>("loading");

  const loadRole = useCallback(async () => {
    setStatus("loading");
    try {
      const role = await authService.getMyRole();
      if (typeof role !== "string" || role.length === 0) {
        setStatus("error");
        return;
      }
      setStatus(canOpenPurchaseReceipts(role) ? "allowed" : "denied");
    } catch {
      setStatus("error");
    }
  }, []);

  useAsyncEffect(() => {
    void loadRole();
  }, [loadRole]);

  return { status };
}
