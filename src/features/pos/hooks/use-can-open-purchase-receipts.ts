"use client";

import { useRole } from "@/hooks/use-role";
import { canAccessPath } from "@/lib/navigation";

export type PosReceiptsAccessStatus = "loading" | "allowed" | "denied" | "error";

const PURCHASE_RECEIPTS_PATH = "/purchases/receipts";

/** Same rule as the Receipts page itself (route table, src/lib/navigation.ts). */
export function useCanOpenPurchaseReceipts(): { status: PosReceiptsAccessStatus } {
  const { role, loading } = useRole();

  if (loading) {
    return { status: "loading" };
  }
  if (role === null) {
    return { status: "error" };
  }
  return {
    status: canAccessPath(PURCHASE_RECEIPTS_PATH, role) ? "allowed" : "denied",
  };
}
