/**
 * Completed Sale Review reconciliation (V1 plan 1.8 follow-up).
 *
 * The sale detail page loads COGS and profit as two independent reads.
 * saleProfitService internally re-reads COGS itself and verifies both
 * figures together against verify_sale_cost_and_profit (sql/077), but the
 * page's own separate COGS read never sees that verification result.
 * Without this reconciliation, a failed server-side check would surface
 * only as a profit error while the COGS card kept showing unverified
 * numbers right next to it, unchanged.
 *
 * Rule: any completed-sale profit failure means the COGS figure it was
 * built from is not shown either — regardless of whether the failure was
 * the verification mismatch itself, the RPC call erroring, or a genuine
 * COGS-level failure the profit path re-derives from the same ledger.
 */

import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";

export const COGS_UNVERIFIED_MESSAGE =
  "Cost figures failed a server-side check together with profit and are not shown for this sale.";

export interface CompletedSaleReviewRead<T> {
  data: T | null;
  error: string | null;
}

export interface CompletedSaleReviewInputs {
  cogs: CompletedSaleReviewRead<SaleCostSummary>;
  profit: CompletedSaleReviewRead<SaleProfitSummary>;
}

export interface CompletedSaleReviewResolution {
  cogsSummary: SaleCostSummary | null;
  cogsError: string | null;
  profitSummary: SaleProfitSummary | null;
  profitError: string | null;
}

/**
 * Reconcile independently-loaded COGS and profit reads for the sale detail
 * page. When profit failed, COGS is hidden too — profit is built from the
 * same COGS figure and verified server-side as one unit (sql/077), so a
 * profit failure means that figure was never confirmed either.
 */
export function reconcileCompletedSaleReview(
  inputs: CompletedSaleReviewInputs,
): CompletedSaleReviewResolution {
  if (inputs.profit.error) {
    return {
      cogsSummary: null,
      cogsError: COGS_UNVERIFIED_MESSAGE,
      profitSummary: null,
      profitError: inputs.profit.error,
    };
  }

  return {
    cogsSummary: inputs.cogs.data,
    cogsError: inputs.cogs.error,
    profitSummary: inputs.profit.data,
    profitError: null,
  };
}
