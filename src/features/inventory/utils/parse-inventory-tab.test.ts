import { describe, expect, it } from "vitest";
import {
  INVENTORY_STOCK_TAB_HREF,
  inventoryTabSearchParam,
  parseInventoryStockTab,
} from "./parse-inventory-tab";

describe("parseInventoryStockTab", () => {
  it("defaults to raw materials when the query is missing or unknown", () => {
    expect(parseInventoryStockTab(null)).toBe("raw-materials");
    expect(parseInventoryStockTab("")).toBe("raw-materials");
    expect(parseInventoryStockTab("raw-materials")).toBe("raw-materials");
    expect(parseInventoryStockTab("unknown")).toBe("raw-materials");
  });

  it("opens Finished Goods only for ?tab=finished-goods", () => {
    expect(parseInventoryStockTab("finished-goods")).toBe("finished-goods");
    expect(INVENTORY_STOCK_TAB_HREF["finished-goods"]).toBe(
      "/inventory?tab=finished-goods",
    );
    expect(INVENTORY_STOCK_TAB_HREF["raw-materials"]).toBe("/inventory");
  });

  it("reads the first tab value from Next.js searchParams", () => {
    expect(inventoryTabSearchParam(undefined)).toBeNull();
    expect(inventoryTabSearchParam("finished-goods")).toBe("finished-goods");
    expect(inventoryTabSearchParam(["finished-goods", "other"])).toBe(
      "finished-goods",
    );
    expect(inventoryTabSearchParam([])).toBeNull();
  });
});
