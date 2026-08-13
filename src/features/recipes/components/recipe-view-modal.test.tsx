/**
 * Recipe View modal (read-only quick look, sql/089 follow-up).
 * Presentational only -- no logic beyond picking which table to render.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { RecipeWithRelations } from "../types/recipe";
import { RecipeViewModal } from "./recipe-view-modal";

function componentRecipe(
  overrides?: Partial<RecipeWithRelations>,
): RecipeWithRelations {
  return {
    id: "recipe-1",
    name: "Dough",
    description: "Base crepe batter",
    yield_quantity: 1,
    yield_unit: "kg",
    is_active: true,
    recipe_role: "component",
    selling_price: null,
    created_at: "2026-01-01T00:00:00.000Z",
    items: [
      {
        id: "item-1",
        recipe_id: "recipe-1",
        ingredient_id: "ing-1",
        quantity: 0.5,
        unit: "kg",
        ingredient: { id: "ing-1", name: "Flour", unit: "kg" },
      },
    ],
    components: [],
    ...overrides,
  };
}

function assemblyRecipe(
  overrides?: Partial<RecipeWithRelations>,
): RecipeWithRelations {
  return {
    id: "recipe-2",
    name: "Chicken Crepe",
    description: null,
    yield_quantity: 1,
    yield_unit: "pcs",
    is_active: true,
    recipe_role: "assembly",
    selling_price: 7.5,
    created_at: "2026-01-01T00:00:00.000Z",
    items: [],
    components: [
      {
        id: "comp-1",
        assembly_recipe_id: "recipe-2",
        component_recipe_id: "recipe-1",
        ingredient_id: null,
        quantity: 1,
        unit: "pcs",
        component: { id: "recipe-1", name: "Dough", yield_unit: "kg" },
        ingredient: null,
      },
      {
        id: "comp-2",
        assembly_recipe_id: "recipe-2",
        component_recipe_id: null,
        ingredient_id: "ing-2",
        quantity: 0.05,
        unit: "kg",
        component: null,
        ingredient: { id: "ing-2", name: "Cucumber", unit: "kg" },
      },
    ],
    ...overrides,
  };
}

describe("RecipeViewModal", () => {
  afterEach(cleanup);

  it("renders nothing when there is no recipe, loading state, or error", () => {
    const { container } = render(
      <RecipeViewModal
        isOpen={false}
        recipe={null}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading skeleton", () => {
    render(
      <RecipeViewModal
        isOpen={true}
        recipe={null}
        isLoading={true}
        error={null}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    );

    expect(screen.getByTestId("recipe-view-modal")).toBeInTheDocument();
  });

  it("shows an error message", () => {
    render(
      <RecipeViewModal
        isOpen={true}
        recipe={null}
        isLoading={false}
        error="Failed to load recipe"
        onClose={() => {}}
        onEdit={() => {}}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Failed to load recipe",
    );
  });

  it("renders the ingredients table for a component recipe", () => {
    render(
      <RecipeViewModal
        isOpen={true}
        recipe={componentRecipe()}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    );

    expect(screen.getByText("Dough")).toBeInTheDocument();
    expect(screen.getByText("Flour")).toBeInTheDocument();
    expect(screen.queryByText("Components")).not.toBeInTheDocument();
  });

  it("renders the components table for an assembly recipe, badging only the ingredient row as Raw", () => {
    render(
      <RecipeViewModal
        isOpen={true}
        recipe={assemblyRecipe()}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onEdit={() => {}}
      />,
    );

    const modal = screen.getByTestId("recipe-view-modal");
    expect(within(modal).getByText("Dough")).toBeInTheDocument();
    expect(within(modal).getByText("Cucumber")).toBeInTheDocument();

    // Scoped to the table -- the legend paragraph above it also says "Raw"
    // once (explaining the badge), which getAllByText across the whole
    // modal would otherwise double-count.
    const table = within(modal).getByRole("table");
    expect(within(table).getAllByText("Raw")).toHaveLength(1);

    const doughRow = within(modal).getByText("Dough").closest("tr");
    const cucumberRow = within(modal).getByText("Cucumber").closest("tr");
    expect(doughRow ? within(doughRow).queryByText("Raw") : null).toBeNull();
    expect(
      cucumberRow ? within(cucumberRow).getByText("Raw") : null,
    ).toBeInTheDocument();
  });

  it("calls onEdit when the Edit button is clicked", () => {
    let edited = false;
    render(
      <RecipeViewModal
        isOpen={true}
        recipe={componentRecipe()}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onEdit={() => {
          edited = true;
        }}
      />,
    );

    screen.getByRole("button", { name: "Edit" }).click();
    expect(edited).toBe(true);
  });
});
