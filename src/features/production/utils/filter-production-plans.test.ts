import { describe, expect, it } from "vitest";
import type { ProductionPlanStatus } from "../types/production";
import { isProductionPlanVisible } from "./filter-production-plans";

const STATUSES: ProductionPlanStatus[] = [
  "draft",
  "planned",
  "waiting_for_purchases",
  "ready_to_produce",
  "completed",
  "cancelled",
];

describe("isProductionPlanVisible", () => {
  it("hides completed and cancelled plans when the status filter is empty", () => {
    const visible = STATUSES.filter((status) =>
      isProductionPlanVisible(status, ""),
    );

    expect(visible).toEqual([
      "draft",
      "planned",
      "waiting_for_purchases",
      "ready_to_produce",
    ]);
  });

  it("shows completed and cancelled plans when that status is selected", () => {
    expect(isProductionPlanVisible("completed", "completed")).toBe(true);
    expect(isProductionPlanVisible("cancelled", "cancelled")).toBe(true);
    expect(isProductionPlanVisible("draft", "completed")).toBe(false);
    expect(isProductionPlanVisible("ready_to_produce", "cancelled")).toBe(
      false,
    );
  });
});
