"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { productionSessionService } from "../services/production-session-service";
import type {
  FirstLevelRawIngredient,
  ProductionSessionWithRelations,
} from "../types/production-session";
import {
  formatZeroCostConsumptionWarning,
  listZeroUnitCostConsumptions,
  type CompleteProductionLineInput,
  type CompleteProductionRecipeBom,
} from "../utils/complete-production";
import {
  canFinishProductionSession,
  parseProducedQuantityInput,
  parseRawMaterialScaleInput,
} from "../utils/production-session";
import { isOpenProductionSessionStatus } from "../utils/format-production-session";
import { computeRawMaterialScaleFromActual } from "../utils/raw-material-scale-from-actual";

interface LineDraft {
  raw: string;
  value: number | null;
  error: string | null;
}

function buildDrafts(
  session: ProductionSessionWithRelations,
): Record<string, LineDraft> {
  const drafts: Record<string, LineDraft> = {};

  for (const line of session.lines) {
    drafts[line.id] = {
      raw:
        line.actual_produced_quantity === null
          ? ""
          : String(line.actual_produced_quantity),
      value: line.actual_produced_quantity,
      error: null,
    };
  }

  return drafts;
}

interface HelperDraft {
  raw: string;
  selectedIngredientId: string | null;
  error: string | null;
}

type ScaleLastEditedField = "helper" | "scale";

function emptyFirstLevelMap(): Map<string, FirstLevelRawIngredient[]> {
  return new Map();
}

function buildRawMaterialScaleDrafts(
  session: ProductionSessionWithRelations,
): Record<string, LineDraft> {
  const drafts: Record<string, LineDraft> = {};

  for (const line of session.lines) {
    drafts[line.id] = {
      raw:
        line.raw_material_scale === null
          ? ""
          : String(line.raw_material_scale),
      value: line.raw_material_scale,
      error: null,
    };
  }

  return drafts;
}

function buildScaleLastEditedByLineId(
  scaleDrafts: Record<string, LineDraft>,
): Record<string, ScaleLastEditedField> {
  const lastEdited: Record<string, ScaleLastEditedField> = {};

  for (const [lineId, draft] of Object.entries(scaleDrafts)) {
    if (draft.raw.trim().length === 0) {
      continue;
    }

    lastEdited[lineId] = "scale";
  }

  return lastEdited;
}

export function useProductionSession(sessionId: string) {
  const [session, setSession] = useState<ProductionSessionWithRelations | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [rawMaterialScaleDrafts, setRawMaterialScaleDrafts] = useState<
    Record<string, LineDraft>
  >({});
  const [helperDrafts, setHelperDrafts] = useState<Record<string, HelperDraft>>(
    {},
  );
  const [scaleLastEditedByLineId, setScaleLastEditedByLineId] = useState<
    Record<string, ScaleLastEditedField>
  >({});
  const [firstLevelRawByRecipeId, setFirstLevelRawByRecipeId] = useState<
    Map<string, FirstLevelRawIngredient[]>
  >(() => emptyFirstLevelMap());
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postingError, setPostingError] = useState<string | null>(null);
  const [completionBoms, setCompletionBoms] = useState<Map<
    string,
    CompleteProductionRecipeBom
  > | null>(null);
  const latestCompletionBomKeyRef = useRef<string | null>(null);

  const applySession = useCallback((next: ProductionSessionWithRelations) => {
    setSession(next);
    setNotes(next.notes ?? "");
    setDrafts(buildDrafts(next));
    const scaleDrafts = buildRawMaterialScaleDrafts(next);
    setRawMaterialScaleDrafts(scaleDrafts);
    setScaleLastEditedByLineId(buildScaleLastEditedByLineId(scaleDrafts));
  }, []);

  const loadSession = useCallback(async () => {
    const result = await productionSessionService.getSessionById(sessionId);

    if (result.error || !result.data) {
      setSession(null);
      setError(result.error ?? "Failed to load production session");
      setLoading(false);
      return;
    }

    applySession(result.data);
    setError(null);
    setLoading(false);
  }, [applySession, sessionId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const result = await productionSessionService.getSessionById(sessionId);

      if (cancelled) {
        return;
      }

      if (result.error || !result.data) {
        setSession(null);
        setError(result.error ?? "Failed to load production session");
        setLoading(false);
        return;
      }

      applySession(result.data);
      setError(null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession, sessionId]);

  const canEdit = Boolean(
    session && isOpenProductionSessionStatus(session.status),
  );

  const completionBomKey =
    session && canEdit
      ? `${session.id}:${session.lines.map((line) => line.recipe_id).join(",")}`
      : null;

  const loadCompletionBoms = useCallback(async () => {
    const startedWithKey = completionBomKey;
    latestCompletionBomKeyRef.current = completionBomKey;

    if (!session || !completionBomKey) {
      setCompletionBoms(null);
      setFirstLevelRawByRecipeId(emptyFirstLevelMap());
      return;
    }

    const recipeIds = session.lines.map((line) => line.recipe_id);
    const result =
      await productionSessionService.loadRecipeCompletionLookups(recipeIds);

    if (startedWithKey !== latestCompletionBomKeyRef.current) {
      return;
    }

    if (result.error || !result.data) {
      setCompletionBoms(null);
      setFirstLevelRawByRecipeId(emptyFirstLevelMap());
      return;
    }

    setCompletionBoms(result.data.boms);
    setFirstLevelRawByRecipeId(result.data.firstLevelRawByRecipeId);
    setHelperDrafts((current) => {
      const next = { ...current };

      for (const line of session.lines) {
        if (next[line.id]) {
          continue;
        }

        const rawLines =
          result.data.firstLevelRawByRecipeId.get(line.recipe_id) ?? [];
        next[line.id] = {
          raw: "",
          selectedIngredientId:
            rawLines.length === 1 ? rawLines[0].ingredient_id : null,
          error: null,
        };
      }

      return next;
    });
  }, [completionBomKey, session]);

  useAsyncEffect(loadCompletionBoms, [loadCompletionBoms]);

  const lineInputs = useMemo(() => {
    if (!session) {
      return [];
    }

    return session.lines.map((line) => ({
      line_id: line.id,
      actual_produced_quantity: drafts[line.id]?.value ?? null,
      raw_material_scale: rawMaterialScaleDrafts[line.id]?.value ?? null,
    }));
  }, [drafts, rawMaterialScaleDrafts, session]);

  const hasFieldErrors = useMemo(
    () =>
      session
        ? session.lines.some(
            (line) =>
              drafts[line.id]?.error != null ||
              rawMaterialScaleDrafts[line.id]?.error != null,
          )
        : false,
    [drafts, rawMaterialScaleDrafts, session],
  );

  const canFinish =
    canEdit &&
    !hasFieldErrors &&
    canFinishProductionSession(lineInputs);

  const zeroCostWarning = useMemo(() => {
    if (!session || !canEdit || !completionBoms) {
      return null;
    }

    const previewLines: CompleteProductionLineInput[] = [];

    for (const line of session.lines) {
      const produced = drafts[line.id]?.value;
      if (produced === null || produced === undefined || produced <= 0) {
        continue;
      }

      previewLines.push({
        line_id: line.id,
        recipe_id: line.recipe_id,
        product_name: line.product_name,
        actual_produced_quantity: produced,
        raw_material_scale: rawMaterialScaleDrafts[line.id]?.value ?? null,
      });
    }

    return formatZeroCostConsumptionWarning(
      listZeroUnitCostConsumptions(previewLines, completionBoms),
    );
  }, [canEdit, completionBoms, drafts, rawMaterialScaleDrafts, session]);

  const onProducedChange = useCallback((lineId: string, raw: string) => {
    const parsed = parseProducedQuantityInput(raw);

    setDrafts((current) => ({
      ...current,
      [lineId]: {
        raw,
        value: parsed.ok ? parsed.value : null,
        error: parsed.ok ? null : parsed.error,
      },
    }));
    setActionError(null);
  }, []);

  const applyScaleDraft = useCallback(
    (
      lineId: string,
      raw: string,
      lastEdited: ScaleLastEditedField | null,
    ) => {
      const parsed = parseRawMaterialScaleInput(raw);

      setRawMaterialScaleDrafts((current) => ({
        ...current,
        [lineId]: {
          raw,
          value: parsed.ok ? parsed.value : null,
          error: parsed.ok ? null : parsed.error,
        },
      }));
      setScaleLastEditedByLineId((current) => {
        if (lastEdited === null) {
          if (!(lineId in current)) {
            return current;
          }

          const next = { ...current };
          delete next[lineId];
          return next;
        }

        return {
          ...current,
          [lineId]: lastEdited,
        };
      });
      setActionError(null);
    },
    [],
  );

  const onRawMaterialScaleChange = useCallback((lineId: string, raw: string) => {
    applyScaleDraft(
      lineId,
      raw,
      raw.trim().length === 0 ? null : "scale",
    );
  }, [applyScaleDraft]);

  const applyHelperToScale = useCallback(
    (lineId: string, recipeId: string, helperRaw: string, ingredientId: string | null) => {
      const rawLines = firstLevelRawByRecipeId.get(recipeId) ?? [];
      const selected =
        rawLines.find((item) => item.ingredient_id === ingredientId) ??
        (rawLines.length === 1 ? rawLines[0] : undefined);

      if (!selected) {
        setHelperDrafts((current) => ({
          ...current,
          [lineId]: {
            raw: helperRaw,
            selectedIngredientId: ingredientId,
            error: null,
          },
        }));
        return;
      }

      const computed = computeRawMaterialScaleFromActual(
        helperRaw,
        selected.quantity,
      );

      if (computed.ok && computed.kind === "empty") {
        setHelperDrafts((current) => ({
          ...current,
          [lineId]: {
            raw: helperRaw,
            selectedIngredientId: ingredientId,
            error: null,
          },
        }));
        return;
      }

      if (!computed.ok) {
        setHelperDrafts((current) => ({
          ...current,
          [lineId]: {
            raw: helperRaw,
            selectedIngredientId: ingredientId,
            error: computed.error,
          },
        }));
        return;
      }

      setHelperDrafts((current) => ({
        ...current,
        [lineId]: {
          raw: helperRaw,
          selectedIngredientId: ingredientId,
          error: null,
        },
      }));

      if (scaleLastEditedByLineId[lineId] === "scale") {
        return;
      }

      applyScaleDraft(lineId, String(computed.scale), "helper");
    },
    [applyScaleDraft, firstLevelRawByRecipeId, scaleLastEditedByLineId],
  );

  const onHelperQuantityChange = useCallback(
    (lineId: string, recipeId: string, raw: string) => {
      const current = helperDrafts[lineId];
      const selectedId =
        current?.selectedIngredientId ??
        (firstLevelRawByRecipeId.get(recipeId)?.length === 1
          ? firstLevelRawByRecipeId.get(recipeId)?.[0]?.ingredient_id ?? null
          : null);

      applyHelperToScale(lineId, recipeId, raw, selectedId);
    },
    [applyHelperToScale, firstLevelRawByRecipeId, helperDrafts],
  );

  const onHelperIngredientChange = useCallback(
    (lineId: string, recipeId: string, ingredientId: string) => {
      const helperRaw = helperDrafts[lineId]?.raw ?? "";
      applyHelperToScale(
        lineId,
        recipeId,
        helperRaw,
        ingredientId.length > 0 ? ingredientId : null,
      );
    },
    [applyHelperToScale, helperDrafts],
  );

  const onNotesChange = useCallback((value: string) => {
    setNotes(value);
    setActionError(null);
  }, []);

  const buildPayload = useCallback(() => {
    if (hasFieldErrors) {
      return null;
    }

    return {
      notes: notes.trim() ? notes.trim() : null,
      lines: lineInputs,
    };
  }, [hasFieldErrors, lineInputs, notes]);

  const saveProgress = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) {
      setActionError("Fix invalid produced quantities before saving.");
      return;
    }

    setSaving(true);
    setActionError(null);

    const result = await productionSessionService.saveSessionProgress(
      sessionId,
      payload,
    );

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to save production session");
      setSaving(false);
      return;
    }

    applySession(result.data);
    setSaving(false);
  }, [applySession, buildPayload, sessionId]);

  const finishProduction = useCallback(async () => {
    if (!canFinish) {
      setActionError(
        "Enter an actual produced quantity for every product before finishing.",
      );
      return;
    }

    const payload = buildPayload();
    if (!payload) {
      setActionError("Fix invalid produced quantities before finishing.");
      return;
    }

    setFinishing(true);
    setActionError(null);
    setPostingError(null);

    const contextResult =
      await accountingContextService.getCurrentAccountingContext();

    if (contextResult.error || !contextResult.data) {
      // Accounting infra not ready (e.g. no open fiscal period) — the
      // production session must still complete; only the journal is
      // skipped, surfaced via postingError rather than blocking the
      // physical completion of production.
      const fallback = await productionSessionService.completeSession(
        sessionId,
        payload,
      );

      if (fallback.error || !fallback.data) {
        setActionError(fallback.error ?? "Failed to finish production session");
        setFinishing(false);
        return;
      }

      applySession(fallback.data);
      setPostingError(
        contextResult.error ?? "Accounting posting was skipped.",
      );
      setFinishing(false);
      return;
    }

    const result = await productionSessionService.completeSessionAndPostJournal(
      sessionId,
      payload,
      contextResult.data,
    );

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to finish production session");
      setFinishing(false);
      return;
    }

    // Reload: the session snapshot inside result.data is taken before
    // posting runs, so accounting_posting_status on it is always stale
    // ("pending") even when posting just succeeded.
    const reloadResult = await productionSessionService.getSessionById(
      sessionId,
    );

    applySession(
      !reloadResult.error && reloadResult.data
        ? reloadResult.data
        : result.data.session,
    );
    setPostingError(result.data.postingError);
    setFinishing(false);
  }, [applySession, buildPayload, canFinish, sessionId]);

  const retry = useCallback(() => {
    setLoading(true);
    setActionError(null);
    void loadSession();
  }, [loadSession]);

  return {
    session,
    loading,
    error,
    notes,
    drafts,
    rawMaterialScaleDrafts,
    helperDrafts,
    firstLevelRawByRecipeId,
    canEdit,
    canFinish,
    saving,
    finishing,
    actionError,
    postingError,
    zeroCostWarning,
    onNotesChange,
    onProducedChange,
    onRawMaterialScaleChange,
    onHelperQuantityChange,
    onHelperIngredientChange,
    saveProgress,
    finishProduction,
    retry,
  };
}
