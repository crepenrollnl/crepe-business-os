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
  ProductionPlanSessionHistoryItem,
  ProductionPlanSessionLineFact,
  ProductionSession,
  ProductionSessionLine,
  ProductionSessionStatus,
  ProductionSessionWithRelations,
  SaveProductionSessionInput,
} from "../types/production-session";
import { OPEN_PRODUCTION_SESSION_STATUSES } from "../types/production-session";
import type { CompleteProductionSessionResult } from "../types/production-batch";
import type {
  ProductionAccountingContext,
  ProductionJournalPosting,
} from "../types/production-accounting";
import { productionAccountingService } from "./production-accounting-service";
import { productionBatchService } from "./production-batch-service";
import {
  explodeComponentRecipeBom,
} from "@/features/production-planning";
import { loadRecipeBomGraph } from "@/features/production/services/load-recipe-bom-graph";
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
  validateRawMaterialScale,
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
  raw_material_scale: number | string | null;
  yield_unit: string;
  sort_order: number;
}

interface PlanHeaderRow {
  id: string;
  plan_number: number;
  name: string;
}

interface PlanSessionHistoryRow {
  id: string;
  session_number: number;
  status: ProductionSessionStatus;
  started_at: string;
  completed_at: string | null;
}

interface PlanSessionLineHistoryRow {
  id: string;
  production_session_id: string;
  recipe_id: string;
  product_name: string;
  actual_produced_quantity: number | string | null;
  yield_unit: string;
  sort_order: number;
}

interface PlanSessionBatchRow {
  production_session_line_id: string;
  produced_quantity: number | string;
}

interface IngredientCostRow {
  id: string;
  name: string;
  unit: string;
  current_stock: number | string;
  cost_per_unit: number | string | null;
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
    raw_material_scale: toNullableNumber(row.raw_material_scale),
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
      "id, production_session_id, production_plan_product_id, recipe_id, product_name, planned_quantity, actual_produced_quantity, raw_material_scale, yield_unit, sort_order",
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

  const [batchesResult, postingStatusResult] = await Promise.all([
    productionBatchService.listBySessionId(session.id),
    productionAccountingService.getProductionCompletedPostingStatus(session.id),
  ]);

  if (batchesResult.error) {
    // Batches table may not exist yet before SQL 007 is applied.
    const message = batchesResult.error.toLowerCase();
    if (
      message.includes("production_batches") ||
      message.includes("does not exist") ||
      message.includes("schema cache")
    ) {
      return ok({
        ...base,
        batches: [],
        accounting_posting_status: postingStatusResult.data ?? "pending",
      });
    }
    return fail(batchesResult.error);
  }

  return ok({
    ...base,
    batches: batchesResult.data ?? [],
    // Read-only display; soft-fail to Pending when journal lookup is unavailable.
    accounting_posting_status: postingStatusResult.data ?? "pending",
  });
}

function validateSaveInput(input: SaveProductionSessionInput): string | null {
  for (const line of input.lines) {
    const error = validateProducedQuantity(line.actual_produced_quantity);
    if (error) {
      return error;
    }

    const scaleError = validateRawMaterialScale(line.raw_material_scale);
    if (scaleError) {
      return scaleError;
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

  const graphResult = await loadRecipeBomGraph(uniqueIds);
  if (graphResult.error || !graphResult.data) {
    return fail(graphResult.error ?? "Failed to load recipes");
  }

  const graph = graphResult.data;
  const explodedByRecipe = new Map<
    string,
    ReturnType<typeof explodeComponentRecipeBom>
  >();
  const ingredientIds = new Set<string>();

  for (const recipeId of uniqueIds) {
    const exploded = explodeComponentRecipeBom(
      recipeId,
      graph.recipes,
      graph.recipeIngredients,
      graph.recipeComponents,
    );
    explodedByRecipe.set(recipeId, exploded);
    if (exploded.ok) {
      for (const item of exploded.ingredients) {
        ingredientIds.add(item.ingredientId);
      }
    }
  }

  let ingredientRows: IngredientCostRow[] = [];

  if (ingredientIds.size > 0) {
    const ingredientsResult = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, cost_per_unit")
      .in("id", [...ingredientIds]);

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
        cost_per_unit: toNullableNumber(row.cost_per_unit),
      },
    ]),
  );

  const boms = new Map<string, CompleteProductionRecipeBom>();

  for (const recipeId of uniqueIds) {
    const recipeRow = graph.recipeRowsById.get(recipeId);
    if (!recipeRow) {
      continue;
    }

    const exploded = explodedByRecipe.get(recipeId);
    if (!exploded || !exploded.ok) {
      return fail(
        exploded && !exploded.ok
          ? exploded.issues[0]?.message ?? "Failed to resolve recipe ingredients"
          : "Failed to resolve recipe ingredients",
      );
    }

    boms.set(recipeId, {
      recipe_id: recipeRow.id,
      recipe_name: recipeRow.name,
      yield_quantity: toNumber(recipeRow.yield_quantity),
      is_active: recipeRow.is_active,
      ingredients: exploded.ingredients.map((item) => {
        const ingredient = ingredientMap.get(item.ingredientId);
        if (!ingredient) {
          return {
            ingredient_id: item.ingredientId,
            quantity_per_yield: item.quantityPerYield,
            unit: item.unit,
            cost_per_unit: null,
            name: "Missing ingredient",
            current_stock: 0,
            is_missing: true,
          };
        }

        return {
          ingredient_id: item.ingredientId,
          quantity_per_yield: item.quantityPerYield,
          unit: ingredient.unit || item.unit,
          cost_per_unit: ingredient.cost_per_unit,
          name: ingredient.name,
          current_stock: ingredient.current_stock,
          is_missing: false,
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

  /**
   * Recipe BOMs + current ingredient stock/cost for completion preview.
   * Same loader completeSession uses before the RPC.
   */
  loadRecipeBomsForCompletion,

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

  /**
   * All sessions for a plan, with per-recipe produced quantity.
   * Prefers production_batches.produced_quantity; falls back to
   * production_session_lines.actual_produced_quantity. Read-only.
   */
  async listSessionsForPlan(
    productionPlanId: string,
  ): Promise<ServiceResult<ProductionPlanSessionHistoryItem[]>> {
    try {
      const { data: sessionRows, error: sessionError } = await supabase
        .from("production_sessions")
        .select("id, session_number, status, started_at, completed_at")
        .eq("production_plan_id", productionPlanId)
        .order("session_number", { ascending: true });

      if (sessionError) {
        return fail(
          toUserError(sessionError, "Failed to load production sessions"),
        );
      }

      const sessions = (sessionRows as PlanSessionHistoryRow[] | null) ?? [];
      if (sessions.length === 0) {
        return ok([]);
      }

      const sessionIds = sessions.map((session) => session.id);

      const { data: lineRows, error: lineError } = await supabase
        .from("production_session_lines")
        .select(
          "id, production_session_id, recipe_id, product_name, actual_produced_quantity, yield_unit, sort_order",
        )
        .in("production_session_id", sessionIds)
        .order("sort_order", { ascending: true });

      if (lineError) {
        return fail(
          toUserError(lineError, "Failed to load production session lines"),
        );
      }

      const lines = (lineRows as PlanSessionLineHistoryRow[] | null) ?? [];
      const lineIds = lines.map((line) => line.id);
      const batchByLineId = new Map<string, number>();

      if (lineIds.length > 0) {
        const { data: batchRows, error: batchError } = await supabase
          .from("production_batches")
          .select("production_session_line_id, produced_quantity")
          .in("production_session_line_id", lineIds);

        if (batchError) {
          return fail(
            toUserError(batchError, "Failed to load production batches"),
          );
        }

        for (const row of (batchRows as PlanSessionBatchRow[] | null) ?? []) {
          batchByLineId.set(
            row.production_session_line_id,
            toNumber(row.produced_quantity),
          );
        }
      }

      const linesBySessionId = new Map<string, ProductionPlanSessionLineFact[]>();

      for (const line of lines) {
        const batchQuantity = batchByLineId.get(line.id);
        const producedQuantity =
          batchQuantity !== undefined
            ? batchQuantity
            : toNullableNumber(line.actual_produced_quantity);
        const facts = linesBySessionId.get(line.production_session_id) ?? [];

        facts.push({
          recipe_id: line.recipe_id,
          product_name: line.product_name,
          yield_unit: line.yield_unit,
          produced_quantity: producedQuantity,
          sort_order: line.sort_order,
        });
        linesBySessionId.set(line.production_session_id, facts);
      }

      return ok(
        sessions.map((session) => ({
          id: session.id,
          session_number: session.session_number,
          status: session.status,
          started_at: session.started_at,
          completed_at: session.completed_at ?? null,
          lines: (linesBySessionId.get(session.id) ?? []).sort(
            (a, b) => a.sort_order - b.sort_order,
          ),
        })),
      );
    } catch (error) {
      return fail(toUserError(error, "Failed to load production sessions"));
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
          raw_material_scale: line.raw_material_scale,
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
          raw_material_scale: line.raw_material_scale,
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
          raw_material_scale: line.raw_material_scale,
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

  /**
   * Complete production then post the Accounting journal (DEV-105).
   *
   * Uses frozen RPC / plan total_cost — never recalculates.
   * Existing completeSession (hooks/UI) remains unchanged.
   *
   * completeSession has already succeeded and is durable by the time
   * posting is attempted — a posting failure must never look like the
   * whole operation failed (that would silently discard a real completed
   * session from the caller's point of view). So this only ever returns
   * fail(...) when completeSession itself fails; once that succeeds, the
   * result is always ok(...), with posting/postingError reporting whether
   * the accounting entry was actually created.
   */
  async completeSessionAndPostJournal(
    sessionId: string,
    input: CompleteProductionSessionInput,
    accounting: ProductionAccountingContext,
  ): Promise<
    ServiceResult<{
      session: ProductionSessionWithRelations;
      posting: ProductionJournalPosting | null;
      postingError: string | null;
    }>
  > {
    const completed = await this.completeSession(sessionId, input);
    if (completed.error || !completed.data) {
      return fail(completed.error ?? "Failed to finish production session");
    }

    const producedQuantity = completed.data.batches?.reduce(
      (sum, batch) => sum + batch.produced_quantity,
      0,
    );
    const batchIds =
      completed.data.batches?.map((batch) => batch.id) ?? [];
    const totalCost =
      completed.data.batches?.reduce(
        (sum, batch) => sum + batch.total_cost,
        0,
      ) ?? 0;

    const posting = await productionAccountingService.postJournalForProductionCompleted(
      {
        session_id: sessionId,
        transaction_id: null,
        completed_at:
          completed.data.completed_at ?? new Date().toISOString(),
        total_cost: totalCost,
        total_produced_quantity: producedQuantity ?? 0,
        batch_count: batchIds.length,
        batch_ids: batchIds,
        session_status: "completed",
      },
      accounting,
    );

    if (posting.error || !posting.data) {
      return ok({
        session: completed.data,
        posting: null,
        postingError:
          posting.error ??
          "Production completed but accounting posting failed.",
      });
    }

    return ok({
      session: completed.data,
      posting: posting.data,
      postingError: null,
    });
  },
};
