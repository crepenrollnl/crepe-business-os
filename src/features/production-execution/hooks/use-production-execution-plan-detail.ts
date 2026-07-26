"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { productionExecutionService } from "../services/production-execution-service";
import { productionSessionService } from "../services/production-session-service";
import type { ProductionExecutionPlanDetail } from "../types/production-execution";

export function useProductionExecutionPlanDetail(planId: string) {
  const router = useRouter();
  const [plan, setPlan] = useState<ProductionExecutionPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadPlan = useCallback(async () => {
    const result =
      await productionExecutionService.getExecutablePlanById(planId);

    if (result.error || !result.data) {
      setPlan(null);
      setError(result.error ?? "Failed to load production plan");
      setLoading(false);
      return;
    }

    setPlan(result.data);
    setError(null);
    setLoading(false);
  }, [planId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      const result =
        await productionExecutionService.getExecutablePlanById(planId);

      if (cancelled) {
        return;
      }

      if (result.error || !result.data) {
        setPlan(null);
        setError(result.error ?? "Failed to load production plan");
        setLoading(false);
        return;
      }

      setPlan(result.data);
      setError(null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [planId]);

  const retry = useCallback(() => {
    setLoading(true);
    setStartError(null);
    void loadPlan();
  }, [loadPlan]);

  const startProduction = useCallback(async () => {
    setStarting(true);
    setStartError(null);

    const result = await productionSessionService.startSession(planId);

    if (result.error || !result.data) {
      setStartError(result.error ?? "Failed to start production session");
      setStarting(false);
      return;
    }

    router.push(`/production-execution/sessions/${result.data.id}`);
  }, [planId, router]);

  return {
    plan,
    loading,
    error,
    starting,
    startError,
    retry,
    startProduction,
  };
}
