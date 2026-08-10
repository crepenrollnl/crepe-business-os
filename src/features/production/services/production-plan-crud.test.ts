/**
 * production-service.ts coverage, group 1 of 2 (Фаза 3 gap #5, last of 5).
 *
 * production-service.ts is 1624 lines with zero tests before this pass,
 * except confirmProductionPlan (production-service.test.ts, added earlier
 * for the Production Planning status-deadlock finding -- left untouched
 * here, not duplicated).
 *
 * This file covers Plan CRUD + product-line CRUD, the "reference module"
 * portion of the original Фаза 3 audit description:
 *   - getProductionPlans / getProductionPlanById (including the
 *     "planned"/"waiting_for_purchases" -> auto readiness-check side
 *     effect via the check_production_plan_readiness RPC)
 *   - createProductionPlan
 *   - addProductToPlan / updatePlanProductQuantity / removeProductFromPlan
 *
 * Field-level validation rules (name/planning_date/recipe_id/quantity) are
 * NOT re-tested here in depth -- they already have their own dedicated
 * test files (validate-create-production-plan.test.ts,
 * validate-plan-product.test.ts). Each mutation method gets exactly one
 * test proving it actually calls that validator and short-circuits before
 * touching the database; the validation rules themselves are out of scope.
 *
 * Mocking strategy: production-service.ts's own methods call `this.xxx`
 * on themselves internally (e.g. addProductToPlan calls
 * this.getProductionPlanById after mutating). Where that happens, tests
 * use vi.spyOn(productionService, "getProductionPlanById") to isolate the
 * method under test -- the same pattern already established in
 * production-service.test.ts for confirmProductionPlan. getProductionPlanById
 * and getProductionPlans themselves cannot use that shortcut (they ARE the
 * thing being tested), so those two get full multi-table Supabase mocks.
 *
 * The BOM/requirements-calculation half of this file (calculateRequirements,
 * calculatePlanRequirements, generateShoppingList, sendPurchaseDraftToPurchases,
 * generatePurchaseDraft) is covered separately in
 * production-requirements-and-workflow.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateProductionPlanInput,
  ProductionPlanWithRelations,
} from "../types/production";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/purchases/services/purchase-service", () => ({
  purchaseService: { createDraftFromProductionPlan: vi.fn() },
}));

import { productionService } from "./production-service";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape. Same pattern as the other Фаза 3 test
 * files (finished-goods-read-service.test.ts, production-batch-service.test.ts,
 * inventory-service.test.ts).
 */
function makeBuilder(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.single = vi.fn(chain);
  builder.maybeSingle = vi.fn(chain);
  builder.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

/**
 * Configure supabaseMock.from to return per-table builders. A table entry
 * may be a single result (every call gets it) or an array consumed in call
 * order (needed where the same table is queried more than once per flow).
 * Tables not listed default to an empty successful result.
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

function planRow(overrides?: Record<string, unknown>) {
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
    ...overrides,
  };
}

function productRow(overrides?: Record<string, unknown>) {
  return {
    id: PRODUCT_ID,
    production_plan_id: PLAN_ID,
    recipe_id: RECIPE_ID,
    recipe_name: "Chicken Crepe",
    planned_quantity: 10,
    yield_quantity: 1,
    yield_unit: "portion",
    sort_order: 0,
    ...overrides,
  };
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

describe("productionService (plan + product CRUD)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getProductionPlanById", () => {
    it("loads a plan with its products, ingredients, shopping items, and linked purchase", async () => {
      mockTables({
        production_plans: { data: planRow(), error: null },
        production_plan_products: { data: [productRow()], error: null },
        production_plan_ingredients: {
          data: [
            {
              id: "ing-1",
              production_plan_id: PLAN_ID,
              ingredient_id: "flour-id",
              ingredient_name: "Flour",
              unit: "kg",
              required_quantity: 5,
              inventory_quantity_at_planning: 2,
              missing_quantity: 3,
            },
          ],
          error: null,
        },
        production_plan_shopping_items: { data: [], error: null },
        purchases: { data: [], error: null },
        recipes: { data: [{ id: RECIPE_ID, is_active: true }], error: null },
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(result.error).toBeNull();
      expect(result.data?.products).toHaveLength(1);
      expect(result.data?.products[0]).toMatchObject({
        recipe_id: RECIPE_ID,
        status: "active",
      });
      expect(result.data?.summary).toMatchObject({
        planned_product_count: 1,
        total_ingredient_lines: 1,
        missing_ingredient_lines: 1, // one line has missing_quantity > 0
      });
    });

    it("marks a product's recipe as inactive when the recipe was archived or deleted", async () => {
      mockTables({
        production_plans: { data: planRow(), error: null },
        production_plan_products: { data: [productRow()], error: null },
        production_plan_ingredients: { data: [], error: null },
        production_plan_shopping_items: { data: [], error: null },
        purchases: { data: [], error: null },
        recipes: { data: [], error: null }, // recipe no longer resolves
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(result.data?.products[0]?.status).toBe("inactive");
    });

    it("fails when the plan header query errors", async () => {
      mockTables({
        production_plans: { data: null, error: { message: "plan not found" } },
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("plan not found");
    });

    it("fails when loading plan relations errors", async () => {
      mockTables({
        production_plans: { data: planRow(), error: null },
        production_plan_products: {
          data: null,
          error: { message: "products query failed" },
        },
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("products query failed");
    });

    it("runs the server-side readiness check and reflects the resulting status for a 'planned' plan", async () => {
      mockTables({
        production_plans: { data: planRow({ status: "planned" }), error: null },
        production_plan_products: { data: [], error: null },
        production_plan_ingredients: { data: [], error: null },
        production_plan_shopping_items: { data: [], error: null },
        purchases: { data: [], error: null },
      });
      supabaseMock.rpc.mockResolvedValue({
        data: planRow({ status: "ready_to_produce" }),
        error: null,
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "check_production_plan_readiness",
        { p_plan_id: PLAN_ID },
      );
      expect(result.error).toBeNull();
      expect(result.data?.status).toBe("ready_to_produce");
    });

    it("runs the readiness check for a 'waiting_for_purchases' plan too", async () => {
      mockTables({
        production_plans: {
          data: planRow({ status: "waiting_for_purchases" }),
          error: null,
        },
        production_plan_products: { data: [], error: null },
        production_plan_ingredients: { data: [], error: null },
        production_plan_shopping_items: { data: [], error: null },
        purchases: { data: [], error: null },
      });
      supabaseMock.rpc.mockResolvedValue({
        data: planRow({ status: "waiting_for_purchases" }),
        error: null,
      });

      await productionService.getProductionPlanById(PLAN_ID);

      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    });

    it("does not call the readiness RPC for draft/ready_to_produce/completed/cancelled plans", async () => {
      for (const status of [
        "draft",
        "ready_to_produce",
        "completed",
        "cancelled",
      ] as const) {
        vi.clearAllMocks();
        mockTables({
          production_plans: { data: planRow({ status }), error: null },
          production_plan_products: { data: [], error: null },
          production_plan_ingredients: { data: [], error: null },
          production_plan_shopping_items: { data: [], error: null },
          purchases: { data: [], error: null },
        });

        await productionService.getProductionPlanById(PLAN_ID);

        expect(supabaseMock.rpc).not.toHaveBeenCalled();
      }
    });

    it("fails when the readiness RPC itself errors", async () => {
      mockTables({
        production_plans: { data: planRow({ status: "planned" }), error: null },
        production_plan_products: { data: [], error: null },
        production_plan_ingredients: { data: [], error: null },
        production_plan_shopping_items: { data: [], error: null },
        purchases: { data: [], error: null },
      });
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: { message: "readiness check failed" },
      });

      const result = await productionService.getProductionPlanById(PLAN_ID);

      expect(result.data).toBeNull();
      expect(result.error).toBe("readiness check failed");
    });
  });

  describe("getProductionPlans", () => {
    it("returns an empty list without querying product/ingredient tables when there are no plans", async () => {
      mockTables({
        production_plans: { data: [], error: null },
        purchases: { data: [], error: null },
      });

      const result = await productionService.getProductionPlans();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
      expect(supabaseMock.from).not.toHaveBeenCalledWith(
        "production_plan_products",
      );
    });

    it("aggregates product_count and missing_ingredient_lines per plan", async () => {
      const otherPlanId = "44444444-4444-4444-8444-444444444444";
      mockTables({
        production_plans: {
          data: [planRow(), planRow({ id: otherPlanId })],
          error: null,
        },
        production_plan_products: {
          data: [
            { production_plan_id: PLAN_ID },
            { production_plan_id: PLAN_ID },
            { production_plan_id: otherPlanId },
          ],
          error: null,
        },
        production_plan_ingredients: {
          data: [
            { production_plan_id: PLAN_ID, missing_quantity: 3 },
            { production_plan_id: PLAN_ID, missing_quantity: 0 },
            { production_plan_id: otherPlanId, missing_quantity: 0 },
          ],
          error: null,
        },
        purchases: { data: [], error: null },
      });

      const result = await productionService.getProductionPlans();

      const first = result.data?.find((plan) => plan.id === PLAN_ID);
      const second = result.data?.find((plan) => plan.id === otherPlanId);
      expect(first).toMatchObject({
        product_count: 2,
        missing_ingredient_lines: 1,
      });
      expect(second).toMatchObject({
        product_count: 1,
        missing_ingredient_lines: 0,
      });
    });

    it("runs the readiness check for each planned/waiting_for_purchases plan in the list", async () => {
      mockTables({
        production_plans: {
          data: [planRow({ status: "planned" }), planRow({ status: "draft" })],
          error: null,
        },
        production_plan_products: { data: [], error: null },
        production_plan_ingredients: { data: [], error: null },
        purchases: { data: [], error: null },
      });
      supabaseMock.rpc.mockResolvedValue({
        data: planRow({ status: "ready_to_produce" }),
        error: null,
      });

      await productionService.getProductionPlans();

      // Only the "planned" plan should trigger the RPC, not the "draft" one.
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    });

    it("propagates an error from the plans query", async () => {
      mockTables({
        production_plans: { data: null, error: { message: "list failed" } },
      });

      const result = await productionService.getProductionPlans();

      expect(result.data).toBeNull();
      expect(result.error).toBe("list failed");
    });
  });

  describe("createProductionPlan", () => {
    const validInput: CreateProductionPlanInput = {
      name: "New Batch",
      planning_date: "2026-08-10",
      notes: "",
    };

    it("rejects an invalid input without touching the database", async () => {
      const result = await productionService.createProductionPlan({
        name: "",
        planning_date: "2026-08-10",
        notes: "",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Name is required");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("creates the plan and returns the freshly loaded record", async () => {
      mockTables({
        production_plans: { data: planRow({ name: "New Batch" }), error: null },
      });
      const refreshed = planWithRelations({ name: "New Batch" });
      const getByIdSpy = vi
        .spyOn(productionService, "getProductionPlanById")
        .mockResolvedValue({ data: refreshed, error: null });

      const result = await productionService.createProductionPlan(validInput);

      expect(result.error).toBeNull();
      expect(result.data).toEqual(refreshed);
      expect(getByIdSpy).toHaveBeenCalledWith(PLAN_ID);

      getByIdSpy.mockRestore();
    });

    it("nulls out blank notes and trims the name before inserting", async () => {
      let capturedPayload: Record<string, unknown> | undefined;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table !== "production_plans") {
          return makeBuilder({ data: [], error: null });
        }
        const builder = makeBuilder({ data: planRow(), error: null });
        builder.insert = vi.fn((payload: Record<string, unknown>) => {
          capturedPayload = payload;
          return builder;
        });
        return builder;
      });
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });

      await productionService.createProductionPlan({
        name: "  Padded Name  ",
        planning_date: "2026-08-10",
        notes: "   ",
      });

      expect(capturedPayload).toMatchObject({
        name: "Padded Name",
        notes: null,
        status: "draft",
      });
    });

    it("fails when the insert errors", async () => {
      mockTables({
        production_plans: { data: null, error: { message: "insert failed" } },
      });

      const result = await productionService.createProductionPlan(validInput);

      expect(result.data).toBeNull();
      expect(result.error).toBe("insert failed");
    });
  });

  describe("addProductToPlan", () => {
    it("rejects invalid input without loading the plan", async () => {
      const getByIdSpy = vi.spyOn(productionService, "getProductionPlanById");

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: "",
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Select a finished good");
      expect(getByIdSpy).not.toHaveBeenCalled();

      getByIdSpy.mockRestore();
    });

    it("rejects adding to a locked (completed/cancelled) plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "completed" }),
        error: null,
      });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Products cannot be changed for this production plan status.",
      );
    });

    it("rejects a recipe already on the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: PRODUCT_ID,
              production_plan_id: PLAN_ID,
              recipe_id: RECIPE_ID,
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 0,
              status: "active",
            },
          ],
        }),
        error: null,
      });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("This finished good is already on the plan.");
    });

    it("rejects a recipe id that does not resolve to any recipe", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      mockTables({ recipes: { data: null, error: null } });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Recipe must exist for the selected product.");
    });

    it("rejects an archived (inactive) recipe", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      mockTables({
        recipes: {
          data: {
            id: RECIPE_ID,
            name: "Chicken Crepe",
            yield_quantity: 1,
            yield_unit: "portion",
            is_active: false,
          },
          error: null,
        },
      });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Archived products cannot be added to a production plan.",
      );
    });

    it("adds the product at the next sort_order and returns the refreshed plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: "existing-product",
              production_plan_id: PLAN_ID,
              recipe_id: "other-recipe",
              recipe_name: "Other",
              planned_quantity: 1,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 2,
              status: "active",
            },
          ],
        }),
        error: null,
      });
      let capturedPayload: Record<string, unknown> | undefined;
      supabaseMock.from.mockImplementation((table: string) => {
        if (table === "recipes") {
          return makeBuilder({
            data: {
              id: RECIPE_ID,
              name: "Chicken Crepe",
              yield_quantity: 1,
              yield_unit: "portion",
              is_active: true,
            },
            error: null,
          });
        }
        if (table === "production_plan_products") {
          const builder = makeBuilder({ data: null, error: null });
          builder.insert = vi.fn((payload: Record<string, unknown>) => {
            capturedPayload = payload;
            return builder;
          });
          return builder;
        }
        return makeBuilder({ data: null, error: null });
      });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.error).toBeNull();
      expect(capturedPayload).toMatchObject({
        production_plan_id: PLAN_ID,
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
        sort_order: 3, // max existing sort_order (2) + 1
      });
    });

    it("fails when the insert itself errors", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations(),
        error: null,
      });
      mockTables({
        recipes: {
          data: {
            id: RECIPE_ID,
            name: "Chicken Crepe",
            yield_quantity: 1,
            yield_unit: "portion",
            is_active: true,
          },
          error: null,
        },
        production_plan_products: {
          data: null,
          error: { message: "insert failed" },
        },
      });

      const result = await productionService.addProductToPlan(PLAN_ID, {
        recipe_id: RECIPE_ID,
        planned_quantity: 5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("insert failed");
    });
  });

  describe("updatePlanProductQuantity", () => {
    it("rejects invalid input without loading the plan", async () => {
      const getByIdSpy = vi.spyOn(productionService, "getProductionPlanById");

      const result = await productionService.updatePlanProductQuantity(
        PLAN_ID,
        PRODUCT_ID,
        { planned_quantity: 0 },
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("Planned Quantity must be greater than zero");
      expect(getByIdSpy).not.toHaveBeenCalled();

      getByIdSpy.mockRestore();
    });

    it("rejects updating a locked plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "cancelled" }),
        error: null,
      });

      const result = await productionService.updatePlanProductQuantity(
        PLAN_ID,
        PRODUCT_ID,
        { planned_quantity: 5 },
      );

      expect(result.error).toBe(
        "Products cannot be changed for this production plan status.",
      );
    });

    it("rejects a product id that is not on the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ products: [] }),
        error: null,
      });

      const result = await productionService.updatePlanProductQuantity(
        PLAN_ID,
        PRODUCT_ID,
        { planned_quantity: 5 },
      );

      expect(result.error).toBe("Product was not found on this production plan");
    });

    it("updates the quantity and returns the refreshed plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: PRODUCT_ID,
              production_plan_id: PLAN_ID,
              recipe_id: RECIPE_ID,
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 0,
              status: "active",
            },
          ],
        }),
        error: null,
      });
      mockTables({
        production_plan_products: { data: null, error: null },
        production_plans: { data: null, error: null },
      });

      const result = await productionService.updatePlanProductQuantity(
        PLAN_ID,
        PRODUCT_ID,
        { planned_quantity: 20 },
      );

      expect(result.error).toBeNull();
    });

    it("fails when the update itself errors", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: PRODUCT_ID,
              production_plan_id: PLAN_ID,
              recipe_id: RECIPE_ID,
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 0,
              status: "active",
            },
          ],
        }),
        error: null,
      });
      mockTables({
        production_plan_products: {
          data: null,
          error: { message: "update failed" },
        },
      });

      const result = await productionService.updatePlanProductQuantity(
        PLAN_ID,
        PRODUCT_ID,
        { planned_quantity: 20 },
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("update failed");
    });
  });

  describe("removeProductFromPlan", () => {
    it("rejects removing from a locked plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ status: "completed" }),
        error: null,
      });

      const result = await productionService.removeProductFromPlan(
        PLAN_ID,
        PRODUCT_ID,
      );

      expect(result.error).toBe(
        "Products cannot be changed for this production plan status.",
      );
    });

    it("rejects a product id that is not on the plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({ products: [] }),
        error: null,
      });

      const result = await productionService.removeProductFromPlan(
        PLAN_ID,
        PRODUCT_ID,
      );

      expect(result.error).toBe("Product was not found on this production plan");
    });

    it("removes the product and returns the refreshed plan", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: PRODUCT_ID,
              production_plan_id: PLAN_ID,
              recipe_id: RECIPE_ID,
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 0,
              status: "active",
            },
          ],
        }),
        error: null,
      });
      mockTables({
        production_plan_products: { data: null, error: null },
        production_plans: { data: null, error: null },
      });

      const result = await productionService.removeProductFromPlan(
        PLAN_ID,
        PRODUCT_ID,
      );

      expect(result.error).toBeNull();
    });

    it("fails when the delete itself errors", async () => {
      vi.spyOn(productionService, "getProductionPlanById").mockResolvedValue({
        data: planWithRelations({
          products: [
            {
              id: PRODUCT_ID,
              production_plan_id: PLAN_ID,
              recipe_id: RECIPE_ID,
              recipe_name: "Chicken Crepe",
              planned_quantity: 10,
              yield_quantity: 1,
              yield_unit: "portion",
              sort_order: 0,
              status: "active",
            },
          ],
        }),
        error: null,
      });
      mockTables({
        production_plan_products: {
          data: null,
          error: { message: "delete failed" },
        },
      });

      const result = await productionService.removeProductFromPlan(
        PLAN_ID,
        PRODUCT_ID,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("delete failed");
    });
  });
});
