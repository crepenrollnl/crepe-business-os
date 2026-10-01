import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  ProductionPlanStatus,
  ProductionPlanWithRelations,
} from "../types/production";
import { ProductionPlanDetailHeader } from "./production-plan-detail-header";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

function plan(
  status: ProductionPlanStatus,
): ProductionPlanWithRelations {
  return {
    id: "plan-1",
    plan_number: 12,
    name: "Saturday prep",
    status,
    planning_date: "2026-08-03",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-08-03T08:00:00.000Z",
    updated_at: "2026-08-03T08:05:00.000Z",
    products: [],
    ingredients: [],
    shopping_items: [],
    linked_purchase: null,
    purchase_draft_status: "not_created",
    shopping_list_status: "not_generated",
    summary: {
      planned_product_count: 0,
      total_ingredient_lines: 0,
      missing_ingredient_lines: 0,
      shopping_list_status: "not_generated",
      purchase_draft_status: "not_created",
      planning_status: status,
    },
  };
}

function renderHeader(status: ProductionPlanStatus) {
  const onCancel = vi.fn().mockResolvedValue(true);
  render(
    <ProductionPlanDetailHeader
      plan={plan(status)}
      canCalculate={false}
      isCalculating={false}
      onCalculate={() => undefined}
      canConfirm={status === "draft"}
      isConfirming={false}
      onConfirm={() => undefined}
      isCancelling={false}
      cancelError={null}
      onCancel={onCancel}
    />,
  );
  return { onCancel };
}

describe("ProductionPlanDetailHeader cancel", () => {
  afterEach(() => {
    cleanup();
  });

  it.each([
    "draft",
    "planned",
    "waiting_for_purchases",
    "ready_to_produce",
  ] as const)("shows Cancel plan for %s", (status) => {
    renderHeader(status);
    expect(
      screen.getByRole("button", { name: "Cancel plan" }),
    ).toBeInTheDocument();
  });

  it.each(["completed", "cancelled"] as const)(
    "hides Cancel plan for %s",
    (status) => {
      renderHeader(status);
      expect(
        screen.queryByRole("button", { name: "Cancel plan" }),
      ).not.toBeInTheDocument();
    },
  );

  it("asks for confirmation before cancelling", () => {
    const { onCancel } = renderHeader("draft");

    fireEvent.click(screen.getByRole("button", { name: "Cancel plan" }));

    expect(
      screen.getByText(
        "Cancel this plan? Stock does not change. A linked purchase draft stays in Purchases.",
      ),
    ).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep plan" }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
