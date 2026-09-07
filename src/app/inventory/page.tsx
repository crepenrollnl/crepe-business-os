import { AuthGuard } from "@/features/auth/components/auth-guard";
import { FinishedGoodsPage } from "@/features/finished-goods/page/finished-goods-page";
import { InventoryWorkspacePage } from "@/features/inventory/page/inventory-workspace-page";
import {
  inventoryTabSearchParam,
  parseInventoryStockTab,
} from "@/features/inventory/utils/parse-inventory-tab";
import { WriteOffsPage } from "@/features/write-offs/page/write-offs-page";
import { parseWriteOffPrefillItemType } from "@/features/write-offs/utils/write-off-href";

interface InventoryRoutePageProps {
  searchParams: Promise<{
    tab?: string | string[];
    itemType?: string | string[];
    id?: string | string[];
  }>;
}

export default async function Page({ searchParams }: InventoryRoutePageProps) {
  const params = await searchParams;
  const activeTab = parseInventoryStockTab(inventoryTabSearchParam(params.tab));
  const prefillItemType = parseWriteOffPrefillItemType(
    inventoryTabSearchParam(params.itemType),
  );
  const prefillItemId = inventoryTabSearchParam(params.id);

  return (
    <AuthGuard>
      <InventoryWorkspacePage
        activeTab={activeTab}
        finishedGoods={<FinishedGoodsPage embedded />}
        writeOffs={
          <WriteOffsPage
            embedded
            prefillItemType={prefillItemType}
            prefillItemId={prefillItemId}
          />
        }
      />
    </AuthGuard>
  );
}
