import { describe, expect, it } from "vitest";

import type {
  PlanningRecipe,
  PlanningRecipeComponentLine,
  PlanningRecipeIngredientLine,
} from "../types/recipe";
import { explodeComponentRecipeBom } from "./explode-component-bom";

function recipe(
  overrides: Partial<PlanningRecipe> & Pick<PlanningRecipe, "id">,
): PlanningRecipe {
  return {
    finishedGoodId: overrides.id,
    status: "active",
    yieldQuantity: 1,
    yieldUnit: "kg",
    recipeRole: "component",
    ...overrides,
  };
}

function item(
  line: PlanningRecipeIngredientLine,
): PlanningRecipeIngredientLine {
  return line;
}

function component(
  line: PlanningRecipeComponentLine,
): PlanningRecipeComponentLine {
  return line;
}

describe("explodeComponentRecipeBom", () => {
  it("returns native recipe_items when the component has no sub-components", () => {
    const result = explodeComponentRecipeBom(
      "chicken",
      [recipe({ id: "chicken" })],
      [
        item({
          recipeId: "chicken",
          ingredientId: "flour",
          quantityPerYield: 2,
          unit: "kg",
        }),
      ],
      [],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingredients).toEqual([
      { ingredientId: "flour", quantityPerYield: 2, unit: "kg" },
    ]);
  });

  it("scales a nested component's raw items by quantity / child yield", () => {
    // Chicken yield 1kg uses 0.2kg marinade; marinade yield 1kg uses 0.05kg soy.
    const result = explodeComponentRecipeBom(
      "chicken",
      [recipe({ id: "chicken" }), recipe({ id: "marinade" })],
      [
        item({
          recipeId: "chicken",
          ingredientId: "chicken-breast",
          quantityPerYield: 0.8,
          unit: "kg",
        }),
        item({
          recipeId: "marinade",
          ingredientId: "soy",
          quantityPerYield: 0.05,
          unit: "kg",
        }),
      ],
      [
        component({
          parentRecipeId: "chicken",
          componentRecipeId: "marinade",
          ingredientId: null,
          quantityPerYield: 0.2,
          unit: "kg",
        }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byId = Object.fromEntries(
      result.ingredients.map((row) => [row.ingredientId, row]),
    );
    expect(byId["chicken-breast"].quantityPerYield).toBe(0.8);
    expect(byId.soy.quantityPerYield).toBeCloseTo(0.01);
  });

  it("walks two nesting levels", () => {
    const result = explodeComponentRecipeBom(
      "a",
      [recipe({ id: "a" }), recipe({ id: "b" }), recipe({ id: "c" })],
      [
        item({
          recipeId: "c",
          ingredientId: "salt",
          quantityPerYield: 10,
          unit: "g",
        }),
      ],
      [
        component({
          parentRecipeId: "a",
          componentRecipeId: "b",
          ingredientId: null,
          quantityPerYield: 2,
          unit: "kg",
        }),
        component({
          parentRecipeId: "b",
          componentRecipeId: "c",
          ingredientId: null,
          quantityPerYield: 0.5,
          unit: "kg",
        }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // salt per 1 of A = 10 * (2 / 1) * (0.5 / 1) = 10
    expect(result.ingredients).toEqual([
      { ingredientId: "salt", quantityPerYield: 10, unit: "g" },
    ]);
  });

  it("sums a diamond: two children sharing an ingredient", () => {
    const result = explodeComponentRecipeBom(
      "a",
      [recipe({ id: "a" }), recipe({ id: "b" }), recipe({ id: "c" })],
      [
        item({
          recipeId: "b",
          ingredientId: "flour",
          quantityPerYield: 2,
          unit: "kg",
        }),
        item({
          recipeId: "c",
          ingredientId: "flour",
          quantityPerYield: 3,
          unit: "kg",
        }),
      ],
      [
        component({
          parentRecipeId: "a",
          componentRecipeId: "b",
          ingredientId: null,
          quantityPerYield: 1,
          unit: "kg",
        }),
        component({
          parentRecipeId: "a",
          componentRecipeId: "c",
          ingredientId: null,
          quantityPerYield: 1,
          unit: "kg",
        }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingredients).toEqual([
      { ingredientId: "flour", quantityPerYield: 5, unit: "kg" },
    ]);
  });

  it("does not walk recipe_components of an assembly parent", () => {
    const result = explodeComponentRecipeBom(
      "assembly",
      [
        recipe({ id: "assembly", recipeRole: "assembly" }),
        recipe({ id: "dough" }),
      ],
      [
        item({
          recipeId: "assembly",
          ingredientId: "garnish",
          quantityPerYield: 1,
          unit: "pcs",
        }),
        item({
          recipeId: "dough",
          ingredientId: "flour",
          quantityPerYield: 2,
          unit: "kg",
        }),
      ],
      [
        component({
          parentRecipeId: "assembly",
          componentRecipeId: "dough",
          ingredientId: null,
          quantityPerYield: 1,
          unit: "pcs",
        }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingredients).toEqual([
      { ingredientId: "garnish", quantityPerYield: 1, unit: "pcs" },
    ]);
  });

  it("rejects a circular sub-component graph", () => {
    const result = explodeComponentRecipeBom(
      "a",
      [recipe({ id: "a" }), recipe({ id: "b" })],
      [],
      [
        component({
          parentRecipeId: "a",
          componentRecipeId: "b",
          ingredientId: null,
          quantityPerYield: 1,
          unit: "kg",
        }),
        component({
          parentRecipeId: "b",
          componentRecipeId: "a",
          ingredientId: null,
          quantityPerYield: 1,
          unit: "kg",
        }),
      ],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("circular_recipe_component");
  });

  it("rejects a missing nested recipe", () => {
    const result = explodeComponentRecipeBom(
      "chicken",
      [recipe({ id: "chicken" })],
      [],
      [
        component({
          parentRecipeId: "chicken",
          componentRecipeId: "marinade",
          ingredientId: null,
          quantityPerYield: 0.2,
          unit: "kg",
        }),
      ],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("missing_recipe");
    expect(result.issues[0]?.recipeId).toBe("marinade");
  });
});
