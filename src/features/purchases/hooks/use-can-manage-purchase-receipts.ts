"use client";

import { useCallback, useState } from "react";
import { authService } from "@/features/auth/services/auth-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { canManagePurchaseReceipts } from "../types/purchase-receipt";

export type PurchaseReceiptAccessStatus = "loading" | "allowed" | "denied" | "error";

export function useCanManagePurchaseReceipts(): {
  status: PurchaseReceiptAccessStatus;
  retry: () => void;
} {
  const [status, setStatus] = useState<PurchaseReceiptAccessStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  const loadRole = useCallback(async () => {
    setStatus("loading");
    try {
      const role = await authService.getMyRole();
      if (typeof role !== "string" || role.length === 0) {
        setStatus("error");
        return;
      }
      setStatus(canManagePurchaseReceipts(role) ? "allowed" : "denied");
    } catch {
      setStatus("error");
    }
  }, []);

  useAsyncEffect(() => {
    void loadRole();
  }, [loadRole, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return { status, retry };
}
