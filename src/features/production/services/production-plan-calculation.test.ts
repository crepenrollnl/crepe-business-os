/**
 * Coverage for `calculatePlanRequirements` (Фаза 3, small remaining tech
 * debt item -- the only one of production-service.ts's 13 public methods
 * still untested after the 07.08.2026 pass, see
 * production-requirements-and-workflow.test.ts's header note and
 * Plan_Deystviy_V1.txt).
 *
 * Unlike `calculateRequirements` (buildLiveRequirements, its own flat
 * in-file BOM math), this method runs the real production-planning
 * package engine end to end: calculateProductionPlan -> generateShoppingList
 * -> generateProcurementRecommendation -> generatePurchaseDrafts (via
 * mapPlanCalculationResult). None of those are mocked here -- they're pure,
 * deterministic functions, so realistic recipe/inventory fixtures exercise
 * the real arithmetic, not a stubbed result.
 *
 * Mocking strategy matches production-plan-crud.test.ts /
 * production-requirements-and-workflow.test.ts: only `supabase` is mocked.
 * The plan used throughout is `status: "draft"`, which keeps
 * getProductionPlanById's "planned"/"waiting_for_purchases" auto-readiness
 * RPC branch (already covered in production-plan-crud.test.ts) out of scope
 * here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
const FLOUR_ID = "66666666-6666-4666-8666-666666666666";
const CHICKEN_ID = "77777777-7777-4777-8777-777777777777";

type QueryResult = { data: unknown; error: unknown };

/**
 * Minimal thenable query-builder stub matching supabase-js's chainable
 * PostgrestFilterBuilder shape. Same pattern as production-plan-crud.test.ts.
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
    yield_quantity: 5,
    yield_unit: "portion",
    sort_order: 0,
    ...overrides,
  };
}

function recipeRow(overrides?: Record<string, unknown>) {
  return {
    id: RECIPE_ID,
    name: "Chicken Crepe",
    yield_quantity: 5,
    yield_unit: "portion",
    is_active: true,
    ...overrides,
  };
}

/**
 * Baseline table set covering everything getProductionPlanById +
 * resolveProductStatuses need, plus the recipe/recipe_items/ingredients
 * queries runDomainPlanCalculation makes afterward. Individual tests
 * override only what they care about.
 */
function baseTables(
  overrides?: Record<string, QueryResult | QueryResult[]>,
) {
  return {
    production_plans: { data: planRow(), error: null },
    production_plan_products: { data: [productRow()], error: null },
    production_plan_ingredients: { data: [], error: null },
    production_plan_shopping_items: { data: [], error: null },
    purchases: { data: [], error: null },
    recipes: { data: [recipeRow()], error: null },
    recipe_items: {
      data: [
        { recipe_id: RECIPE_ID, ingredient_id: FLOUR_ID, quantity: 2, unit: "kg" },
        { recipe_id: RECIPE_ID, ingredient_id: CHICKEN_ID, quantity: 1, unit: "kg" },
      ],
      error: null,
    },
    ingredients: {
      data: [
        { id: FLOUR_ID, name: "Flour", unit: "kg", current_stock: 10 },
        { id: CHICKEN_ID, name: "Chicken Breast", unit: "kg", current_stock: 1.5 },
      ],
      error: null,
    },
    ...overrides,
  };
}

describe("productionService.calculatePlanRequirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the real engine end to end, mixing a sufficient and a short-stock ingredient from the same recipe", async () => {
    // Recipe yields 5 portions from 2kg flour + 1kg chicken. Plan asks for
    // 10 portions -> scale x2 -> required 4kg flour, 2kg chicken.
    // Stock: flour 10kg (sufficient), chicken 1.5kg (short by 0.5kg).
    mockTables(baseTables());

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.error).toBeNull();
    expect(result.data?.ingredient_requirements).toEqual([
      {
        ingredient_id: CHICKEN_ID,
        ingredient_name: "Chicken Breast",
        required_quantity: 2,
        available_quantity: 1.5,
        missing_quantity: 0.5,
        unit: "kg",
        status: "low_stock",
      },
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: "Flour",
        required_quantity: 4,
        available_quantity: 10,
        missing_quantity: 0,
        unit: "kg",
        status: "available",
      },
    ]);

    expect(result.data?.shopping_list).toEqual([
      {
        ingredient_id: CHICKEN_ID,
        ingredient_name: "Chicken Breast",
        quantity: 0.5,
        unit: "kg",
      },
    ]);

    expect(result.data?.procurement_recommendations).toEqual([
      {
        ingredient_id: CHICKEN_ID,
        ingredient_name: "Chicken Breast",
        recommended_quantity: 0.5,
        packages: 1,
        reason: "No packaging data",
        unit: "kg",
      },
    ]);

    // No packaging/supplier data is passed anywhere in this pipeline, so
    // generatePurchaseDrafts groups everything into one unassigned draft.
    expect(result.data?.purchase_draft_review).toEqual([
      {
        supplier_name: null,
        ingredient_id: CHICKEN_ID,
        ingredient_name: "Chicken Breast",
        quantity: 0.5,
        packages: 1,
        reason: "No packaging data",
        unit: "kg",
      },
    ]);
    expect(result.data?.purchase_draft_summary).toEqual({
      items: 1,
      packages: 1,
      total_purchase_quantity: 0.5,
    });

    expect(result.data?.has_shortages).toBe(true);
  });

  it("reports no shortages and empty shopping/procurement/purchase-draft lists when stock covers everything", async () => {
    mockTables(
      baseTables({
        ingredients: {
          data: [
            { id: FLOUR_ID, name: "Flour", unit: "kg", current_stock: 10 },
            { id: CHICKEN_ID, name: "Chicken Breast", unit: "kg", current_stock: 5 },
          ],
          error: null,
        },
      }),
    );

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.error).toBeNull();
    expect(
      result.data?.ingredient_requirements.every(
        (line) => line.status === "available",
      ),
    ).toBe(true);
    expect(result.data?.shopping_list).toEqual([]);
    expect(result.data?.procurement_recommendations).toEqual([]);
    expect(result.data?.purchase_draft_review).toEqual([]);
    expect(result.data?.purchase_draft_summary).toEqual({
      items: 0,
      packages: 0,
      total_purchase_quantity: 0,
    });
    expect(result.data?.has_shortages).toBe(false);
  });

  it("fails with a clear message and never reaches the recipe/inventory queries when the plan has no products", async () => {
    mockTables(baseTables({ production_plan_products: { data: [], error: null } }));

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Add at least one product before calculating requirements",
    );
    expect(supabaseMock.from).not.toHaveBeenCalledWith("recipe_items");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("ingredients");
  });

  it("fails naming the recipe when a product's recipe has no ingredients", async () => {
    mockTables(baseTables({ recipe_items: { data: [], error: null } }));

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe('Recipe "Chicken Crepe" has no ingredients');
  });

  it("falls back to the raw ingredient id (not 'Unknown ingredient') when the ingredient's master row no longer exists", async () => {
    // Distinct from calculateRequirements/buildLiveRequirements, which has
    // its own separate "Unknown ingredient" fallback -- the real
    // production-planning engine's mapper falls back to the ingredient id
    // itself when no name was supplied in the inventory snapshot.
    mockTables(
      baseTables({
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
        ingredients: { data: [], error: null },
      }),
    );

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.error).toBeNull();
    expect(result.data?.ingredient_requirements).toEqual([
      {
        ingredient_id: FLOUR_ID,
        ingredient_name: FLOUR_ID,
        required_quantity: 4,
        available_quantity: 0,
        missing_quantity: 4,
        unit: "kg",
        status: "missing",
      },
    ]);
  });

  it("propagates a plan-load failure unchanged", async () => {
    mockTables(
      baseTables({
        production_plans: { data: null, error: { message: "plan not found" } },
      }),
    );

    const result = await productionService.calculatePlanRequirements(PLAN_ID);

    expect(result.data).toBeNull();
    expect(result.error).toBe("plan not found");
  });
});
