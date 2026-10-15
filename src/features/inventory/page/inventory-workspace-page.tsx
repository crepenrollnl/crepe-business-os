"use client";

import type { ReactNode } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useRole } from "@/hooks/use-role";
import { canSeeCosts } from "@/lib/roles";
import { InventoryStockTabs } from "../components/inventory-stock-tabs";
import type { InventoryStockTab } from "../utils/parse-inventory-tab";
import { InventoryPage } from "./inventory-page";

type InventoryWorkspacePageProps = {
  activeTab: InventoryStockTab;
  finishedGoods: ReactNode;
  writeOffs: ReactNode;
  /** Owner/partner queue of write-off requests (sql/157). */
  writeOffRequests: ReactNode;
};

export function InventoryWorkspacePage({
  activeTab,
  finishedGoods,
  writeOffs,
  writeOffRequests,
}: InventoryWorkspacePageProps) {
  // Sellers record no write-offs (record_write_off is owner/partner only,
  // sql/127, sql/148) and decide no requests; they ask on /write-off-requests.
  const { role } = useRole();
  const showWriteOffs = canSeeCosts(role);

  return (
    <DashboardLayout activePath="/inventory">
      <div className="mx-auto max-w-7xl space-y-8">
        <InventoryStockTabs
          activeTab={activeTab}
          showWriteOffs={showWriteOffs}
        />
        {activeTab === "finished-goods" ? (
          finishedGoods
        ) : activeTab === "write-offs" && showWriteOffs ? (
          writeOffs
        ) : activeTab === "requests" && showWriteOffs ? (
          writeOffRequests
        ) : (
          <InventoryPage embedded />
        )}
      </div>
    </DashboardLayout>
  );
}
