"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { productionSessionService } from "../services/production-session-service";
import type { ProductionSessionWithRelations } from "../types/production-session";
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
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postingError, setPostingError] = useState<string | null>(null);
  const [completionBoms, setCompletionBoms] = useState<Map<
    string,
    CompleteProductionRecipeBom
  > | null>(null);

  const applySession = useCallback((next: ProductionSessionWithRelations) => {
    setSession(next);
    setNotes(next.notes ?? "");
    setDrafts(buildDrafts(next));
    setRawMaterialScaleDrafts(buildRawMaterialScaleDrafts(next));
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
    if (!session || !completionBomKey) {
      setCompletionBoms(null);
      return;
    }

    const recipeIds = session.lines.map((line) => line.recipe_id);
    const result =
      await productionSessionService.loadRecipeBomsForCompletion(recipeIds);

    if (result.error || !result.data) {
      setCompletionBoms(null);
      return;
    }

    setCompletionBoms(result.data);
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

  const onRawMaterialScaleChange = useCallback((lineId: string, raw: string) => {
    const parsed = parseRawMaterialScaleInput(raw);

    setRawMaterialScaleDrafts((current) => ({
      ...current,
      [lineId]: {
        raw,
        value: parsed.ok ? parsed.value : null,
        error: parsed.ok ? null : parsed.error,
      },
    }));
    setActionError(null);
  }, []);

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
    saveProgress,
    finishProduction,
    retry,
  };
}
