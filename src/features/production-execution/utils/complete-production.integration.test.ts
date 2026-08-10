/**
 * Integration tests for Complete Production (PRD-001).
 *
 * Covers the atomic completion workflow without a live database by using an
 * in-memory ledger that mirrors sql/007_complete_production.sql:
 *   inventory transactions → production batches → session update
 * All steps commit together or roll back together.
 */

import { describe, expect, it } from "vitest";
import {
  assertCanCompleteProductionSession,
  buildCompleteProductionPlan,
  validateInventoryForCompletion,
  type CompleteProductionPlan,
  type CompleteProductionRecipeBom,
} from "./complete-production";

interface IngredientState {
  id: string;
  name: string;
  current_stock: number;
  cost_per_unit: number;
}

interface SessionState {
  id: string;
  status: "ready" | "in_progress" | "completed" | "cancelled";
  completed_at: string | null;
  completed_by: string | null;
}

interface InventoryTransaction {
  id: string;
  type: "production";
  reference_id: string;
  amount: number;
}

interface StockMovement {
  id: string;
  ingredient_id: string | null;
  product_id: string | null;
  movement_type: "production_out" | "production_in";
  quantity: number;
  unit_cost: number;
  transaction_id: string;
}

interface ProductionBatchRecord {
  id: string;
  session_id: string;
  finished_good_id: string;
  produced_quantity: number;
  unit_cost: number;
  total_cost: number;
}

interface LedgerSnapshot {
  ingredients: Map<string, IngredientState>;
  session: SessionState;
  transactions: InventoryTransaction[];
  stock_movements: StockMovement[];
  batches: ProductionBatchRecord[];
}

type FailAt =
  | "inventory_transaction"
  | "production_batch"
  | "finished_goods"
  | "session_update";

interface CompleteArgs {
  session: SessionState;
  ingredients: Map<string, IngredientState>;
  plan: CompleteProductionPlan;
  completedBy: string;
  now?: string;
  /** Force a failure after earlier mutations to prove rollback. */
  failAt?: FailAt;
}

type CompleteResult =
  | {
      ok: true;
      ledger: LedgerSnapshot;
      transaction_id: string;
      batch_ids: string[];
      total_cost: number;
    }
  | { ok: false; error: string; ledger: LedgerSnapshot };

function cloneLedger(
  session: SessionState,
  ingredients: Map<string, IngredientState>,
): LedgerSnapshot {
  return {
    session: { ...session },
    ingredients: new Map(
      [...ingredients.entries()].map(([id, row]) => [id, { ...row }]),
    ),
    transactions: [],
    stock_movements: [],
    batches: [],
  };
}

/**
 * Mirrors the SQL RPC body: mutate a working copy, commit only on success.
 * Any thrown/failed step discards the working copy (full rollback).
 */
function completeProductionInOneTransaction(args: CompleteArgs): CompleteResult {
  const baseline = cloneLedger(args.session, args.ingredients);
  const working = cloneLedger(args.session, args.ingredients);
  const now = args.now ?? "2026-07-21T12:00:00.000Z";

  const statusError = assertCanCompleteProductionSession(working.session.status);
  if (statusError) {
    return { ok: false, error: statusError, ledger: baseline };
  }

  const inventoryError = validateInventoryForCompletion(args.plan.consumptions);
  if (inventoryError) {
    return { ok: false, error: inventoryError, ledger: baseline };
  }

  try {
    if (args.failAt === "inventory_transaction") {
      throw new Error("Forced failure during inventory transaction.");
    }

    const transactionId = "txn-1";
    working.transactions.push({
      id: transactionId,
      type: "production",
      reference_id: working.session.id,
      amount: args.plan.total_cost,
    });

    for (const consumption of args.plan.consumptions) {
      const ingredient = working.ingredients.get(consumption.ingredient_id);
      if (!ingredient) {
        throw new Error(`Ingredient not found: ${consumption.ingredient_id}`);
      }

      if (ingredient.current_stock < consumption.quantity) {
        throw new Error(
          `Insufficient stock for "${ingredient.name}". Required ${consumption.quantity}, available ${ingredient.current_stock}.`,
        );
      }

      ingredient.current_stock -= consumption.quantity;

      working.stock_movements.push({
        id: `sm-out-${consumption.ingredient_id}`,
        ingredient_id: consumption.ingredient_id,
        product_id: null,
        movement_type: "production_out",
        quantity: consumption.quantity,
        unit_cost: consumption.unit_cost,
        transaction_id: transactionId,
      });
    }

    if (args.failAt === "production_batch") {
      throw new Error("Forced failure during production batch creation.");
    }

    const batchIds: string[] = [];

    for (const [index, batch] of args.plan.batches.entries()) {
      const batchId = `batch-${index + 1}`;
      batchIds.push(batchId);

      working.batches.push({
        id: batchId,
        session_id: working.session.id,
        finished_good_id: batch.finished_good_id,
        produced_quantity: batch.produced_quantity,
        unit_cost: batch.unit_cost,
        total_cost: batch.total_cost,
      });

      if (args.failAt === "finished_goods") {
        throw new Error("Forced failure while registering finished goods.");
      }

      working.stock_movements.push({
        id: `sm-in-${batchId}`,
        ingredient_id: null,
        product_id: batch.finished_good_id,
        movement_type: "production_in",
        quantity: batch.produced_quantity,
        unit_cost: batch.unit_cost,
        transaction_id: transactionId,
      });
    }

    if (args.failAt === "session_update") {
      throw new Error("Forced failure while updating production session.");
    }

    if (working.session.status !== "in_progress") {
      throw new Error("This production session is already completed.");
    }

    working.session.status = "completed";
    working.session.completed_at = now;
    working.session.completed_by = args.completedBy;

    return {
      ok: true,
      ledger: working,
      transaction_id: transactionId,
      batch_ids: batchIds,
      total_cost: args.plan.total_cost,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Completion failed.",
      // Discard working copy — full rollback.
      ledger: baseline,
    };
  }
}

function recipeBom(): CompleteProductionRecipeBom {
  return {
    recipe_id: "recipe-1",
    recipe_name: "Chicken Crepe",
    yield_quantity: 10,
    is_active: true,
    ingredients: [
      {
        ingredient_id: "flour",
        quantity_per_yield: 2,
        unit: "kg",
        cost_per_unit: 1.5,
        name: "Flour",
        current_stock: 100,
      },
      {
        ingredient_id: "milk",
        quantity_per_yield: 1,
        unit: "l",
        cost_per_unit: 2,
        name: "Milk",
        current_stock: 50,
      },
    ],
  };
}

function buildHappyPlan(actual = 5) {
  const plan = buildCompleteProductionPlan(
    [
      {
        line_id: "line-1",
        recipe_id: "recipe-1",
        product_name: "Chicken Crepe",
        actual_produced_quantity: actual,
      },
    ],
    new Map([["recipe-1", recipeBom()]]),
  );

  if (!plan.ok) {
    throw new Error(plan.error);
  }

  return plan.plan;
}

describe("Complete Production integration (PRD-001)", () => {
  it("happy path: consumes inventory, creates batch, completes session", () => {
    const plan = buildHappyPlan(5);
    const ingredients = new Map<string, IngredientState>([
      [
        "flour",
        { id: "flour", name: "Flour", current_stock: 100, cost_per_unit: 1.5 },
      ],
      [
        "milk",
        { id: "milk", name: "Milk", current_stock: 50, cost_per_unit: 2 },
      ],
    ]);

    const result = completeProductionInOneTransaction({
      session: {
        id: "session-1",
        status: "in_progress",
        completed_at: null,
        completed_by: null,
      },
      ingredients,
      plan,
      completedBy: "user-1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.ledger.session).toMatchObject({
      status: "completed",
      completed_by: "user-1",
      completed_at: "2026-07-21T12:00:00.000Z",
    });

    expect(result.ledger.ingredients.get("flour")?.current_stock).toBe(99);
    expect(result.ledger.ingredients.get("milk")?.current_stock).toBe(49.5);

    expect(result.ledger.transactions).toHaveLength(1);
    expect(result.ledger.stock_movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movement_type: "production_out",
          ingredient_id: "flour",
          quantity: 1,
        }),
        expect.objectContaining({
          movement_type: "production_out",
          ingredient_id: "milk",
          quantity: 0.5,
        }),
        expect.objectContaining({
          movement_type: "production_in",
          product_id: "recipe-1",
          quantity: 5,
          unit_cost: 0.5,
        }),
      ]),
    );

    expect(result.ledger.batches).toHaveLength(1);
    expect(result.ledger.batches[0]).toMatchObject({
      produced_quantity: 5,
      unit_cost: 0.5,
      total_cost: 2.5,
    });
    expect(result.total_cost).toBe(2.5);
  });

  it("insufficient inventory: no inventory transactions, batch, or session change", () => {
    const shortBom: CompleteProductionRecipeBom = {
      ...recipeBom(),
      ingredients: recipeBom().ingredients.map((ingredient) =>
        ingredient.ingredient_id === "flour"
          ? { ...ingredient, current_stock: 0.25 }
          : ingredient,
      ),
    };

    const planResult = buildCompleteProductionPlan(
      [
        {
          line_id: "line-1",
          recipe_id: "recipe-1",
          product_name: "Chicken Crepe",
          actual_produced_quantity: 5,
        },
      ],
      new Map([["recipe-1", shortBom]]),
    );

    expect(planResult.ok).toBe(true);
    if (!planResult.ok) {
      return;
    }

    const ingredients = new Map<string, IngredientState>([
      [
        "flour",
        { id: "flour", name: "Flour", current_stock: 0.25, cost_per_unit: 1.5 },
      ],
      [
        "milk",
        { id: "milk", name: "Milk", current_stock: 50, cost_per_unit: 2 },
      ],
    ]);

    const result = completeProductionInOneTransaction({
      session: {
        id: "session-1",
        status: "in_progress",
        completed_at: null,
        completed_by: null,
      },
      ingredients,
      plan: planResult.plan,
      completedBy: "user-1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("Insufficient stock for \"Flour\"");
    expect(result.ledger.session.status).toBe("in_progress");
    expect(result.ledger.session.completed_at).toBeNull();
    expect(result.ledger.transactions).toHaveLength(0);
    expect(result.ledger.stock_movements).toHaveLength(0);
    expect(result.ledger.batches).toHaveLength(0);
    expect(result.ledger.ingredients.get("flour")?.current_stock).toBe(0.25);
    expect(result.ledger.ingredients.get("milk")?.current_stock).toBe(50);
  });

  it("rollback on failure: inventory and session unchanged when batch creation fails", () => {
    const plan = buildHappyPlan(5);
    const ingredients = new Map<string, IngredientState>([
      [
        "flour",
        { id: "flour", name: "Flour", current_stock: 100, cost_per_unit: 1.5 },
      ],
      [
        "milk",
        { id: "milk", name: "Milk", current_stock: 50, cost_per_unit: 2 },
      ],
    ]);

    const result = completeProductionInOneTransaction({
      session: {
        id: "session-1",
        status: "in_progress",
        completed_at: null,
        completed_by: null,
      },
      ingredients,
      plan,
      completedBy: "user-1",
      failAt: "production_batch",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toContain("production batch");
    expect(result.ledger.session.status).toBe("in_progress");
    expect(result.ledger.transactions).toHaveLength(0);
    expect(result.ledger.stock_movements).toHaveLength(0);
    expect(result.ledger.batches).toHaveLength(0);
    expect(result.ledger.ingredients.get("flour")?.current_stock).toBe(100);
    expect(result.ledger.ingredients.get("milk")?.current_stock).toBe(50);
  });

  it("double completion returns a domain error and makes no changes", () => {
    const plan = buildHappyPlan(5);
    const ingredients = new Map<string, IngredientState>([
      [
        "flour",
        { id: "flour", name: "Flour", current_stock: 100, cost_per_unit: 1.5 },
      ],
      [
        "milk",
        { id: "milk", name: "Milk", current_stock: 50, cost_per_unit: 2 },
      ],
    ]);

    const first = completeProductionInOneTransaction({
      session: {
        id: "session-1",
        status: "in_progress",
        completed_at: null,
        completed_by: null,
      },
      ingredients,
      plan,
      completedBy: "user-1",
    });

    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }

    const second = completeProductionInOneTransaction({
      session: first.ledger.session,
      ingredients: first.ledger.ingredients,
      plan,
      completedBy: "user-2",
    });

    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }

    expect(second.error).toBe("This production session is already completed.");
    expect(second.ledger.session.status).toBe("completed");
    expect(second.ledger.session.completed_by).toBe("user-1");
    expect(second.ledger.batches).toHaveLength(0);
    expect(second.ledger.transactions).toHaveLength(0);
    // Inventory remains at post-first-completion levels (no second consume).
    expect(second.ledger.ingredients.get("flour")?.current_stock).toBe(99);
  });

  it("uses actual produced quantity only for costing (never planned)", () => {
    // Planned would be 10; actual is 5 → half BOM and unit cost from actual.
    const plan = buildHappyPlan(5);
    expect(plan.batches[0]?.produced_quantity).toBe(5);
    expect(plan.total_cost).toBe(2.5);
    expect(plan.batches[0]?.unit_cost).toBe(0.5);
  });
});
