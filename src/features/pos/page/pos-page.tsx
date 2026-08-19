"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PosHistoryPane } from "../components/pos-history-pane";
import { PosSalePane } from "../components/pos-sale-pane";
import { PosShell } from "../components/pos-shell";
import { PosShiftPane } from "../components/pos-shift-pane";
import { PosStockPane } from "../components/pos-stock-pane";
import { parsePosTab, type PosTab } from "../components/pos-tab-nav";

export function PosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = parsePosTab(searchParams.get("tab"));

  const onTabChange = useCallback(
    (tab: PosTab) => {
      router.replace(`/pos?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  return (
    <PosShell activeTab={activeTab} onTabChange={onTabChange}>
      {activeTab === "sale" ? <PosSalePane /> : null}
      {activeTab === "shift" ? <PosShiftPane /> : null}
      {activeTab === "history" ? <PosHistoryPane /> : null}
      {activeTab === "stock" ? <PosStockPane /> : null}
    </PosShell>
  );
}
