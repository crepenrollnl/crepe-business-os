"use client";

import { useCallback, useEffect, useState } from "react";
import { saleAccountingService } from "../services/sale-accounting-service";
import { saleCogsService } from "../services/sale-cogs-service";
import { saleProfitService } from "../services/sale-profit-service";
import { salesReadService } from "../services/sales-read-service";
import { salesService } from "../services/sales-service";
import type { SaleAccountingPostingStatus } from "../types/sale-accounting";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleDetail } from "../types/sale";

function isCompletedSale(sale: SaleDetail | null): boolean {
  return sale?.status === "confirmed" || sale?.status === "paid";
}

export function useSale(saleId: string) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastConfirmCogs, setLastConfirmCogs] = useState<number | null>(null);
  const [cogsSummary, setCogsSummary] = useState<SaleCostSummary | null>(null);
  const [cogsLoading, setCogsLoading] = useState(false);
  const [cogsError, setCogsError] = useState<string | null>(null);
  const [profitSummary, setProfitSummary] = useState<SaleProfitSummary | null>(
    null,
  );
  const [profitLoading, setProfitLoading] = useState(false);
  const [profitError, setProfitError] = useState<string | null>(null);
  const [accountingPostingStatus, setAccountingPostingStatus] =
    useState<SaleAccountingPostingStatus>("pending");
  const [reviewLoading, setReviewLoading] = useState(false);

  const loadCogs = useCallback(async (detail: SaleDetail) => {
    if (!isCompletedSale(detail)) {
      setCogsSummary(null);
      setCogsError(null);
      setCogsLoading(false);
      return;
    }

    setCogsLoading(true);
    setCogsError(null);

    const result = await saleCogsService.getSaleCostSummary(detail.sale_id);

    if (result.error || !result.data) {
      setCogsSummary(null);
      setCogsError(result.error ?? "Failed to load sale COGS");
      setCogsLoading(false);
      return;
    }

    setCogsSummary(result.data);
    setCogsError(null);
    setCogsLoading(false);
  }, []);

  const loadProfit = useCallback(
    async (detail: SaleDetail, options?: { registerGeneration?: boolean }) => {
      if (!isCompletedSale(detail)) {
        setProfitSummary(null);
        setProfitError(null);
        setProfitLoading(false);
        return;
      }

      setProfitLoading(true);
      setProfitError(null);

      const result = options?.registerGeneration
        ? await saleProfitService.buildFrozenSaleProfit(detail.sale_id)
        : await saleProfitService.getSaleProfitSummary(detail.sale_id);

      if (result.error || !result.data) {
        if (
          options?.registerGeneration &&
          result.error?.toLowerCase().includes("already been generated")
        ) {
          const reload = await saleProfitService.getSaleProfitSummary(
            detail.sale_id,
          );
          if (!reload.error && reload.data) {
            setProfitSummary(reload.data);
            setProfitError(null);
            setProfitLoading(false);
            return;
          }
        }

        setProfitSummary(null);
        setProfitError(result.error ?? "Failed to load sale profit");
        setProfitLoading(false);
        return;
      }

      setProfitSummary(result.data);
      setProfitError(null);
      setProfitLoading(false);
    },
    [],
  );

  const loadAccountingStatus = useCallback(async (detail: SaleDetail) => {
    if (!isCompletedSale(detail)) {
      setAccountingPostingStatus("pending");
      return;
    }

    const result = await saleAccountingService.getSaleCompletedPostingStatus(
      detail.sale_id,
    );
    setAccountingPostingStatus(result.data ?? "pending");
  }, []);

  const loadCompletedReview = useCallback(
    async (
      detail: SaleDetail,
      options?: { registerProfitGeneration?: boolean },
    ) => {
      if (!isCompletedSale(detail)) {
        setCogsSummary(null);
        setCogsError(null);
        setProfitSummary(null);
        setProfitError(null);
        setAccountingPostingStatus("pending");
        setReviewLoading(false);
        return;
      }

      setReviewLoading(true);
      await Promise.all([
        loadCogs(detail),
        loadProfit(detail, {
          registerGeneration: options?.registerProfitGeneration,
        }),
        loadAccountingStatus(detail),
      ]);
      setReviewLoading(false);
    },
    [loadAccountingStatus, loadCogs, loadProfit],
  );

  const loadSale = useCallback(async () => {
    const result = await salesReadService.getSale(saleId);

    if (result.error || !result.data) {
      setSale(null);
      setError(result.error ?? "Failed to load sale");
      setCogsSummary(null);
      setCogsError(null);
      setProfitSummary(null);
      setProfitError(null);
      setAccountingPostingStatus("pending");
      setLoading(false);
      return;
    }

    setSale(result.data);
    setError(null);
    setLoading(false);
    await loadCompletedReview(result.data);
  }, [loadCompletedReview, saleId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setActionError(null);
      setLastConfirmCogs(null);
      setCogsSummary(null);
      setCogsError(null);
      setProfitSummary(null);
      setProfitError(null);
      setAccountingPostingStatus("pending");

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
      await loadCompletedReview(result.data);
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCompletedReview, saleId]);

  const retry = useCallback(() => {
    setLoading(true);
    setActionError(null);
    void loadSale();
  }, [loadSale]);

  const applySaleFromMutation = useCallback(
    async (rpcSale: SaleDetail) => {
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
    await loadCompletedReview(reloadResult.data, {
      registerProfitGeneration: true,
    });
    setConfirming(false);
    return true;
  }, [loadCompletedReview, saleId]);

  return {
    sale,
    loading,
    error,
    confirming,
    mutating,
    actionError,
    lastConfirmCogs,
    cogsSummary,
    cogsLoading,
    cogsError,
    profitSummary,
    profitLoading,
    profitError,
    accountingPostingStatus,
    reviewLoading,
    addSaleLine,
    updateSaleLine,
    deleteSaleLine,
    confirm,
    retry,
  };
}
