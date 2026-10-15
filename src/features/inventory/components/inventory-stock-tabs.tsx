import Link from "next/link";
import {
  INVENTORY_STOCK_TAB_HREF,
  INVENTORY_STOCK_TAB_LABELS,
  INVENTORY_STOCK_TABS,
  type InventoryStockTab,
} from "../utils/parse-inventory-tab";

type InventoryStockTabsProps = {
  activeTab: InventoryStockTab;
  /** False for sellers: the Write-offs and Requests tabs are not shown. */
  showWriteOffs?: boolean;
};

export function InventoryStockTabs({
  activeTab,
  showWriteOffs = true,
}: InventoryStockTabsProps) {
  const tabs: readonly InventoryStockTab[] = showWriteOffs
    ? INVENTORY_STOCK_TABS
    : INVENTORY_STOCK_TABS.filter(
        (tab) => tab !== "write-offs" && tab !== "requests",
      );
  const currentTab = tabs.includes(activeTab) ? activeTab : "raw-materials";

  return (
    <nav aria-label="Inventory stock domains">
      <ul className="flex gap-1 border-b border-zinc-200">
        {tabs.map((tab) => {
          const isActive = tab === currentTab;

          return (
            <li key={tab}>
              <Link
                href={INVENTORY_STOCK_TAB_HREF[tab]}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-amber-500 font-semibold text-zinc-900"
                    : "border-transparent font-medium text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                {INVENTORY_STOCK_TAB_LABELS[tab]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
