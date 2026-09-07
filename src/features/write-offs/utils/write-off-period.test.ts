import { describe, expect, it } from "vitest";
import type { WriteOffRecord } from "../types/write-off";
import { summarizeWriteOffs } from "./write-off-period";

function row(
  overrides: Partial<WriteOffRecord> & Pick<WriteOffRecord, "reason" | "total_value" | "created_at">,
): WriteOffRecord {
  return {
    id: overrides.id ?? "wo",
    item_type: "ingredient",
    ingredient_id: "ing-1",
    product_id: null,
    quantity: 1,
    unit_cost: overrides.total_value,
    note: null,
    created_by: null,
    item_name: "Chicken",
    ...overrides,
  };
}

describe("summarizeWriteOffs", () => {
  it("sums the selected period and breaks down by reason", () => {
    const totals = summarizeWriteOffs(
      [
        row({
          id: "a",
          reason: "spoilage",
          total_value: 10,
          created_at: "2026-09-02T08:00:00.000Z",
        }),
        row({
          id: "b",
          reason: "theft",
          total_value: 4,
          created_at: "2026-09-10T08:00:00.000Z",
        }),
        row({
          id: "c",
          reason: "spoilage",
          total_value: 99,
          created_at: "2026-08-31T08:00:00.000Z",
        }),
      ],
      "2026-09-01",
      "2026-09-30",
    );

    expect(totals.totalValue).toBe(14);
    expect(totals.byReason.spoilage).toBe(10);
    expect(totals.byReason.theft).toBe(4);
    expect(totals.byReason.damaged).toBe(0);
  });
});
