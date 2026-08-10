/**
 * Inventory service coverage (Фаза 3 gap #4 of 5).
 *
 * inventory-service.ts had zero tests before this file, despite being the
 * CRUD core of Inventory -- the module AGENTS.md calls the architectural
 * reference pattern for every other module.
 *
 * The file matches its apparent purpose (unlike production-batch-service.ts
 * on gap #1): plain CRUD over `ingredients`, enriched with `category`/
 * `supplier` relations, with a client-side case-insensitive duplicate-name
 * check before create/update. It does not touch current_stock mutation
 * logic (that lives in purchase-service.ts / complete_production_session,
 * per AGENTS.md's stock-mutation-authority table) -- this service is a
 * plain reference-data CRUD, not a stock ledger.
 *
 * deleteIngredient's toUserError now also maps foreign-key-violation
 * deletes (via the shared `mapDeletionBlockedByReference` helper in
 * `@/lib/service-errors`) to a friendly per-table message instead of
 * letting the raw Postgres error reach the caller. See AGENTS.md / plan
 * Фаза 2 entry "Сырые технические сообщения об ошибках при удалении".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateIngredientInput,
  UpdateIngredientInput,
} from "../types/inventory";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { inventoryService } from "./inventory-service";

const INGREDIENT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";

type QueryResult = { data: unknown; error: unknown; count?: number | null };

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape: select/insert/update/delete/eq/order/single
 * all return the same builder, and the builder itself resolves like a
 * Promise when awaited. Same pattern as finished-goods-read-service.test.ts
 * and production-batch-service.test.ts.
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

/**
 * Configure supabaseMock.from to return per-table builders. A table entry
 * may be a single result (every call to that table gets it) or an array,
 * consumed in call order -- needed for create/update, which query
 * "ingredients" twice in sequence: once for the duplicate-name check, once
 * for the insert/update itself. Tables not listed default to an empty
 * successful result.
 */
function mockTables(tables: Record<string, QueryResult | QueryResult[]>) {
  const callCounts: Record<string, number> = {};
  supabaseMock.from.mockImplementation((table: string) => {
    const configured = tables[table];
    let result: QueryResult;
    if (Array.isArray(configured)) {
      const index = callCounts[table] ?? 0;
      result = configured[index] ?? configured[configured.length - 1];
      callCounts[table] = index + 1;
    } else {
      result = configured ?? { data: [], error: null };
    }
    return makeBuilder(result);
  });
}

function ingredientRow(overrides?: Record<string, unknown>) {
  return {
    id: INGREDIENT_ID,
    name: "Flour",
    category_id: CATEGORY_ID,
    supplier_id: SUPPLIER_ID,
    unit: "kg",
    current_stock: 10,
    minimum_stock: 2,
    cost_per_unit: 1.5,
    ...overrides,
  };
}

function createInput(
  overrides?: Partial<CreateIngredientInput>,
): CreateIngredientInput {
  return {
    name: "Flour",
    category_id: CATEGORY_ID,
    supplier_id: SUPPLIER_ID,
    unit: "kg",
    current_stock: 10,
    minimum_stock: 2,
    cost_per_unit: 1.5,
    ...overrides,
  };
}

describe("inventoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getInventory", () => {
    it("enriches ingredients with their category and supplier", async () => {
      mockTables({
        ingredient_categories: {
          data: [{ id: CATEGORY_ID, name: "Dairy" }],
          error: null,
        },
        suppliers: { data: [{ id: SUPPLIER_ID, name: "Acme" }], error: null },
        ingredients: { data: [ingredientRow()], error: null },
      });

      const result = await inventoryService.getInventory();

      expect(result.error).toBeNull();
      expect(result.data?.[0]).toMatchObject({
        category: { id: CATEGORY_ID, name: "Dairy" },
        supplier: { id: SUPPLIER_ID, name: "Acme" },
      });
    });

    it("sets category/supplier to null when the ingredient has no category_id/supplier_id", async () => {
      mockTables({
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
        ingredients: {
          data: [ingredientRow({ category_id: null, supplier_id: null })],
          error: null,
        },
      });

      const result = await inventoryService.getInventory();

      expect(result.data?.[0]?.category).toBeNull();
      expect(result.data?.[0]?.supplier).toBeNull();
    });

    it("sets category/supplier to null (not a crash) when the referenced id no longer exists", async () => {
      mockTables({
        ingredient_categories: { data: [], error: null }, // category was deleted
        suppliers: { data: [], error: null },
        ingredients: { data: [ingredientRow()], error: null },
      });

      const result = await inventoryService.getInventory();

      expect(result.error).toBeNull();
      expect(result.data?.[0]?.category).toBeNull();
      expect(result.data?.[0]?.supplier).toBeNull();
    });

    it("fails when loading categories errors, without querying ingredients", async () => {
      mockTables({
        ingredient_categories: {
          data: null,
          error: { message: "categories query failed" },
        },
      });

      const result = await inventoryService.getInventory();

      expect(result.data).toBeNull();
      expect(result.error).toBe("categories query failed");
      expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
    });

    it("fails when loading suppliers errors", async () => {
      mockTables({
        ingredient_categories: { data: [], error: null },
        suppliers: { data: null, error: { message: "suppliers query failed" } },
      });

      const result = await inventoryService.getInventory();

      expect(result.data).toBeNull();
      expect(result.error).toBe("suppliers query failed");
    });

    it("fails when loading ingredients errors", async () => {
      mockTables({
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
        ingredients: { data: null, error: { message: "ingredients query failed" } },
      });

      const result = await inventoryService.getInventory();

      expect(result.data).toBeNull();
      expect(result.error).toBe("ingredients query failed");
    });

    it("maps a thrown exception to a fallback message", async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error("connection refused");
      });

      const result = await inventoryService.getInventory();

      expect(result.data).toBeNull();
      expect(result.error).toBe("connection refused");
    });
  });

  describe("getCategories / getSuppliers", () => {
    it("getCategories returns the list on success", async () => {
      mockTables({
        ingredient_categories: {
          data: [{ id: CATEGORY_ID, name: "Dairy" }],
          error: null,
        },
      });

      const result = await inventoryService.getCategories();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([{ id: CATEGORY_ID, name: "Dairy" }]);
    });

    it("getCategories propagates a query error", async () => {
      mockTables({
        ingredient_categories: { data: null, error: { message: "boom" } },
      });

      const result = await inventoryService.getCategories();

      expect(result.data).toBeNull();
      expect(result.error).toBe("boom");
    });

    it("getSuppliers returns the list on success", async () => {
      mockTables({
        suppliers: { data: [{ id: SUPPLIER_ID, name: "Acme" }], error: null },
      });

      const result = await inventoryService.getSuppliers();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([{ id: SUPPLIER_ID, name: "Acme" }]);
    });

    it("getSuppliers propagates a query error", async () => {
      mockTables({ suppliers: { data: null, error: { message: "boom" } } });

      const result = await inventoryService.getSuppliers();

      expect(result.data).toBeNull();
      expect(result.error).toBe("boom");
    });
  });

  describe("createIngredient", () => {
    it("creates the ingredient when the name is not a duplicate", async () => {
      mockTables({
        ingredients: [
          // 1st call: duplicate-name check (no existing rows)
          { data: [], error: null },
          // 2nd call: the insert itself
          { data: ingredientRow(), error: null },
        ],
        ingredient_categories: {
          data: [{ id: CATEGORY_ID, name: "Dairy" }],
          error: null,
        },
        suppliers: { data: [{ id: SUPPLIER_ID, name: "Acme" }], error: null },
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.error).toBeNull();
      expect(result.data?.name).toBe("Flour");
      expect(result.data?.category?.name).toBe("Dairy");
    });

    it("rejects a duplicate name case-insensitively and trimmed, without inserting", async () => {
      mockTables({
        ingredients: [
          { data: [{ id: "other-id", name: "  Flour  " }], error: null },
        ],
      });

      const result = await inventoryService.createIngredient(
        createInput({ name: "flour" }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "An ingredient with this name already exists. Please choose a different name.",
      );
    });

    it("propagates an error from the duplicate-name check itself", async () => {
      mockTables({
        ingredients: [
          { data: null, error: { message: "duplicate check failed" } },
        ],
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.data).toBeNull();
      expect(result.error).toBe("duplicate check failed");
    });

    it("propagates a reference-data load failure before inserting", async () => {
      mockTables({
        ingredients: [{ data: [], error: null }],
        ingredient_categories: {
          data: null,
          error: { message: "categories failed" },
        },
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.data).toBeNull();
      expect(result.error).toBe("categories failed");
    });

    it("maps a 23505 unique-violation on insert to the friendly duplicate message (race with the pre-check)", async () => {
      mockTables({
        ingredients: [
          { data: [], error: null }, // pre-check saw no duplicate
          {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "ingredients_name_key"',
            },
          },
        ],
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "An ingredient with this name already exists. Please choose a different name.",
      );
    });

    it("passes through an unrelated insert error unchanged", async () => {
      mockTables({
        ingredients: [
          { data: [], error: null },
          { data: null, error: { message: "insert failed" } },
        ],
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.data).toBeNull();
      expect(result.error).toBe("insert failed");
    });

    it("nulls supplier_id when it is blank, and trims the name", async () => {
      // Capture the exact payload sent to .insert() on the 2nd "ingredients"
      // call (the 1st is the duplicate-name check).
      let capturedPayload: unknown;
      const callCounts: Record<string, number> = {};
      supabaseMock.from.mockImplementation((table: string) => {
        if (table !== "ingredients") {
          return makeBuilder({ data: [], error: null });
        }
        const index = callCounts.ingredients ?? 0;
        callCounts.ingredients = index + 1;
        if (index === 0) {
          return makeBuilder({ data: [], error: null });
        }
        const builder = makeBuilder({ data: ingredientRow(), error: null });
        builder.insert = vi.fn((payload: unknown) => {
          capturedPayload = payload;
          return builder;
        });
        return builder;
      });

      await inventoryService.createIngredient(
        createInput({ name: "  Sugar  ", supplier_id: "" }),
      );

      expect(capturedPayload).toMatchObject({
        name: "Sugar",
        supplier_id: null,
      });
    });

    it("maps a thrown exception to a fallback message", async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error("unexpected create failure");
      });

      const result = await inventoryService.createIngredient(createInput());

      expect(result.data).toBeNull();
      expect(result.error).toBe("unexpected create failure");
    });
  });

  describe("updateIngredient", () => {
    const updateInput: UpdateIngredientInput = createInput();

    it("updates the ingredient when renamed to a name not used by another ingredient", async () => {
      mockTables({
        ingredients: [
          { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null },
          { data: ingredientRow({ name: "Bread Flour" }), error: null },
        ],
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
      });

      const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
        ...updateInput,
        name: "Bread Flour",
      });

      expect(result.error).toBeNull();
      expect(result.data?.name).toBe("Bread Flour");
    });

    it("does not flag the ingredient's own unchanged name as a duplicate of itself", async () => {
      mockTables({
        ingredients: [
          // The only existing row with this name IS the one being edited.
          { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null },
          { data: ingredientRow(), error: null },
        ],
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
      });

      const result = await inventoryService.updateIngredient(
        INGREDIENT_ID,
        updateInput,
      );

      expect(result.error).toBeNull();
    });

    it("rejects renaming to a name already used by a different ingredient", async () => {
      mockTables({
        ingredients: [
          {
            data: [{ id: "different-ingredient-id", name: "Sugar" }],
            error: null,
          },
        ],
      });

      const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
        ...updateInput,
        name: "Sugar",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "An ingredient with this name already exists. Please choose a different name.",
      );
    });

    it("passes through an unrelated update error unchanged", async () => {
      mockTables({
        ingredients: [
          { data: [], error: null },
          { data: null, error: { message: "update failed" } },
        ],
        ingredient_categories: { data: [], error: null },
        suppliers: { data: [], error: null },
      });

      const result = await inventoryService.updateIngredient(
        INGREDIENT_ID,
        updateInput,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("update failed");
    });

    it("maps a thrown exception to a fallback message", async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error("timeout");
      });

      const result = await inventoryService.updateIngredient(
        INGREDIENT_ID,
        updateInput,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("timeout");
    });

    describe("unit change guard", () => {
      it("blocks changing the unit when the ingredient is used in recipes, with a clear message instead of a raw Postgres error", async () => {
        mockTables({
          ingredients: [
            { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null }, // duplicate-name check
            { data: { unit: "kg" }, error: null }, // current-unit lookup
          ],
          recipe_items: { data: null, error: null, count: 2 },
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "g",
        });

        expect(result.data).toBeNull();
        expect(result.error).toBe(
          "Cannot change unit: this ingredient is used in 2 recipes. Recipes lock in the unit when saved — remove the ingredient from those recipes first to change it.",
        );
        // Never reached the actual UPDATE / reference-data load.
        expect(supabaseMock.from).not.toHaveBeenCalledWith(
          "ingredient_categories",
        );
      });

      it("uses singular phrasing for exactly one recipe", async () => {
        mockTables({
          ingredients: [
            { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null },
            { data: { unit: "kg" }, error: null },
          ],
          recipe_items: { data: null, error: null, count: 1 },
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "g",
        });

        expect(result.error).toBe(
          "Cannot change unit: this ingredient is used in 1 recipe. Recipes lock in the unit when saved — remove the ingredient from those recipes first to change it.",
        );
      });

      it("allows changing the unit when the ingredient is not used in any recipe", async () => {
        mockTables({
          ingredients: [
            { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null },
            { data: { unit: "kg" }, error: null },
            { data: ingredientRow({ unit: "g" }), error: null }, // the update itself
          ],
          recipe_items: { data: null, error: null, count: 0 },
          ingredient_categories: { data: [], error: null },
          suppliers: { data: [], error: null },
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "g",
        });

        expect(result.error).toBeNull();
        expect(result.data?.unit).toBe("g");
      });

      it("does not check recipe usage at all when unit is unchanged, even if the ingredient is used in recipes elsewhere", async () => {
        mockTables({
          ingredients: [
            { data: [{ id: INGREDIENT_ID, name: "Flour" }], error: null },
            { data: { unit: "kg" }, error: null },
            { data: ingredientRow({ minimum_stock: 5 }), error: null },
          ],
          ingredient_categories: { data: [], error: null },
          suppliers: { data: [], error: null },
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "kg", // same as current — no change
          minimum_stock: 5,
        });

        expect(result.error).toBeNull();
        expect(result.data?.minimum_stock).toBe(5);
        expect(supabaseMock.from).not.toHaveBeenCalledWith("recipe_items");
      });

      it("propagates an error from the current-unit lookup itself", async () => {
        mockTables({
          ingredients: [
            { data: [], error: null },
            { data: null, error: { message: "unit lookup failed" } },
          ],
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "g",
        });

        expect(result.data).toBeNull();
        expect(result.error).toBe("unit lookup failed");
      });

      it("propagates an error from the recipe-usage count query", async () => {
        mockTables({
          ingredients: [
            { data: [], error: null },
            { data: { unit: "kg" }, error: null },
          ],
          recipe_items: { data: null, error: { message: "count failed" } },
        });

        const result = await inventoryService.updateIngredient(INGREDIENT_ID, {
          ...updateInput,
          unit: "g",
        });

        expect(result.data).toBeNull();
        expect(result.error).toBe("count failed");
      });
    });
  });

  describe("getIngredientRecipeUsageCount", () => {
    it("returns the count of recipe_items rows referencing the ingredient", async () => {
      mockTables({ recipe_items: { data: null, error: null, count: 3 } });

      const result =
        await inventoryService.getIngredientRecipeUsageCount(INGREDIENT_ID);

      expect(result.error).toBeNull();
      expect(result.data).toBe(3);
    });

    it("returns 0 when the ingredient is not referenced by any recipe", async () => {
      mockTables({ recipe_items: { data: null, error: null, count: 0 } });

      const result =
        await inventoryService.getIngredientRecipeUsageCount(INGREDIENT_ID);

      expect(result.error).toBeNull();
      expect(result.data).toBe(0);
    });

    it("propagates a query error", async () => {
      mockTables({
        recipe_items: { data: null, error: { message: "count query failed" } },
      });

      const result =
        await inventoryService.getIngredientRecipeUsageCount(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("count query failed");
    });
  });

  describe("deleteIngredient", () => {
    it("deletes successfully", async () => {
      mockTables({ ingredients: { data: null, error: null } });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.error).toBeNull();
      expect(result.data).toBeNull();
    });

    it("propagates a generic delete error unchanged", async () => {
      mockTables({
        ingredients: { data: null, error: { message: "delete failed" } },
      });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("delete failed");
    });

    it("maps a foreign-key violation from purchases to a friendly message instead of the raw Postgres text", async () => {
      mockTables({
        ingredients: {
          data: null,
          error: {
            code: "23503",
            message:
              'update or delete on table "ingredients" violates foreign key constraint "purchase_items_ingredient_id_fkey" on table "purchase_items"',
          },
        },
      });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This ingredient is used in purchases and cannot be deleted.",
      );
    });

    it("maps a foreign-key violation from recipes to a friendly message", async () => {
      mockTables({
        ingredients: {
          data: null,
          error: {
            code: "23503",
            message:
              'update or delete on table "ingredients" violates foreign key constraint "recipe_items_ingredient_id_fkey" on table "recipe_items"',
          },
        },
      });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This ingredient is used in recipes and cannot be deleted.",
      );
    });

    it("falls back to a generic 'used elsewhere' message for a referencing table with no specific phrase", async () => {
      mockTables({
        ingredients: {
          data: null,
          error: {
            code: "23503",
            message:
              'update or delete on table "ingredients" violates foreign key constraint "some_future_table_ingredient_id_fkey" on table "some_future_table"',
          },
        },
      });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "This ingredient is used elsewhere in the system and cannot be deleted.",
      );
    });

    it("maps a thrown exception to a fallback message", async () => {
      supabaseMock.from.mockImplementation(() => {
        throw new Error("connection lost");
      });

      const result = await inventoryService.deleteIngredient(INGREDIENT_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("connection lost");
    });
  });
});
