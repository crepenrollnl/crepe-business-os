import { describe, expect, it } from "vitest";
import {
  MOVEMENT_HISTORY_STOCK_WARNING,
  formatMovementQuantity,
  formatMovementType,
  movementDocumentLink,
} from "./format-movement-history";

describe("MOVEMENT_HISTORY_STOCK_WARNING", () => {
  it("lists recorded stock adjustments and does not treat hand-typed card qty as the normal path", () => {
    expect(MOVEMENT_HISTORY_STOCK_WARNING).toContain("stock adjustments");
    expect(MOVEMENT_HISTORY_STOCK_WARNING).not.toMatch(/typed in by hand/i);
  });
});

const PURCHASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SALE_LINE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("formatMovementType", () => {
  it("maps known movement types to display labels", () => {
    expect(formatMovementType("purchase_in")).toBe("Received");
    expect(formatMovementType("production_out")).toBe("Used in production");
    expect(formatMovementType("sale_out")).toBe("Sold with product");
    expect(formatMovementType("waste_out")).toBe("Written off");
    expect(formatMovementType("adjustment_increase")).toBe("Stock increase");
    expect(formatMovementType("adjustment_decrease")).toBe("Stock decrease");
  });

  it("returns the raw code for an unknown movement type", () => {
    expect(formatMovementType("adjustment")).toBe("adjustment");
  });
});

describe("formatMovementQuantity", () => {
  it("prefixes inflows with + and outflows with −, including the unit", () => {
    expect(formatMovementQuantity(10, "kg", "purchase_in")).toBe("+10 kg");
    expect(formatMovementQuantity(29.75, "kg", "production_out")).toBe(
      "−29.75 kg",
    );
    expect(formatMovementQuantity(0.5, "kg", "sale_out")).toBe("−0.5 kg");
    expect(formatMovementQuantity(2, "kg", "waste_out")).toBe("−2 kg");
    expect(formatMovementQuantity(5, "kg", "adjustment_increase")).toBe(
      "+5 kg",
    );
    expect(formatMovementQuantity(3, "kg", "adjustment_decrease")).toBe(
      "−3 kg",
    );
  });

  it("does not invent a sign for an unknown movement type", () => {
    expect(formatMovementQuantity(5, "kg", "adjustment")).toBe("5 kg");
  });
});

describe("movementDocumentLink", () => {
  it("deep-links a purchase with ?open=", () => {
    expect(movementDocumentLink("purchase", PURCHASE_ID)).toEqual({
      label: "Purchase",
      href: `/purchases?open=${PURCHASE_ID}`,
    });
  });

  it("links a production session to its session page", () => {
    expect(movementDocumentLink("production_session", SESSION_ID)).toEqual({
      label: "Production session",
      href: `/production-execution/sessions/${SESSION_ID}`,
    });
  });

  it("labels a sale without an href (source_id is the sale line, not the sale)", () => {
    expect(movementDocumentLink("sale", SALE_LINE_ID)).toEqual({
      label: "Sale",
      href: null,
    });
  });

  it("links a write-off to the Inventory Write-offs tab", () => {
    expect(movementDocumentLink("write_off", "wo-1")).toEqual({
      label: "Write-off",
      href: "/inventory?tab=write-offs",
    });
  });

  it("labels an inventory adjustment without an href (no list page yet)", () => {
    expect(movementDocumentLink("inventory_adjustment", "adj-1")).toEqual({
      label: "Stock adjustment",
      href: null,
    });
  });
});
