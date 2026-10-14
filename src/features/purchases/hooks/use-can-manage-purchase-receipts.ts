"use client";

import { useRole } from "@/hooks/use-role";
import { canAccessPath } from "@/lib/navigation";

export type PurchaseReceiptAccessStatus = "loading" | "allowed" | "denied" | "error";

const PURCHASE_RECEIPTS_PATH = "/purchases/receipts";

/**
 * Same rule as the Receipts page (route table, src/lib/navigation.ts). The
 * API routes check the role again on the server (canManagePurchaseReceipts).
 */
export function useCanManagePurchaseReceipts(): {
  status: PurchaseReceiptAccessStatus;
  retry: () => void;
} {
  const { role, loading, reload } = useRole();

  if (loading) {
    return { status: "loading", retry: reload };
  }
  if (role === null) {
    return { status: "error", retry: reload };
  }
  return {
    status: canAccessPath(PURCHASE_RECEIPTS_PATH, role) ? "allowed" : "denied",
    retry: reload,
  };
}
