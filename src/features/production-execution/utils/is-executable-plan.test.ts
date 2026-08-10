import { describe, expect, it } from "vitest";
import type { ProductionPlanListItem } from "@/features/production/types/production";
import { filterExecutablePlans, isExecutablePlan } from "./is-executable-plan";

function makePlan(
  overrides: Partial<ProductionPlanListItem> &
    Pick<ProductionPlanListItem, "id" | "status">,
): ProductionPlanListItem {
  return {
    plan_number: 1,
    name: "Test Plan",
    planning_date: "2026-07-20",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-07-20T10:00:00.000Z",
    product_count: 2,
    missing_ingredient_lines: 0,
    shopping_list_status: "generated",
    purchase_draft_status: "not_created",
    linked_purchase: null,
    ...overrides,
  };
}

describe("isExecutablePlan", () => {
  it("accepts ready_to_produce plans", () => {
    expect(
      isExecutablePlan(makePlan({ id: "1", status: "ready_to_produce" })),
    ).toBe(true);
  });

  it("rejects other statuses", () => {
    expect(isExecutablePlan(makePlan({ id: "1", status: "draft" }))).toBe(
      false,
    );
    expect(
      isExecutablePlan(makePlan({ id: "1", status: "waiting_for_purchases" })),
    ).toBe(false);
  });
});

describe("filterExecutablePlans", () => {
  it("keeps only ready_to_produce plans", () => {
    const plans = [
      makePlan({ id: "a", status: "draft" }),
      makePlan({ id: "b", status: "ready_to_produce" }),
      makePlan({ id: "c", status: "planned" }),
      makePlan({ id: "d", status: "ready_to_produce" }),
    ];

    const result = filterExecutablePlans(plans);

    expect(result).toHaveLength(2);
    expect(result.map((plan) => plan.id)).toEqual(["b", "d"]);
  });
});
