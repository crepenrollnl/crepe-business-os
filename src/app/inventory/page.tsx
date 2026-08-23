import { AuthGuard } from "@/features/auth/components/auth-guard";
import { FinishedGoodsPage } from "@/features/finished-goods/page/finished-goods-page";
import { InventoryWorkspacePage } from "@/features/inventory/page/inventory-workspace-page";
import {
  inventoryTabSearchParam,
  parseInventoryStockTab,
} from "@/features/inventory/utils/parse-inventory-tab";

interface InventoryRoutePageProps {
  searchParams: Promise<{ tab?: string | string[] }>;
}

export default async function Page({ searchParams }: InventoryRoutePageProps) {
  const params = await searchParams;
  const activeTab = parseInventoryStockTab(inventoryTabSearchParam(params.tab));

  return (
    <AuthGuard>
      <InventoryWorkspacePage
        activeTab={activeTab}
        finishedGoods={<FinishedGoodsPage embedded />}
      />
    </AuthGuard>
  );
}
