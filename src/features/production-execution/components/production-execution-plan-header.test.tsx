import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ProductionExecutionPlanDetail } from "../types/production-execution";
import {
  ProductionExecutionPlanHeader,
  START_PRODUCTION_NO_PRODUCTS_REASON,
} from "./production-execution-plan-header";

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
  overrides?: Partial<ProductionExecutionPlanDetail>,
): ProductionExecutionPlanDetail {
  return {
    id: "plan-1",
    plan_number: 12,
    name: "Saturday prep",
    status: "ready_to_produce",
    planning_date: "2026-08-03",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-08-03T08:00:00.000Z",
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
      planning_status: "ready_to_produce",
    },
    open_session: null,
    sessions: [],
    ...overrides,
  };
}

describe("ProductionExecutionPlanHeader start blocked reason", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows why Start Production is disabled instead of a title tooltip", () => {
    render(
      <ProductionExecutionPlanHeader
        plan={plan()}
        starting={false}
        startError={null}
        onStartProduction={vi.fn()}
      />,
    );

    const start = screen.getByRole("button", { name: "Start Production" });
    expect(start).toBeDisabled();
    expect(start).not.toHaveAttribute("title");
    expect(screen.getByText(START_PRODUCTION_NO_PRODUCTS_REASON)).toBeVisible();
  });

  it("does not show the empty-plan reason when products exist", () => {
    render(
      <ProductionExecutionPlanHeader
        plan={plan({
          products: [
            {
              id: "ppp-1",
              production_plan_id: "plan-1",
              recipe_id: "recipe-1",
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "pcs",
              status: "active",
              sort_order: 0,
            },
          ],
          summary: {
            planned_product_count: 1,
            total_ingredient_lines: 0,
            missing_ingredient_lines: 0,
            shopping_list_status: "not_generated",
            purchase_draft_status: "not_created",
            planning_status: "ready_to_produce",
          },
        })}
        starting={false}
        startError={null}
        onStartProduction={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Start Production" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(START_PRODUCTION_NO_PRODUCTS_REASON),
    ).not.toBeInTheDocument();
  });
});
