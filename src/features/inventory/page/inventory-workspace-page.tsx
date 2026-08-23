import type { ReactNode } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { InventoryStockTabs } from "../components/inventory-stock-tabs";
import type { InventoryStockTab } from "../utils/parse-inventory-tab";
import { InventoryPage } from "./inventory-page";

type InventoryWorkspacePageProps = {
  activeTab: InventoryStockTab;
  finishedGoods: ReactNode;
};

export function InventoryWorkspacePage({
  activeTab,
  finishedGoods,
}: InventoryWorkspacePageProps) {
  return (
    <DashboardLayout activePath="/inventory">
      <div className="mx-auto max-w-7xl space-y-8">
        <InventoryStockTabs activeTab={activeTab} />
        {activeTab === "finished-goods" ? (
          finishedGoods
        ) : (
          <InventoryPage embedded />
        )}
      </div>
    </DashboardLayout>
  );
}
