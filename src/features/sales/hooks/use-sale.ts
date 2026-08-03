"use client";

import { useCallback, useEffect, useState } from "react";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { saleAccountingService } from "../services/sale-accounting-service";
import { saleCogsService } from "../services/sale-cogs-service";
import { saleProfitService } from "../services/sale-profit-service";
import { salesReadService } from "../services/sales-read-service";
import { salesService } from "../services/sales-service";
import type { SaleAccountingPostingStatus } from "../types/sale-accounting";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleDetail } from "../types/sale";
import {
  reconcileCompletedSaleReview,
  type CompletedSaleReviewRead,
} from "../utils/completed-sale-review-builder";

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
  const [postingError, setPostingError] = useState<string | null>(null);
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

  /**
   * Loads COGS on its own but does not commit it to state — the sale
   * detail page's displayed cogsSummary/cogsError is decided jointly with
   * the profit read by reconcileCompletedSaleReview below, since profit
   * verifies both figures together (sql/077) and a profit failure means
   * COGS was never confirmed either.
   */
  const loadCogs = useCallback(
    async (detail: SaleDetail): Promise<CompletedSaleReviewRead<SaleCostSummary>> => {
      if (!isCompletedSale(detail)) {
        setCogsLoading(false);
        return { data: null, error: null };
      }

      setCogsLoading(true);

      const result = await saleCogsService.getSaleCostSummary(detail.sale_id);

      setCogsLoading(false);

      if (result.error || !result.data) {
        return { data: null, error: result.error ?? "Failed to load sale COGS" };
      }

      return { data: result.data, error: null };
    },
    [],
  );

  const loadProfit = useCallback(
    async (
      detail: SaleDetail,
      options?: { registerGeneration?: boolean },
    ): Promise<CompletedSaleReviewRead<SaleProfitSummary>> => {
      if (!isCompletedSale(detail)) {
        setProfitLoading(false);
        return { data: null, error: null };
      }

      setProfitLoading(true);

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
          setProfitLoading(false);
          if (!reload.error && reload.data) {
            return { data: reload.data, error: null };
          }
          return {
            data: null,
            error: reload.error ?? result.error ?? "Failed to load sale profit",
          };
        }

        setProfitLoading(false);
        return { data: null, error: result.error ?? "Failed to load sale profit" };
      }

      setProfitLoading(false);
      return { data: result.data, error: null };
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
      const [cogsRead, profitRead] = await Promise.all([
        loadCogs(detail),
        loadProfit(detail, {
          registerGeneration: options?.registerProfitGeneration,
        }),
        loadAccountingStatus(detail),
      ]);

      const resolved = reconcileCompletedSaleReview({
        cogs: cogsRead,
        profit: profitRead,
      });
      setCogsSummary(resolved.cogsSummary);
      setCogsError(resolved.cogsError);
      setProfitSummary(resolved.profitSummary);
      setProfitError(resolved.profitError);
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
    setPostingError(null);

    const contextResult =
      await accountingContextService.getCurrentAccountingContext();

    if (contextResult.error || !contextResult.data) {
      // Accounting infra not ready (e.g. no open fiscal period) — the sale
      // must still confirm; only the journal is skipped, surfaced via
      // postingError rather than blocking the confirmation itself.
      const fallback = await salesService.confirmSale(saleId);

      if (fallback.error || !fallback.data) {
        setActionError(fallback.error ?? "Failed to confirm sale");
        setConfirming(false);
        return false;
      }

      setLastConfirmCogs(fallback.data.total_cogs);
      setPostingError(
        contextResult.error ?? "Accounting posting was skipped.",
      );
    } else {
      const posted = await salesService.confirmSaleAndPostJournals(
        saleId,
        contextResult.data,
      );

      if (posted.error || !posted.data) {
        setActionError(posted.error ?? "Failed to confirm sale");
        setConfirming(false);
        return false;
      }

      setLastConfirmCogs(posted.data.total_cogs);
      setPostingError(posted.data.postingError);
    }

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
    postingError,
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
