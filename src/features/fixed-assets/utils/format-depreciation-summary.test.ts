import { describe, expect, it } from "vitest";
import { formatDepreciationPeriods } from "./format-depreciation-summary";

describe("formatDepreciationPeriods", () => {
  it("formats a single period as 'Mon YYYY'", () => {
    expect(
      formatDepreciationPeriods([
        { fixedAssetId: "a1", period: "2026-08-01", amount: 400, postingNumber: "JE-1" },
      ]),
    ).toBe("Aug 2026");
  });

  it("de-duplicates and sorts periods shared across multiple assets", () => {
    expect(
      formatDepreciationPeriods([
        { fixedAssetId: "a1", period: "2026-08-01", amount: 400, postingNumber: "JE-2" },
        { fixedAssetId: "a2", period: "2026-06-01", amount: 100, postingNumber: "JE-1" },
        { fixedAssetId: "a1", period: "2026-07-01", amount: 400, postingNumber: "JE-3" },
        { fixedAssetId: "a2", period: "2026-06-01", amount: 100, postingNumber: "JE-4" },
      ]),
    ).toBe("Jun 2026, Jul 2026, Aug 2026");
  });

  it("returns an empty string for no details", () => {
    expect(formatDepreciationPeriods([])).toBe("");
  });
});
