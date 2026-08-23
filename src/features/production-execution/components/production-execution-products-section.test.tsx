import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ProductionExecutionProductsSection } from "./production-execution-products-section";
import type { ProductionPlanProduct } from "../types/production-execution";

const product: ProductionPlanProduct = {
  id: "ppp-1",
  production_plan_id: "plan-1",
  recipe_id: "recipe-chicken",
  recipe_name: "Roasted chicken",
  planned_quantity: 3,
  yield_quantity: 1,
  yield_unit: "kg",
  status: "active",
  sort_order: 0,
};

describe("ProductionExecutionProductsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels the plan quantity as Target / Planned, not produced", () => {
    render(<ProductionExecutionProductsSection products={[product]} />);

    expect(screen.getByText("Target / Planned")).toBeInTheDocument();
    expect(screen.queryByText("Planned Quantity")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
