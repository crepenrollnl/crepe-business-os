/**
 * `recipe-service.ts` has no test file yet -- adding coverage for the whole
 * service is out of scope here (see Critical Finding #4, Step 2 in the
 * plan, which made the same call for the recipe-role UI work). This file
 * covers `deleteRecipe` (whose error handling changed by this task, Фаза 2,
 * "Сырые технические сообщения об ошибках при удалении": a foreign-key-
 * violation delete now maps to a friendly per-table message via the shared
 * `mapDeletionBlockedByReference` helper in `@/lib/service-errors`, instead
 * of leaking the raw Postgres error to the caller), plus the client-side
 * "exactly one of component_recipe_id / ingredient_id" validation added by
 * the recipe_components.ingredient_id UI work (sql/089, Plan item 10 step
 * 2) -- the one genuinely new piece of pure logic in that change.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeFormValues } from "../types/recipe";

const { supabaseMock, recipePhotoServiceMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  recipePhotoServiceMock: {
    uploadPhoto: vi.fn(),
    removePhotoByUrl: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("./recipe-photo-service", () => ({
  recipePhotoService: recipePhotoServiceMock,
}));

import { mapRecipeImageUrl, recipeService } from "./recipe-service";

const RECIPE_ID = "44444444-4444-4444-8444-444444444444";
const COMPONENT_RECIPE_ID = "55555555-5555-4555-8555-555555555555";
const INGREDIENT_ID = "66666666-6666-4666-8666-666666666666";

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape, same pattern as
 * inventory-service.test.ts / finished-goods-read-service.test.ts.
 */
function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.single = vi.fn(chain);
  builder.maybeSingle = vi.fn(chain);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function mockRecipesTable(result: QueryResult) {
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "recipes") {
      return makeBuilder(result);
    }
    return makeBuilder({ data: [], error: null });
  });
}

describe("recipeService.deleteRecipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recipePhotoServiceMock.removePhotoByUrl.mockResolvedValue({
      data: null,
      error: null,
    });
  });

  it("deletes successfully", async () => {
    mockRecipesTable({ data: null, error: null });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });

  it("propagates a generic delete error unchanged", async () => {
    mockRecipesTable({ data: null, error: { message: "delete failed" } });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("delete failed");
  });

  it("maps a foreign-key violation from production plans to a friendly message", async () => {
    mockRecipesTable({
      data: null,
      error: {
        code: "23503",
        message:
          'update or delete on table "recipes" violates foreign key constraint "production_plan_products_recipe_id_fkey" on table "production_plan_products"',
      },
    });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This recipe is used in a production plan and cannot be deleted.",
    );
  });

  it("maps a foreign-key violation from being used as a component in another recipe", async () => {
    mockRecipesTable({
      data: null,
      error: {
        code: "23503",
        message:
          'update or delete on table "recipes" violates foreign key constraint "recipe_components_component_recipe_id_fkey" on table "recipe_components"',
      },
    });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This recipe is used as a component in another recipe and cannot be deleted.",
    );
  });

  it("falls back to a generic 'used elsewhere' message for an unmapped referencing table", async () => {
    mockRecipesTable({
      data: null,
      error: {
        code: "23503",
        message:
          'update or delete on table "recipes" violates foreign key constraint "some_future_table_recipe_id_fkey" on table "some_future_table"',
      },
    });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "This recipe is used elsewhere in the system and cannot be deleted.",
    );
  });

  it("maps a thrown exception to a fallback message", async () => {
    supabaseMock.from.mockImplementation(() => {
      throw new Error("connection lost");
    });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("connection lost");
  });

  it("removes the stored photo before deleting the recipe row", async () => {
    const imageUrl =
      "https://proj.supabase.co/storage/v1/object/public/recipe-photos/r/1.jpg";
    mockRecipesTable({ data: { image_url: imageUrl }, error: null });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(recipePhotoServiceMock.removePhotoByUrl).toHaveBeenCalledWith(
      imageUrl,
    );
    expect(result.error).toBeNull();
  });

  it("still deletes the recipe when storage cleanup fails", async () => {
    const imageUrl =
      "https://proj.supabase.co/storage/v1/object/public/recipe-photos/r/1.jpg";
    mockRecipesTable({ data: { image_url: imageUrl }, error: null });
    recipePhotoServiceMock.removePhotoByUrl.mockResolvedValue({
      data: null,
      error: "storage down",
    });

    const result = await recipeService.deleteRecipe(RECIPE_ID);

    expect(recipePhotoServiceMock.removePhotoByUrl).toHaveBeenCalledWith(
      imageUrl,
    );
    expect(result.error).toBeNull();
    expect(result.data).toBeNull();
  });
});

describe("recipeService.createRecipe — recipe_components target validation (sql/089)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function assemblyInput(
    overrides?: Partial<RecipeFormValues["components"][number]>,
  ): RecipeFormValues {
    return {
      name: "Chicken Crepe",
      description: "",
      yield_quantity: 1,
      yield_unit: "pcs",
      is_active: true,
      recipe_role: "assembly",
      selling_price: null,
      image_url: null,
      lines: [],
      components: [
        {
          component_recipe_id: COMPONENT_RECIPE_ID,
          ingredient_id: null,
          quantity: 1,
          unit: "pcs",
          ...overrides,
        },
      ],
    };
  }

  it("rejects a component line with both component_recipe_id and ingredient_id set", async () => {
    const result = await recipeService.createRecipe(
      assemblyInput({
        component_recipe_id: COMPONENT_RECIPE_ID,
        ingredient_id: INGREDIENT_ID,
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/either a component recipe or a raw ingredient/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects a component line with neither component_recipe_id nor ingredient_id set", async () => {
    const result = await recipeService.createRecipe(
      assemblyInput({ component_recipe_id: null, ingredient_id: null }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/either a component recipe or a raw ingredient/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("accepts a component line with only ingredient_id set (validation passes before any DB call)", async () => {
    // persistRecipe validates before touching supabase at all, so a passing
    // validation reaches the (unmocked-beyond-default) insert call next —
    // asserting on that call, not the final result, keeps this test scoped
    // to the validation logic itself.
    await recipeService.createRecipe(
      assemblyInput({ component_recipe_id: null, ingredient_id: INGREDIENT_ID }),
    );

    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
  });

  it("rejects duplicate ingredient components independently from duplicate component recipes", async () => {
    const result = await recipeService.createRecipe({
      name: "Chicken Crepe",
      description: "",
      yield_quantity: 1,
      yield_unit: "pcs",
      is_active: true,
      recipe_role: "assembly",
      selling_price: null,
      image_url: null,
      lines: [],
      components: [
        {
          component_recipe_id: null,
          ingredient_id: INGREDIENT_ID,
          quantity: 1,
          unit: "pcs",
        },
        {
          component_recipe_id: null,
          ingredient_id: INGREDIENT_ID,
          quantity: 1,
          unit: "pcs",
        },
      ],
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/ingredient can only appear once/i);
  });
});

describe("recipeService — Component-in-Component sub-components (sql/100)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function componentInput(
    overrides?: Partial<RecipeFormValues>,
  ): RecipeFormValues {
    return {
      name: "Roasted chicken",
      description: "",
      yield_quantity: 1,
      yield_unit: "kg",
      is_active: true,
      recipe_role: "component",
      selling_price: null,
      image_url: null,
      lines: [{ ingredient_id: INGREDIENT_ID, quantity: 1, unit: "kg" }],
      components: [],
      ...overrides,
    };
  }

  it("accepts a component recipe with no sub-components (the common case)", async () => {
    await recipeService.createRecipe(componentInput());

    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
  });

  it("accepts a component recipe that references another component recipe as a sub-component", async () => {
    await recipeService.createRecipe(
      componentInput({
        components: [
          {
            component_recipe_id: COMPONENT_RECIPE_ID,
            ingredient_id: null,
            quantity: 0.2,
            unit: "kg",
          },
        ],
      }),
    );

    expect(supabaseMock.from).toHaveBeenCalledWith("recipes");
  });

  it("rejects a sub-component row with a raw ingredient target", async () => {
    const result = await recipeService.createRecipe(
      componentInput({
        components: [
          {
            component_recipe_id: null,
            ingredient_id: INGREDIENT_ID,
            quantity: 0.2,
            unit: "kg",
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/must reference another Component recipe/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects a sub-component row missing a component recipe", async () => {
    const result = await recipeService.createRecipe(
      componentInput({
        components: [
          { component_recipe_id: null, ingredient_id: null, quantity: 1, unit: "kg" },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/must reference a component recipe/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("rejects duplicate sub-component recipes", async () => {
    const result = await recipeService.createRecipe(
      componentInput({
        components: [
          {
            component_recipe_id: COMPONENT_RECIPE_ID,
            ingredient_id: null,
            quantity: 0.2,
            unit: "kg",
          },
          {
            component_recipe_id: COMPONENT_RECIPE_ID,
            ingredient_id: null,
            quantity: 0.1,
            unit: "kg",
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/component can only appear once/i);
  });

  it("still requires the raw-ingredient lines regardless of sub-components", async () => {
    const result = await recipeService.createRecipe(
      componentInput({ lines: [] }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/add at least one ingredient/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});

describe("mapRecipeImageUrl", () => {
  it("returns the trimmed URL when present", () => {
    expect(mapRecipeImageUrl("  https://cdn.example/photo.jpg  ")).toBe(
      "https://cdn.example/photo.jpg",
    );
  });

  it("maps null, blank, and missing values to null", () => {
    expect(mapRecipeImageUrl(null)).toBeNull();
    expect(mapRecipeImageUrl(undefined)).toBeNull();
    expect(mapRecipeImageUrl("")).toBeNull();
    expect(mapRecipeImageUrl("   ")).toBeNull();
  });
});

describe("recipeService.getRecipes — image_url mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps image_url from recipe rows onto the list items", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "recipes") {
        return makeBuilder({
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              description: null,
              yield_quantity: 1,
              yield_unit: "pcs",
              is_active: true,
              recipe_role: "assembly",
              selling_price: 7.5,
              image_url:
                "https://proj.supabase.co/storage/v1/object/public/recipe-photos/r/1.jpg",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            {
              id: COMPONENT_RECIPE_ID,
              name: "Dough",
              description: null,
              yield_quantity: 1,
              yield_unit: "kg",
              is_active: true,
              recipe_role: "component",
              selling_price: null,
              image_url: "   ",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          error: null,
        });
      }

      return makeBuilder({ data: [], error: null });
    });

    const result = await recipeService.getRecipes();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]?.image_url).toBe(
      "https://proj.supabase.co/storage/v1/object/public/recipe-photos/r/1.jpg",
    );
    expect(result.data?.[1]?.image_url).toBeNull();
  });
});
