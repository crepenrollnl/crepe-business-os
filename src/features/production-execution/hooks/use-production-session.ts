"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { productionSessionService } from "../services/production-session-service";
import type { ProductionSessionWithRelations } from "../types/production-session";
import {
  canFinishProductionSession,
  parseProducedQuantityInput,
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

export function useProductionSession(sessionId: string) {
  const [session, setSession] = useState<ProductionSessionWithRelations | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applySession = useCallback((next: ProductionSessionWithRelations) => {
    setSession(next);
    setNotes(next.notes ?? "");
    setDrafts(buildDrafts(next));
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

  const lineInputs = useMemo(() => {
    if (!session) {
      return [];
    }

    return session.lines.map((line) => ({
      line_id: line.id,
      actual_produced_quantity: drafts[line.id]?.value ?? null,
    }));
  }, [drafts, session]);

  const hasFieldErrors = useMemo(
    () =>
      session
        ? session.lines.some((line) => drafts[line.id]?.error != null)
        : false,
    [drafts, session],
  );

  const canFinish =
    canEdit &&
    !hasFieldErrors &&
    canFinishProductionSession(lineInputs);

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

    const result = await productionSessionService.completeSession(
      sessionId,
      payload,
    );

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to finish production session");
      setFinishing(false);
      return;
    }

    applySession(result.data);
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
    canEdit,
    canFinish,
    saving,
    finishing,
    actionError,
    onNotesChange,
    onProducedChange,
    saveProgress,
    finishProduction,
    retry,
  };
}
