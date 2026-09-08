import { describe, expect, it } from "vitest";
import { collectFirstLevelRawIngredients } from "./collect-first-level-raw-ingredients";

const SALMON = "ingredient-salmon";
const SALT = "ingredient-salt";
const DOUGH = "ingredient-unused";
const RECIPE = "recipe-smoked";

describe("collectFirstLevelRawIngredients", () => {
  it("collects recipe_items and raw component add-ins, skipping nested recipes", () => {
    const names = new Map([
      [SALMON, { name: "Salmon" }],
      [SALT, { name: "Salt" }],
      [DOUGH, { name: "Dough leaf" }],
    ]);

    const result = collectFirstLevelRawIngredients(
      [RECIPE],
      [
        {
          recipeId: RECIPE,
          ingredientId: SALMON,
          quantity: 2.1,
          unit: "kg",
        },
        {
          recipeId: "other-recipe",
          ingredientId: DOUGH,
          quantity: 99,
          unit: "kg",
        },
      ],
      [
        {
          parentRecipeId: RECIPE,
          ingredientId: SALT,
          quantity: 0.2,
          unit: "kg",
        },
        {
          parentRecipeId: RECIPE,
          ingredientId: null,
          quantity: 1,
          unit: "kg",
        },
      ],
      names,
    );

    expect(result.get(RECIPE)).toEqual([
      {
        ingredient_id: SALMON,
        name: "Salmon",
        quantity: 2.1,
        unit: "kg",
      },
      {
        ingredient_id: SALT,
        name: "Salt",
        quantity: 0.2,
        unit: "kg",
      },
    ]);
  });

  it("returns an empty list when a recipe has no first-level raw lines", () => {
    const result = collectFirstLevelRawIngredients(
      [RECIPE],
      [],
      [
        {
          parentRecipeId: RECIPE,
          ingredientId: null,
          quantity: 1,
          unit: "kg",
        },
      ],
      new Map(),
    );

    expect(result.get(RECIPE)).toEqual([]);
  });
});
