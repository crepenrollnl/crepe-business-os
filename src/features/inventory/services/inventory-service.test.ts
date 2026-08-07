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
 * One test below deliberately documents existing, NOT-fixed-here behavior
 * flagged in Фаза 2 tech debt: deleteIngredient's toUserError has no `map`
 * for foreign-key violations (only for duplicate names), so a raw Postgres
 * error message reaches the caller unchanged when deletion is blocked by a
 * reference from purchases/recipes. See AGENTS.md / plan Фаза 2 entry
 * "Сырые технические сообщения об ошибках при удалении".
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

type QueryResult = { data: unknown; error: unknown };

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

    it("DOCUMENTS EXISTING BEHAVIOR (Фаза 2 tech debt, not fixed here): a foreign-key violation surfaces its raw Postgres message unchanged, not a friendly one -- deleteIngredient's toUserError only maps 23505 duplicate-name errors, not 23503 FK violations", async () => {
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
      // Raw Postgres text reaches the caller as-is -- this is the tracked
      // gap, not a regression introduced by this test file.
      expect(result.error).toBe(
        'update or delete on table "ingredients" violates foreign key constraint "purchase_items_ingredient_id_fkey" on table "purchase_items"',
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
