import { describe, expect, it } from "vitest";
import {
  formatMovementQuantity,
  formatMovementType,
  movementDocumentLink,
} from "./format-movement-history";

const PURCHASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SALE_LINE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("formatMovementType", () => {
  it("maps known movement types to display labels", () => {
    expect(formatMovementType("purchase_in")).toBe("Received");
    expect(formatMovementType("production_out")).toBe("Used in production");
    expect(formatMovementType("sale_out")).toBe("Sold with product");
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
});
