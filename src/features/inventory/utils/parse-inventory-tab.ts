export const INVENTORY_STOCK_TABS = [
  "raw-materials",
  "finished-goods",
  "write-offs",
  "requests",
] as const;

export type InventoryStockTab = (typeof INVENTORY_STOCK_TABS)[number];

export const INVENTORY_STOCK_TAB_LABELS: Record<InventoryStockTab, string> = {
  "raw-materials": "Raw Materials",
  "finished-goods": "Finished Goods",
  "write-offs": "Write-offs",
  requests: "Requests",
};

export const INVENTORY_STOCK_TAB_HREF: Record<InventoryStockTab, string> = {
  "raw-materials": "/inventory",
  "finished-goods": "/inventory?tab=finished-goods",
  "write-offs": "/inventory?tab=write-offs",
  requests: "/inventory?tab=requests",
};

export function parseInventoryStockTab(
  value: string | null,
): InventoryStockTab {
  if (value === "finished-goods") {
    return "finished-goods";
  }

  if (value === "write-offs") {
    return "write-offs";
  }

  if (value === "requests") {
    return "requests";
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
