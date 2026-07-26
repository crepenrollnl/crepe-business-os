"use client";

import { useCallback, useEffect, useState } from "react";
import { salesReadService } from "../services/sales-read-service";
import { salesService } from "../services/sales-service";
import type { SaleDetail } from "../types/sale";

export function useSale(saleId: string) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastConfirmCogs, setLastConfirmCogs] = useState<number | null>(null);

  const loadSale = useCallback(async () => {
    const result = await salesReadService.getSale(saleId);

    if (result.error || !result.data) {
      setSale(null);
      setError(result.error ?? "Failed to load sale");
      setLoading(false);
      return;
    }

    setSale(result.data);
    setError(null);
    setLoading(false);
  }, [saleId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setActionError(null);
      setLastConfirmCogs(null);

      const result = await salesReadService.getSale(saleId);

      if (cancelled) {
        return;
      }

      if (result.error || !result.data) {
        setSale(null);
        setError(result.error ?? "Failed to load sale");
        setLoading(false);
        return;
      }

      setSale(result.data);
      setError(null);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [saleId]);

  const retry = useCallback(() => {
    setLoading(true);
    setActionError(null);
    void loadSale();
  }, [loadSale]);

  const applySaleFromMutation = useCallback(
    async (rpcSale: SaleDetail) => {
      // SQL RPC payload is the immediate source of truth for totals/lines.
      setSale(rpcSale);
      setError(null);

      const reloadResult = await salesReadService.getSale(saleId);
      if (!reloadResult.error && reloadResult.data) {
        setSale(reloadResult.data);
      }

      return true;
    },
    [saleId],
  );

  const addSaleLine = useCallback(
    async (input: {
      product_id: string;
      quantity: number;
      unit_price: number;
    }) => {
      setMutating(true);
      setActionError(null);

      const result = await salesService.addSaleLine({
        sale_id: saleId,
        product_id: input.product_id,
        quantity: input.quantity,
        unit_price: input.unit_price,
      });

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to add sale line");
        setMutating(false);
        return false;
      }

      await applySaleFromMutation(result.data);
      setMutating(false);
      return true;
    },
    [applySaleFromMutation, saleId],
  );

  const updateSaleLine = useCallback(
    async (input: { sale_line_id: string; quantity: number }) => {
      setMutating(true);
      setActionError(null);

      const result = await salesService.updateSaleLine({
        sale_line_id: input.sale_line_id,
        quantity: input.quantity,
      });

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to update sale line");
        setMutating(false);
        return false;
      }

      await applySaleFromMutation(result.data);
      setMutating(false);
      return true;
    },
    [applySaleFromMutation],
  );

  const deleteSaleLine = useCallback(
    async (input: { sale_line_id: string }) => {
      setMutating(true);
      setActionError(null);

      const result = await salesService.deleteSaleLine({
        sale_line_id: input.sale_line_id,
      });

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to delete sale line");
        setMutating(false);
        return false;
      }

      await applySaleFromMutation(result.data);
      setMutating(false);
      return true;
    },
    [applySaleFromMutation],
  );

  const confirm = useCallback(async () => {
    setConfirming(true);
    setActionError(null);

    const confirmResult = await salesService.confirmSale(saleId);

    if (confirmResult.error || !confirmResult.data) {
      setActionError(confirmResult.error ?? "Failed to confirm sale");
      setConfirming(false);
      return false;
    }

    setLastConfirmCogs(confirmResult.data.total_cogs);

    const reloadResult = await salesReadService.getSale(saleId);

    if (reloadResult.error || !reloadResult.data) {
      setActionError(
        reloadResult.error ?? "Sale confirmed but failed to reload",
      );
      setConfirming(false);
      return false;
    }

    setSale(reloadResult.data);
    setError(null);
    setConfirming(false);
    return true;
  }, [saleId]);

  return {
    sale,
    loading,
    error,
    confirming,
    mutating,
    actionError,
    lastConfirmCogs,
    addSaleLine,
    updateSaleLine,
    deleteSaleLine,
    confirm,
    retry,
  };
}
