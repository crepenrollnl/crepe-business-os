import { describe, expect, it } from "vitest";
import {
  buildLineTotalProbeKey,
  editableLineTotalValue,
  shouldInvalidateLineTotalProbeOnPriceModeChange,
  shouldRunLineTotalProbe,
  unitCostAfterLineTotalProbe,
} from "./line-total-probe-apply";

const PINNED_GROSS = 3.04;
const QTY = 9;
/** Exclusive net the probe would return for 3.04 @ 21% (3.04/9/1.21). */
const PROBE_NET_AT_21 = 0.2789;
/** Exclusive net the probe would return for 3.04 @ 9% (2.79/9). */
const PROBE_NET_AT_9 = 0.31;
const INCLUSIVE_GROSS_UNIT = 0.3378; // round(3.04/9, 4)

function probeKey(overrides?: Partial<Parameters<typeof buildLineTotalProbeKey>[0]>) {
  return buildLineTotalProbeKey({
    quantity: QTY,
    lineTotal: PINNED_GROSS,
    taxCategory: "goods",
    taxRegime: "standard_vat",
    purchasedAt: "2026-08-28",
    taxCountry: "NL",
    supplierCountry: "NL",
    supplierId: "supplier-1",
    priceMode: "exclusive",
    ...overrides,
  });
}

describe("line-total probe apply", () => {
  it("exclusive + pin + category change writes probe net at the new rate, not the old unit", () => {
    expect(shouldRunLineTotalProbe("line_total")).toBe(true);

    const beforeCategory = probeKey({
      taxCategory: "goods",
      taxRegime: "standard_vat",
    });
    const afterCategory = probeKey({
      taxCategory: "food",
      taxRegime: "reduced_vat",
    });
    expect(beforeCategory).not.toBe(afterCategory);

    const unitAfterFood = unitCostAfterLineTotalProbe({
      priceMode: "exclusive",
      probeNetUnitCost: PROBE_NET_AT_9,
      pinnedGross: PINNED_GROSS,
      quantity: QTY,
    });
    expect(unitAfterFood).toBe(PROBE_NET_AT_9);
    expect(unitAfterFood).not.toBe(PROBE_NET_AT_21);
  });

  it("inclusive + pin writes gross unit, never probe net", () => {
    expect(shouldRunLineTotalProbe("line_total")).toBe(true);

    const applied = unitCostAfterLineTotalProbe({
      priceMode: "inclusive",
      probeNetUnitCost: PROBE_NET_AT_9,
      pinnedGross: PINNED_GROSS,
      quantity: QTY,
    });
    expect(applied).toBe(INCLUSIVE_GROSS_UNIT);
    expect(applied).not.toBe(PROBE_NET_AT_9);
    expect(applied).not.toBe(PROBE_NET_AT_21);
  });

  it("exclusive→inclusive with pin invalidates the key and applies gross, not leftover exclusive net", () => {
    expect(shouldInvalidateLineTotalProbeOnPriceModeChange("line_total")).toBe(
      true,
    );
    expect(shouldRunLineTotalProbe("line_total")).toBe(true);

    const exclusiveKey = probeKey({ priceMode: "exclusive" });
    const inclusiveKey = probeKey({ priceMode: "inclusive" });
    expect(exclusiveKey).not.toBe(inclusiveKey);

    const leftoverExclusiveNet = unitCostAfterLineTotalProbe({
      priceMode: "exclusive",
      probeNetUnitCost: PROBE_NET_AT_21,
      pinnedGross: PINNED_GROSS,
      quantity: QTY,
    });
    expect(leftoverExclusiveNet).toBe(PROBE_NET_AT_21);

    const afterToggle = unitCostAfterLineTotalProbe({
      priceMode: "inclusive",
      probeNetUnitCost: PROBE_NET_AT_21,
      pinnedGross: PINNED_GROSS,
      quantity: QTY,
    });
    expect(afterToggle).toBe(INCLUSIVE_GROSS_UNIT);
    expect(afterToggle).not.toBe(PROBE_NET_AT_21);
  });

  it("pin then manual Unit price turns the probe off (last edit wins)", () => {
    expect(shouldRunLineTotalProbe("line_total")).toBe(true);
    expect(shouldRunLineTotalProbe("unit_cost")).toBe(false);
    expect(shouldInvalidateLineTotalProbeOnPriceModeChange("unit_cost")).toBe(
      false,
    );

    const displayed = editableLineTotalValue({
      lastEditedField: "unit_cost",
      pinnedLineTotal: "3.04",
      previewGrossAmount: 2.79,
    });
    expect(displayed).toBe("2.79");
  });

  it("inclusive without a Line total pin never runs the probe", () => {
    expect(shouldRunLineTotalProbe(null)).toBe(false);
    expect(shouldRunLineTotalProbe("unit_cost")).toBe(false);
    expect(shouldInvalidateLineTotalProbeOnPriceModeChange(null)).toBe(false);
  });

  it("shows pinned Line total while it is the anchor, else preview gross", () => {
    expect(
      editableLineTotalValue({
        lastEditedField: "line_total",
        pinnedLineTotal: "3.04",
        previewGrossAmount: 2.51,
      }),
    ).toBe("3.04");

    expect(
      editableLineTotalValue({
        lastEditedField: "unit_cost",
        pinnedLineTotal: "2.51",
        previewGrossAmount: 3.04,
      }),
    ).toBe("3.04");

    expect(
      editableLineTotalValue({
        lastEditedField: "unit_cost",
        pinnedLineTotal: "2.51",
        previewGrossAmount: null,
      }),
    ).toBe("2.51");
  });
});
