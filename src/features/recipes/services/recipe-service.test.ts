/**
 * `recipe-service.ts` has no test file yet -- adding coverage for the whole
 * service is out of scope here (see Critical Finding #4, Step 2 in the
 * plan, which made the same call for the recipe-role UI work). This file
 * only covers `deleteRecipe`, whose error handling changed by this task
 * (Фаза 2, "Сырые технические сообщения об ошибках при удалении"): a
 * foreign-key-violation delete now maps to a friendly per-table message via
 * the shared `mapDeletionBlockedByReference` helper in `@/lib/service-errors`,
 * instead of leaking the raw Postgres error to the caller.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { recipeService } from "./recipe-service";

const RECIPE_ID = "44444444-4444-4444-8444-444444444444";

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
});
