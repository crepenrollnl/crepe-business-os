"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PosHistoryPane } from "../components/pos-history-pane";
import { PosQueuePane } from "../components/pos-queue-pane";
import { PosSalePane } from "../components/pos-sale-pane";
import { PosShell } from "../components/pos-shell";
import { PosShiftPane } from "../components/pos-shift-pane";
import { PosStockPane } from "../components/pos-stock-pane";
import { parsePosTab, type PosTab } from "../components/pos-tab-nav";
import { usePosQueue } from "../hooks/use-pos-queue";

export function PosPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = parsePosTab(searchParams.get("tab"));
  const queue = usePosQueue();

  const onTabChange = useCallback(
    (tab: PosTab) => {
      router.replace(`/pos?tab=${tab}`, { scroll: false });
    },
    [router],
  );

  return (
    <PosShell
      activeTab={activeTab}
      onTabChange={onTabChange}
      queueCount={queue.items.length}
    >
      {activeTab === "sale" ? <PosSalePane /> : null}
      {activeTab === "queue" ? (
        <PosQueuePane
          items={queue.items}
          loading={queue.loading}
          error={queue.error}
          actionError={queue.actionError}
          fulfillingId={queue.fulfillingId}
          onRetry={() => {
            void queue.retry();
          }}
          onMarkFulfilled={(saleId) => {
            void queue.markFulfilled(saleId);
          }}
        />
      ) : null}
      {activeTab === "shift" ? <PosShiftPane /> : null}
      {activeTab === "history" ? <PosHistoryPane /> : null}
      {activeTab === "stock" ? <PosStockPane /> : null}
    </PosShell>
  );
}
