/**
 * Production Session service (DEV-014 / DEV-015).
 *
 * Creates Production Sessions and atomically completes them:
 * consume raw materials → stock movements → production batches → completed.
 *
 * Does NOT mutate the Production Plan.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CompleteProductionSessionInput,
  ProductionSession,
  ProductionSessionLine,
  ProductionSessionStatus,
  ProductionSessionWithRelations,
  SaveProductionSessionInput,
} from "../types/production-session";
import { OPEN_PRODUCTION_SESSION_STATUSES } from "../types/production-session";
import type { CompleteProductionSessionResult } from "../types/production-batch";
import { productionBatchService } from "./production-batch-service";
import {
  assertCanCompleteProductionSession,
  buildCompleteProductionPlan,
  logProductionCompleted,
  mapCompleteProductionRpcError,
  validateInventoryForCompletion,
  type CompleteProductionRecipeBom,
} from "../utils/complete-production";
import {
  toSessionLineView,
  validateSessionLinesForComplete,
  validateProducedQuantity,
} from "../utils/production-session";

const SESSION_SELECT =
  "id, session_number, production_plan_id, status, started_at, completed_at, completed_by, operator_name, notes, created_at, updated_at";

interface ProductionSessionRow {
  id: string;
  session_number: number;
  production_plan_id: string;
  status: ProductionSessionStatus;
  started_at: string;
  completed_at: string | null;
  completed_by: string | null;
  operator_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
}

interface ProductionSessionLineRow {
  id: string;
  production_session_id: string;
  production_plan_product_id: string | null;
  recipe_id: string;
  product_name: string;
  planned_quantity: number | string;
  actual_produced_quantity: number | string | null;
  yield_unit: string;
  sort_order: number;
}

interface PlanHeaderRow {
  id: string;
  plan_number: number;
  name: string;
}

interface RecipeRow {
  id: string;
  name: string;
  yield_quantity: number | string;
  is_active: boolean;
}

interface RecipeItemRow {
  recipe_id: string;
  ingredient_id: string;
  quantity: number | string;
  unit: string;
}

interface IngredientCostRow {
  id: string;
  name: string;
  unit: string;
  current_stock: number | string;
  cost_per_unit: number | string;
}

function toNumber(value: number | string): number {
  return typeof value === "number" ? value : Number(value);
}

function toNullableNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toNumber(value);
}

function mapSession(row: ProductionSessionRow): ProductionSession {
  return {
    id: row.id,
    session_number: row.session_number,
    production_plan_id: row.production_plan_id,
    status: row.status,
    started_at: row.started_at,
    completed_at: row.completed_at,
    completed_by: row.completed_by ?? null,
    operator_name: row.operator_name,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapSessionLine(row: ProductionSessionLineRow): ProductionSessionLine {
  return {
    id: row.id,
    production_session_id: row.production_session_id,
    production_plan_product_id: row.production_plan_product_id,
    recipe_id: row.recipe_id,
    product_name: row.product_name,
    planned_quantity: toNumber(row.planned_quantity),
    actual_produced_quantity: toNullableNumber(row.actual_produced_quantity),
    yield_unit: row.yield_unit,
    sort_order: row.sort_order,
  };
}

async function fetchSessionLines(
  sessionId: string,
): Promise<ServiceResult<ProductionSessionLine[]>> {
  const { data, error } = await supabase
    .from("production_session_lines")
    .select(
      "id, production_session_id, production_plan_product_id, recipe_id, product_name, planned_quantity, actual_produced_quantity, yield_unit, sort_order",
    )
    .eq("production_session_id", sessionId)
    .order("sort_order", { ascending: true });

  if (error) {
    return fail(toUserError(error, "Failed to load production session lines"));
  }

  return ok(
    (data as ProductionSessionLineRow[] | null)?.map(mapSessionLine) ?? [],
  );
}

async function fetchPlanHeader(
  planId: string,
): Promise<ServiceResult<PlanHeaderRow>> {
  const { data, error } = await supabase
    .from("production_plans")
    .select("id, plan_number, name")
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    return fail(toUserError(error, "Failed to load production plan"));
  }

  if (!data) {
    return fail("Production plan was not found.");
  }

  return ok(data as PlanHeaderRow);
}

async function buildSessionWithRelations(
  session: ProductionSession,
): Promise<ServiceResult<ProductionSessionWithRelations>> {
  const [linesResult, planResult] = await Promise.all([
    fetchSessionLines(session.id),
    fetchPlanHeader(session.production_plan_id),
  ]);

  if (linesResult.error || !linesResult.data) {
    return fail(linesResult.error ?? "Failed to load production session lines");
  }

  if (planResult.error || !planResult.data) {
    return fail(planResult.error ?? "Failed to load production plan");
  }

  const base: ProductionSessionWithRelations = {
    ...session,
    lines: linesResult.data.map(toSessionLineView),
    plan: {
      id: planResult.data.id,
      plan_number: planResult.data.plan_number,
      name: planResult.data.name,
    },
  };

  if (session.status !== "completed") {
    return ok(base);
  }

  const batchesResult = await productionBatchService.listBySessionId(session.id);
  if (batchesResult.error) {
    // Batches table may not exist yet before SQL 007 is applied.
    const message = batchesResult.error.toLowerCase();
    if (
      message.includes("production_batches") ||
      message.includes("does not exist") ||
      message.includes("schema cache")
    ) {
      return ok({ ...base, batches: [] });
    }
    return fail(batchesResult.error);
  }

  return ok({
    ...base,
    batches: batchesResult.data ?? [],
  });
}

function validateSaveInput(input: SaveProductionSessionInput): string | null {
  for (const line of input.lines) {
    const error = validateProducedQuantity(line.actual_produced_quantity);
    if (error) {
      return error;
    }
  }

  return null;
}

async function loadRecipeBomsForCompletion(
  recipeIds: string[],
): Promise<ServiceResult<Map<string, CompleteProductionRecipeBom>>> {
  const uniqueIds = [...new Set(recipeIds)];

  if (uniqueIds.length === 0) {
    return ok(new Map());
  }

  const [recipesResult, itemsResult] = await Promise.all([
    supabase
      .from("recipes")
      .select("id, name, yield_quantity, is_active")
      .in("id", uniqueIds),
    supabase
      .from("recipe_items")
      .select("recipe_id, ingredient_id, quantity, unit")
      .in("recipe_id", uniqueIds),
  ]);

  if (recipesResult.error) {
    return fail(toUserError(recipesResult.error, "Failed to load recipes"));
  }

  if (itemsResult.error) {
    return fail(
      toUserError(itemsResult.error, "Failed to load recipe ingredients"),
    );
  }

  const recipeRows = (recipesResult.data ?? []) as RecipeRow[];
  const itemRows = (itemsResult.data ?? []) as RecipeItemRow[];
  const ingredientIds = [
    ...new Set(itemRows.map((item) => item.ingredient_id)),
  ];

  let ingredientRows: IngredientCostRow[] = [];

  if (ingredientIds.length > 0) {
    const ingredientsResult = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, cost_per_unit")
      .in("id", ingredientIds);

    if (ingredientsResult.error) {
      return fail(
        toUserError(ingredientsResult.error, "Failed to load ingredient stock"),
      );
    }

    ingredientRows = (ingredientsResult.data ?? []) as IngredientCostRow[];
  }

  const ingredientMap = new Map(
    ingredientRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        unit: row.unit,
        current_stock: toNumber(row.current_stock),
        cost_per_unit: toNumber(row.cost_per_unit),
      },
    ]),
  );

  const itemsByRecipe = new Map<string, RecipeItemRow[]>();
  for (const item of itemRows) {
    const existing = itemsByRecipe.get(item.recipe_id) ?? [];
    existing.push(item);
    itemsByRecipe.set(item.recipe_id, existing);
  }

  const boms = new Map<string, CompleteProductionRecipeBom>();

  for (const recipe of recipeRows) {
    const items = itemsByRecipe.get(recipe.id) ?? [];
    boms.set(recipe.id, {
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      yield_quantity: toNumber(recipe.yield_quantity),
      is_active: recipe.is_active,
      ingredients: items.map((item) => {
        const ingredient = ingredientMap.get(item.ingredient_id);
        return {
          ingredient_id: item.ingredient_id,
          quantity_per_yield: toNumber(item.quantity),
          unit: ingredient?.unit ?? item.unit,
          cost_per_unit: ingredient?.cost_per_unit ?? 0,
          name: ingredient?.name ?? "Unknown ingredient",
          current_stock: ingredient?.current_stock ?? 0,
        };
      }),
    });
  }

  return ok(boms);
}

function mapRpcResult(data: unknown): CompleteProductionSessionResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const sessionId = row.session_id;
  const transactionId = row.transaction_id;
  const batchCount = row.batch_count;
  const totalCost = row.total_cost;
  const completedAt = row.completed_at;
  const completedBy = row.completed_by;
  const batchIds = row.batch_ids;

  if (
    typeof sessionId !== "string" ||
    typeof transactionId !== "string" ||
    typeof completedAt !== "string"
  ) {
    return null;
  }

  return {
    session_id: sessionId,
    transaction_id: transactionId,
    batch_count:
      typeof batchCount === "number" ? batchCount : Number(batchCount),
    batch_ids: Array.isArray(batchIds)
      ? batchIds.filter((id): id is string => typeof id === "string")
      : [],
    total_cost: typeof totalCost === "number" ? totalCost : Number(totalCost),
    completed_at: completedAt,
    completed_by: typeof completedBy === "string" ? completedBy : null,
  };
}

function mapCompletionError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;
      return message ? mapCompleteProductionRpcError(message) : null;
    },
  });
}

function mapStartSessionRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("not ready for execution")) {
    return "This production plan is not ready for execution. Only plans with status Ready for Production can start a session.";
  }

  if (normalized.includes("has no products")) {
    return "This production plan has no products. Add products before starting production.";
  }

  if (normalized.includes("production plan was not found")) {
    return "Production plan was not found.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("start_production_session") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Starting production is not available yet. Apply the start-production-session database script and try again.";
  }

  return null;
}

function mapStartSessionError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;
      return message ? mapStartSessionRpcError(message) : null;
    },
  });
}

function mapSessionIdRpcResult(data: unknown): string | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const sessionId = (data as { session_id?: unknown }).session_id;
  return typeof sessionId === "string" ? sessionId : null;
}

function mapSaveSessionRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("was not found")) {
    return "Production session was not found.";
  }

  if (normalized.includes("can no longer be edited")) {
    return "This production session can no longer be edited.";
  }

  if (normalized.includes("session lines are invalid")) {
    return "One or more session lines are invalid.";
  }

  if (normalized.includes("cannot be negative")) {
    return "Produced quantity cannot be negative.";
  }

  if (normalized.includes("valid produced quantity")) {
    return "Enter a valid produced quantity.";
  }

  if (
    normalized.includes("could not find the function") ||
    (normalized.includes("save_production_session") &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Saving production progress is not available yet. Apply the save-production-session database script and try again.";
  }

  return null;
}

function mapSaveSessionError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;
      return message ? mapSaveSessionRpcError(message) : null;
    },
  });
}

export const productionSessionService = {
  /**
   * Starts a Production Session for an executable plan.
   * Reuses an existing open session if one already exists for the plan.
   * Does not mutate the plan, inventory, or batches.
   *
   * Persistence is atomic via start_production_session (DEV-018).
   */
  async startSession(
    productionPlanId: string,
  ): Promise<ServiceResult<ProductionSessionWithRelations>> {
    try {
      const { data, error } = await supabase.rpc("start_production_session", {
        p_production_plan_id: productionPlanId,
      });

      if (error) {
        return fail(
          mapStartSessionError(error, "Failed to start production session"),
        );
      }

      const sessionId = mapSessionIdRpcResult(data);
      if (!sessionId) {
        return fail("Production session started but the response was invalid.");
      }

      return this.getSessionById(sessionId);
    } catch (error) {
      return fail(
        mapStartSessionError(error, "Failed to start production session"),
      );
    }
  },

  async getSessionById(
    sessionId: string,
  ): Promise<ServiceResult<ProductionSessionWithRelations>> {
    try {
      const { data, error } = await supabase
        .from("production_sessions")
        .select(SESSION_SELECT)
        .eq("id", sessionId)
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Failed to load production session"));
      }

      if (!data) {
        return fail("Production session was not found.");
      }

      return buildSessionWithRelations(mapSession(data as ProductionSessionRow));
    } catch (error) {
      return fail(toUserError(error, "Failed to load production session"));
    }
  },

  async getOpenSessionForPlan(
    productionPlanId: string,
  ): Promise<
    ServiceResult<Pick<
      ProductionSession,
      "id" | "session_number" | "status" | "started_at"
    > | null>
  > {
    try {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_number, status, started_at")
        .eq("production_plan_id", productionPlanId)
        .in("status", [...OPEN_PRODUCTION_SESSION_STATUSES])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Failed to load production session"));
      }

      if (!data) {
        return ok(null);
      }

      return ok({
        id: data.id as string,
        session_number: data.session_number as number,
        status: data.status as ProductionSessionStatus,
        started_at: data.started_at as string,
      });
    } catch (error) {
      return fail(toUserError(error, "Failed to load production session"));
    }
  },

  async getLatestCompletedSessionForPlan(
    productionPlanId: string,
  ): Promise<
    ServiceResult<Pick<
      ProductionSession,
      "id" | "session_number" | "status" | "started_at" | "completed_at"
    > | null>
  > {
    try {
      const { data, error } = await supabase
        .from("production_sessions")
        .select("id, session_number, status, started_at, completed_at")
        .eq("production_plan_id", productionPlanId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        return fail(toUserError(error, "Failed to load production session"));
      }

      if (!data) {
        return ok(null);
      }

      return ok({
        id: data.id as string,
        session_number: data.session_number as number,
        status: data.status as ProductionSessionStatus,
        started_at: data.started_at as string,
        completed_at: (data.completed_at as string | null) ?? null,
      });
    } catch (error) {
      return fail(toUserError(error, "Failed to load production session"));
    }
  },

  /**
   * Persists in-progress session notes and produced quantities.
   * Does not complete the session and does not mutate inventory.
   *
   * Persistence is atomic via save_production_session (DEV-019).
   */
  async saveSessionProgress(
    sessionId: string,
    input: SaveProductionSessionInput,
  ): Promise<ServiceResult<ProductionSessionWithRelations>> {
    try {
      const validationError = validateSaveInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("save_production_session", {
        p_session_id: sessionId,
        p_notes: input.notes?.trim() ? input.notes.trim() : null,
        p_lines: input.lines.map((line) => ({
          line_id: line.line_id,
          actual_produced_quantity: line.actual_produced_quantity,
        })),
      });

      if (error) {
        return fail(
          mapSaveSessionError(error, "Failed to save production session"),
        );
      }

      const savedSessionId = mapSessionIdRpcResult(data);
      if (!savedSessionId) {
        return fail("Production session saved but the response was invalid.");
      }

      return this.getSessionById(savedSessionId);
    } catch (error) {
      return fail(
        mapSaveSessionError(error, "Failed to save production session"),
      );
    }
  },

  /**
   * Atomically completes a Production Session (PRD-001 / DEV-015).
   *
   * Before the DB transaction:
   *   load session → validate IN_PROGRESS → load recipes →
   *   calculate actual consumption → validate inventory.
   *
   * Inside one DB transaction (complete_production_session RPC):
   *   inventory transactions → production batches → Finished Goods
   *   registration → session COMPLETED (completed_at / completed_by).
   *
   * Uses Actual Produced Quantity only. Never Planned Quantity.
   */
  async completeSession(
    sessionId: string,
    input: CompleteProductionSessionInput,
  ): Promise<ServiceResult<ProductionSessionWithRelations>> {
    try {
      const existing = await this.getSessionById(sessionId);
      if (existing.error || !existing.data) {
        return fail(existing.error ?? "Production session was not found.");
      }

      const statusError = assertCanCompleteProductionSession(
        existing.data.status,
      );
      if (statusError) {
        return fail(statusError);
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return fail("You must be signed in to finish production.");
      }

      const validationError = validateSessionLinesForComplete(input.lines);
      if (validationError) {
        return fail(validationError);
      }

      const existingLineIds = new Set(existing.data.lines.map((line) => line.id));
      if (input.lines.length !== existing.data.lines.length) {
        return fail(
          "Enter an actual produced quantity for every product before finishing.",
        );
      }

      for (const line of input.lines) {
        if (!existingLineIds.has(line.line_id)) {
          return fail("One or more session lines are invalid.");
        }
      }

      const lineById = new Map(
        existing.data.lines.map((line) => [line.id, line]),
      );

      const completionLines = input.lines.map((line) => {
        const sessionLine = lineById.get(line.line_id)!;
        return {
          line_id: line.line_id,
          recipe_id: sessionLine.recipe_id,
          product_name: sessionLine.product_name,
          actual_produced_quantity: line.actual_produced_quantity as number,
        };
      });

      const bomsResult = await loadRecipeBomsForCompletion(
        completionLines.map((line) => line.recipe_id),
      );
      if (bomsResult.error || !bomsResult.data) {
        return fail(bomsResult.error ?? "Failed to load recipes");
      }

      const planResult = buildCompleteProductionPlan(
        completionLines,
        bomsResult.data,
      );
      if (!planResult.ok) {
        return fail(planResult.error);
      }

      const inventoryError = validateInventoryForCompletion(
        planResult.plan.consumptions,
      );
      if (inventoryError) {
        return fail(inventoryError);
      }

      const { data, error } = await supabase.rpc("complete_production_session", {
        p_session_id: sessionId,
        p_notes: input.notes?.trim() ? input.notes.trim() : null,
        p_lines: input.lines.map((line) => ({
          line_id: line.line_id,
          actual_produced_quantity: line.actual_produced_quantity,
        })),
        p_completed_by: user.id,
      });

      if (error) {
        return fail(mapCompletionError(error, "Failed to finish production session"));
      }

      const rpcResult = mapRpcResult(data);
      if (!rpcResult) {
        return fail("Production completed but the response was invalid.");
      }

      logProductionCompleted({
        session_id: rpcResult.session_id,
        batch_ids: rpcResult.batch_ids,
        product_ids: planResult.plan.batches.map(
          (batch) => batch.finished_good_id,
        ),
        produced_quantity: planResult.plan.batches.reduce(
          (sum, batch) => sum + batch.produced_quantity,
          0,
        ),
        total_cost: rpcResult.total_cost,
      });

      return this.getSessionById(sessionId);
    } catch (error) {
      return fail(
        mapCompletionError(error, "Failed to finish production session"),
      );
    }
  },
};
