import { describe, expect, it } from "vitest";
import {
  formatPurchaseTaxCategoryLabel,
  formatPurchaseTaxRegimeLabel,
  PURCHASE_TAX_CATEGORY_OPTIONS,
  PURCHASE_TAX_REGIME_OPTIONS,
} from "./purchase-tax";

describe("purchase tax dropdown labels", () => {
  it("labels every category code for the UI", () => {
    expect(
      PURCHASE_TAX_CATEGORY_OPTIONS.map(formatPurchaseTaxCategoryLabel),
    ).toEqual([
      "Goods",
      "Services",
      "Digital services",
      "Food",
      "Alcohol",
      "Transport",
    ]);
  });

  it("labels every regime code for the UI", () => {
    expect(PURCHASE_TAX_REGIME_OPTIONS.map(formatPurchaseTaxRegimeLabel)).toEqual(
      [
        "Standard VAT",
        "Reduced VAT",
        "Zero rate",
        "Exempt",
        "Reverse charge",
        "Intra-community supply",
        "Import",
        "Export",
        "Small business scheme (KOR)",
      ],
    );
  });

  it("passes through unknown codes", () => {
    expect(formatPurchaseTaxCategoryLabel("custom_pack")).toBe("custom_pack");
    expect(formatPurchaseTaxRegimeLabel("custom_regime")).toBe("custom_regime");
  });
});
