export const INVENTORY_STOCK_TABS = [
  "raw-materials",
  "finished-goods",
] as const;

export type InventoryStockTab = (typeof INVENTORY_STOCK_TABS)[number];

export const INVENTORY_STOCK_TAB_LABELS: Record<InventoryStockTab, string> = {
  "raw-materials": "Raw Materials",
  "finished-goods": "Finished Goods",
};

export const INVENTORY_STOCK_TAB_HREF: Record<InventoryStockTab, string> = {
  "raw-materials": "/inventory",
  "finished-goods": "/inventory?tab=finished-goods",
};

export function parseInventoryStockTab(
  value: string | null,
): InventoryStockTab {
  if (value === "finished-goods") {
    return "finished-goods";
  }

  return "raw-materials";
}

export function inventoryTabSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
