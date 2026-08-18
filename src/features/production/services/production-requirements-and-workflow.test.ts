/**
 * production-service.ts coverage, group 2 of 2 (Фаза 3 gap #5, last of 5).
 *
 * Companion to production-plan-crud.test.ts (see that file's header for the
 * overall scope note and mocking strategy). This file covers:
 *   - getRecipeOptions
 *   - calculateRequirements (the live BOM-explosion preview,
 *     buildLiveRequirements internally) -- this is exactly the "разузловка
 *     BOM и расчёт закупок в чистом TS, без записи в БД" logic the Фаза 0
 *     ADR explicitly allows to stay in TS. Nothing here moves it to SQL --
 *     only tests are added.
 *   - generateShoppingList (persists missing-quantity snapshot lines)
 *   - sendPurchaseDraftToPurchases (delegates to purchaseService)
 *   - generatePurchaseDraft (deprecated thin wrapper over the above)
 *
 * NOT covered in this pass: calculatePlanRequirements. It runs the same
 * BOM data through the real production-planning package's
 * calculateProductionPlan / generateShoppingList / generateProcurementRecommendation
 * pure engine (a second, more elaborate calculation pipeline distinct from
 * calculateRequirements/buildLiveRequirements tested below), which needs
 * its own realistic PlanningRecipe/PlanningInventoryItem fixtures to
 * exercise meaningfully. Left as an explicit gap given the size already
 * covered here across all five Фаза 3 files -- flagged in the final report,
 * not silently skipped.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, purchaseServiceMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
  purchaseServiceMock: { createDraftFromProductionPlan: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/purchases/services/purchase-service", () => ({
  purchaseService: purchaseServiceMock,
}));

import { productionService } from "./production-service";
import type { ProductionPlanWithRelations } from "../types/production";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const RECIPE_ID_2 = "55555555-5555-4555-8555-555555555555";
const FLOUR_ID = "66666666-6666-4666-8666-666666666666";
const BUTTER_ID = "77777777-7777-4777-8777-777777777777";

type QueryResult = { data: unknown; error: unknown };

function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.not = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

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

function planWithRelations(
  overrides?: Partial<ProductionPlanWithRelations>,
): ProductionPlanWithRelations {
  return {
    id: PLAN_ID,
    plan_number: 1,
    name: "Test Batch",
    status: "draft",
    planning_date: "2026-08-01",
    notes: null,
    shopping_list_generated_at: null,
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-01T08:00:00.000Z",
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
      planning_status: "draft",
    },
    ...overrides,
  };
}

describe("productionService (requirements calculation + workflow)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRecipeOptions", () => {
    it("only offers active component recipes (Critical Finding #4)", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Dough",
              yield_quantity: 10,
              yield_unit: "pcs",
              is_active: true,
            },
          ],
          error: null,
        },
        recipe_components: { data: [], error: null },
      });

      const result = await productionService.getRecipeOptions();

      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(1);
      expect(result.data?.[0]?.name).toBe("Dough");
    });

    it("hides recipes that are currently used as a Component sub-component", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Dough",
              yield_quantity: 10,
              yield_unit: "kg",
              is_active: true,
              recipe_role: "component",
            },
            {
              id: RECIPE_ID_2,
              name: "Marinade",
              yield_quantity: 1,
              yield_unit: "kg",
              is_active: true,
              recipe_role: "component",
            },
          ],
          error: null,
        },
        recipe_components: {
          data: [
            {
              assembly_recipe_id: RECIPE_ID,
              component_recipe_id: RECIPE_ID_2,
            },
          ],
          error: null,
        },
      });

      const result = await productionService.getRecipeOptions();

      expect(result.error).toBeNull();
      expect(result.data?.map((row) => row.id)).toEqual([RECIPE_ID]);
    });

    it("propagates a query error", async () => {
      supabaseMock.from.mockReturnValue(
        makeBuilder({ data: null, error: { message: "recipes query failed" } }),
      );

      const result = await productionService.getRecipeOptions();

      expect(result.data).toBeNull();
      expect(result.error).toBe("recipes query failed");
    });
  });

  describe("calculateRequirements (live BOM preview)", () => {
    it("returns an empty, sufficient result without querying the database when no product line is ready", async () => {
      const result = await productionService.calculateRequirements([
        { recipe_id: "", planned_quantity: 5 },
        { recipe_id: RECIPE_ID, planned_quantity: null },
        { recipe_id: RECIPE_ID, planned_quantity: 0 },
      ]);

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        lines: [],
        is_inventory_sufficient: true,
        missing_line_count: 0,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("aggregates required quantity across two products sharing an ingredient, and flags what's missing", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 10,
              yield_unit: "portion",
              is_active: true,
            },
            {
              id: RECIPE_ID_2,
              name: "Plain Crepe",
              yield_quantity: 5,
              yield_unit: "portion",
              is_active: true,
            },
          ],
          error: null,
        },
        recipe_items: {
          data: [
            {
              recipe_id: RECIPE_ID,
              ingredient_id: FLOUR_ID,
              quantity: 2,
              unit: "kg",
            },
            {
              recipe_id: RECIPE_ID_2,
              ingredient_id: FLOUR_ID,
              quantity: 1,
              unit: "kg",
            },
            {
              recipe_id: RECIPE_ID_2,
              ingredient_id: BUTTER_ID,
              quantity: 0.5,
              unit: "kg",
            },
          ],
          error: null,
        },
        ingredients: {
          data: [
            { id: FLOUR_ID, name: "Flour", unit: "kg", current_stock: 3 },
            { id: BUTTER_ID, name: "Butter", unit: "kg", current_stock: 1 },
          ],
          error: null,
        },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 20 }, // scale x2 -> 4kg flour
        { recipe_id: RECIPE_ID_2, planned_quantity: 5 }, // scale x1 -> 1kg flour, 0.5kg butter
      ]);

      expect(result.error).toBeNull();
      // Flour: required 4 + 1 = 5kg, stock 3kg -> missing 2kg.
      const flourLine = result.data?.lines.find(
        (line) => line.ingredient_id === FLOUR_ID,
      );
      expect(flourLine).toMatchObject({
        required_quantity: 5,
        current_stock: 3,
        missing_quantity: 2,
        is_sufficient: false,
      });
      // Butter: required 0.5kg, stock 1kg -> sufficient.
      const butterLine = result.data?.lines.find(
        (line) => line.ingredient_id === BUTTER_ID,
      );
      expect(butterLine).toMatchObject({
        required_quantity: 0.5,
        current_stock: 1,
        missing_quantity: 0,
        is_sufficient: true,
      });
      expect(result.data?.is_inventory_sufficient).toBe(false);
      expect(result.data?.missing_line_count).toBe(1);
    });

    it("defaults to zero stock and an 'Unknown ingredient' name when the ingredient row is missing", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 10,
              yield_unit: "portion",
              is_active: true,
            },
          ],
          error: null,
        },
        recipe_items: {
          data: [
            {
              recipe_id: RECIPE_ID,
              ingredient_id: FLOUR_ID,
              quantity: 2,
              unit: "kg",
            },
          ],
          error: null,
        },
        ingredients: { data: [], error: null }, // ingredient row missing/deleted
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.data?.lines[0]).toMatchObject({
        ingredient_name: "Unknown ingredient",
        current_stock: 0,
        missing_quantity: 2,
        is_sufficient: false,
      });
    });

    it("rejects when a selected recipe cannot be found", async () => {
      mockTables({
        recipes: { data: [], error: null },
        recipe_items: { data: [], error: null },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.data).toBeNull();
      expect(result.error).toBe("One or more selected recipes were not found");
    });

    it("rejects an inactive recipe by name", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 10,
              yield_unit: "portion",
              is_active: false,
            },
          ],
          error: null,
        },
        recipe_items: { data: [], error: null },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.error).toBe('Recipe "Chicken Crepe" is inactive');
    });

    it("rejects a recipe with an invalid (zero) yield", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 0,
              yield_unit: "portion",
              is_active: true,
            },
          ],
          error: null,
        },
        recipe_items: { data: [], error: null },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.error).toBe('Recipe "Chicken Crepe" has an invalid yield');
    });

    it("rejects a recipe with no BOM ingredients", async () => {
      mockTables({
        recipes: {
          data: [
            {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 10,
              yield_unit: "portion",
              is_active: true,
            },
          ],
          error: null,
        },
        recipe_items: { data: [], error: null },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.error).toBe('Recipe "Chicken Crepe" has no ingredients');
    });

    it("propagates an error loading recipes", async () => {
      mockTables({
        recipes: { data: null, error: { message: "recipes failed" } },
      });

      const result = await productionService.calculateRequirements([
        { recipe_id: RECIPE_ID, planned_quantity: 10 },
      ]);

      expect(result.data).toBeNull();
      expect(result.error).toBe("recipes failed");
    });
  });

  describe("generateShoppingList", () => {
    it("propagates an error loading the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: null,
        error: "plan not found",
      });

      const result = await productionService.generateShoppingList(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("plan not found");
    });

    it("rejects generating a shopping list for a cancelled/completed plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "completed" }),
        error: null,
      });

      const result = await productionService.generateShoppingList(PLAN_ID);

      expect(result.error).toBe(
        "Shopping list cannot be generated for this plan status",
      );
    });

    it("clears old shopping items and skips inserting when nothing is missing", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ ingredients: [] }),
        error: null,
      });
      let insertCalled = false;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === "production_plan_shopping_items") {
          const builder = makeBuilder({ data: null, error: null });
          builder.insert = vi.fn(() => {
            insertCalled = true;
            return builder;
          });
          return builder;
        }
        return makeBuilder({ data: null, error: null });
      });

      const result = await productionService.generateShoppingList(PLAN_ID);

      expect(result.error).toBeNull();
      expect(insertCalled).toBe(false);
      expect(supabaseMock.from).toHaveBeenCalledWith(
        "production_plan_shopping_items",
      );
    });

    it("persists a snapshot line for every ingredient with a missing quantity", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          ingredients: [
            {
              id: "ing-1",
              production_plan_id: PLAN_ID,
              ingredient_id: FLOUR_ID,
              ingredient_name: "Flour",
              unit: "kg",
              required_quantity: 5,
              inventory_quantity_at_planning: 3,
              missing_quantity: 2,
            },
            {
              id: "ing-2",
              production_plan_id: PLAN_ID,
              ingredient_id: BUTTER_ID,
              ingredient_name: "Butter",
              unit: "kg",
              required_quantity: 1,
              inventory_quantity_at_planning: 5,
              missing_quantity: 0,
            },
          ],
        }),
        error: null,
      });
      let capturedPayload: unknown;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === "production_plan_shopping_items") {
          const builder = makeBuilder({ data: null, error: null });
          builder.insert = vi.fn((payload: unknown) => {
            capturedPayload = payload;
            return builder;
          });
          return builder;
        }
        return makeBuilder({ data: null, error: null });
      });

      const result = await productionService.generateShoppingList(PLAN_ID);

      expect(result.error).toBeNull();
      expect(capturedPayload).toEqual([
        expect.objectContaining({
          production_plan_id: PLAN_ID,
          ingredient_id: FLOUR_ID,
          quantity: 2,
        }),
      ]);
    });

    it("fails when the insert errors", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          ingredients: [
            {
              id: "ing-1",
              production_plan_id: PLAN_ID,
              ingredient_id: FLOUR_ID,
              ingredient_name: "Flour",
              unit: "kg",
              required_quantity: 5,
              inventory_quantity_at_planning: 3,
              missing_quantity: 2,
            },
          ],
        }),
        error: null,
      });
      mockTables({
        production_plan_shopping_items: {
          data: null,
          error: { message: "insert failed" },
        },
      });

      const result = await productionService.generateShoppingList(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("insert failed");
    });
  });

  describe("sendPurchaseDraftToPurchases", () => {
    it("propagates an error loading the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: null,
        error: "plan not found",
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("plan not found");
    });

    it("rejects when a purchase draft is already linked", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          purchase_draft_status: "draft_created",
          linked_purchase: { id: "existing-purchase", status: "draft", invoice_number: null },
        }),
        error: null,
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.error).toBe("Already transferred.");
    });

    it("rejects an empty line list", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [],
      );

      expect(result.error).toBe(
        "Purchase Draft is empty. All required ingredients are available.",
      );
    });

    it("rejects when every line is filtered out as blank/zero", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [
          { ingredient_id: "  ", quantity: 5 },
          { ingredient_id: FLOUR_ID, quantity: 0 },
        ],
      );

      expect(result.error).toBe(
        "Calculate requirements before sending a Purchase Draft to Purchases.",
      );
    });

    it("creates the draft, transitions a draft plan to waiting_for_purchases, and returns the refreshed plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "draft", plan_number: 7 }),
        error: null,
      });
      purchaseServiceMock.createDraftFromProductionPlan.mockResolvedValue({
        data: { id: "new-purchase" },
        error: null,
      });
      let capturedStatusUpdate: unknown;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === "production_plans") {
          const builder = makeBuilder({ data: null, error: null });
          builder.update = vi.fn((payload: unknown) => {
            capturedStatusUpdate = payload;
            return builder;
          });
          return builder;
        }
        return makeBuilder({ data: null, error: null });
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.error).toBeNull();
      expect(
        purchaseServiceMock.createDraftFromProductionPlan,
      ).toHaveBeenCalledWith({
        production_plan_id: PLAN_ID,
        notes: "Generated from Production Plan #7",
        lines: [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      });
      expect(capturedStatusUpdate).toMatchObject({
        status: "waiting_for_purchases",
      });
    });

    it("does not touch plan status when the plan is not draft/planned (e.g. already ready_to_produce)", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "ready_to_produce" }),
        error: null,
      });
      purchaseServiceMock.createDraftFromProductionPlan.mockResolvedValue({
        data: { id: "new-purchase" },
        error: null,
      });
      let updateCalled = false;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === "production_plans") {
          updateCalled = true;
        }
        return makeBuilder({ data: null, error: null });
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.error).toBeNull();
      expect(updateCalled).toBe(false);
    });

    it("maps a 'Purchase Draft already exists.' failure to the duplicate error", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      purchaseServiceMock.createDraftFromProductionPlan.mockResolvedValue({
        data: null,
        error: "Purchase Draft already exists.",
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.error).toBe("Already transferred.");
    });

    it("passes through an unrelated draft-creation failure unchanged", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      purchaseServiceMock.createDraftFromProductionPlan.mockResolvedValue({
        data: null,
        error: "Supplier is required",
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.error).toBe("Supplier is required");
    });

    it("surfaces a partial-success error if the draft is created but the plan status update fails", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "draft" }),
        error: null,
      });
      purchaseServiceMock.createDraftFromProductionPlan.mockResolvedValue({
        data: { id: "new-purchase" },
        error: null,
      });
      mockTables({
        production_plans: {
          data: null,
          error: { message: "status update failed" },
        },
      });

      const result = await productionService.sendPurchaseDraftToPurchases(
        PLAN_ID,
        [{ ingredient_id: FLOUR_ID, quantity: 5 }],
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("status update failed");
    });
  });

  describe("generatePurchaseDraft (deprecated)", () => {
    it("propagates an error loading the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: null,
        error: "plan not found",
      });

      const result = await productionService.generatePurchaseDraft(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("plan not found");
    });

    it("rejects a plan with no persisted shopping items", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ shopping_items: [] }),
        error: null,
      });

      const result = await productionService.generatePurchaseDraft(PLAN_ID);

      expect(result.error).toBe(
        "Purchase Draft is empty. All required ingredients are available.",
      );
    });

    it("delegates to sendPurchaseDraftToPurchases with the persisted shopping list lines", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          shopping_items: [
            {
              id: "shop-1",
              production_plan_id: PLAN_ID,
              ingredient_id: FLOUR_ID,
              ingredient_name: "Flour",
              quantity: 4,
              unit: "kg",
            },
          ],
        }),
        error: null,
      });
      const sendSpy = vi
        .spyOn(productionService, "sendPurchaseDraftToPurchases")
        .mockResolvedValue({ data: planWithRelations(), error: null });

      await productionService.generatePurchaseDraft(PLAN_ID);

      expect(sendSpy).toHaveBeenCalledWith(PLAN_ID, [
        { ingredient_id: FLOUR_ID, quantity: 4 },
      ]);

      sendSpy.mockRestore();
    });
  });
});
