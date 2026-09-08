import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import { ProductionSessionLinesSection } from "./production-session-lines-section";

const LINE_ID = "line-1";
const RECIPE_ID = "recipe-1";

function line(
  overrides?: Partial<ProductionSessionLineView>,
): ProductionSessionLineView {
  return {
    id: LINE_ID,
    production_session_id: "session-1",
    production_plan_product_id: "plan-product-1",
    recipe_id: RECIPE_ID,
    product_name: "Smoked Salmon",
    planned_quantity: 2,
    actual_produced_quantity: 1.8,
    raw_material_scale: null,
    yield_unit: "kg",
    sort_order: 1,
    difference: -0.2,
    ...overrides,
  };
}

const idleHandlers = {
  canEdit: true,
  drafts: {
    [LINE_ID]: { raw: "1.8", value: 1.8, error: null },
  },
  rawMaterialScaleDrafts: {
    [LINE_ID]: { raw: "", value: null, error: null },
  },
  helperDrafts: {} as Record<
    string,
    { raw: string; selectedIngredientId: string | null; error: string | null }
  >,
  onProducedChange: vi.fn(),
  onRawMaterialScaleChange: vi.fn(),
  onHelperQuantityChange: vi.fn(),
  onHelperIngredientChange: vi.fn(),
};

function renderLines(
  firstLevel: readonly FirstLevelRawIngredient[],
  extra?: Partial<typeof idleHandlers>,
) {
  const firstLevelRawByRecipeId = new Map<
    string,
    readonly FirstLevelRawIngredient[]
  >([[RECIPE_ID, firstLevel]]);

  return render(
    <ProductionSessionLinesSection
      lines={[line()]}
      firstLevelRawByRecipeId={firstLevelRawByRecipeId}
      {...idleHandlers}
      {...extra}
    />,
  );
}

describe("ProductionSessionLinesSection raw-scale helper", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hides the helper when the recipe has no first-level raw ingredients", () => {
    renderLines([]);

    expect(
      screen.queryByText("Actual ingredient used"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Recipe batches used for Smoked Salmon"),
    ).toBeVisible();
    expect(screen.getByText("Recipe Batches Used")).toBeVisible();
  });

  it("labels a single raw ingredient without a picker", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    expect(screen.getByText("Salmon (recipe: 3 kg)")).toBeVisible();
    expect(
      screen.queryByLabelText("Reference ingredient for Smoked Salmon"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Actual Salmon used for Smoked Salmon"),
    ).toBeVisible();
  });

  it("shows a picker when the recipe has two or more raw ingredients", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 2.1,
        unit: "kg",
      },
      {
        ingredient_id: "salt",
        name: "Salt",
        quantity: 0.2,
        unit: "kg",
      },
    ]);

    expect(
      screen.getByLabelText("Reference ingredient for Smoked Salmon"),
    ).toBeVisible();
    expect(screen.getByText("Salmon — recipe: 2.1 kg")).toBeInTheDocument();
    expect(screen.getByText("Salt — recipe: 0.2 kg")).toBeInTheDocument();
  });

  it("keeps Recipe Batches Used editable next to the helper", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    const helper = screen.getByLabelText("Actual Salmon used for Smoked Salmon");
    const scale = screen.getByLabelText("Recipe batches used for Smoked Salmon");

    fireEvent.change(helper, { target: { value: "6" } });
    fireEvent.change(scale, { target: { value: "1.5" } });

    expect(idleHandlers.onHelperQuantityChange).toHaveBeenCalledWith(
      LINE_ID,
      RECIPE_ID,
      "6",
    );
    expect(idleHandlers.onRawMaterialScaleChange).toHaveBeenCalledWith(
      LINE_ID,
      "1.5",
    );
  });
});
