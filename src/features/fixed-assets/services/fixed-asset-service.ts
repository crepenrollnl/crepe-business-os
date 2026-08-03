/**
 * Fixed Assets & Straight-Line Depreciation service (Critical Finding #3,
 * Phase E, step 2).
 *
 * Thin wrapper around register_fixed_asset / run_pending_depreciation
 * (sql/084) plus read access to fixed_assets / depreciation_entries for the
 * /fixed-assets list. Never writes journal_entries / journal_lines /
 * ledger_entries directly — run_pending_depreciation is the only writer of
 * those from this feature.
 */

import { roundMoney } from "@/lib/money";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  FixedAsset,
  FixedAssetWithDepreciation,
  RegisterFixedAssetInput,
  RunDepreciationResult,
} from "../types/fixed-asset";

interface DepreciationEntryAmountRow {
  fixed_asset_id: string;
  amount: number | string;
}

interface RunPendingDepreciationRpcDetail {
  fixed_asset_id: string;
  period: string;
  amount: number;
  posting_number: string;
}

interface RunPendingDepreciationRpcSkipped {
  fixed_asset_id: string;
  reason: string;
}

interface RunPendingDepreciationRpcResult {
  entries_created: number;
  total_amount: number;
  details: RunPendingDepreciationRpcDetail[];
  skipped: RunPendingDepreciationRpcSkipped[];
}

function toRunDepreciationResult(
  rpc: RunPendingDepreciationRpcResult,
): RunDepreciationResult {
  return {
    entriesCreated: rpc.entries_created,
    totalAmount: rpc.total_amount,
    details: (rpc.details ?? []).map((detail) => ({
      fixedAssetId: detail.fixed_asset_id,
      period: detail.period,
      amount: detail.amount,
      postingNumber: detail.posting_number,
    })),
    skipped: (rpc.skipped ?? []).map((skipped) => ({
      fixedAssetId: skipped.fixed_asset_id,
      reason: skipped.reason,
    })),
  };
}

export const fixedAssetService = {
  /**
   * Register a fixed asset already owned before this system existed.
   * Records data only — posts no journal entry (register_fixed_asset,
   * sql/084).
   */
  async registerFixedAsset(
    input: RegisterFixedAssetInput,
  ): Promise<ServiceResult<FixedAsset>> {
    try {
      const { data, error } = await supabase.rpc("register_fixed_asset", {
        p_name: input.name.trim(),
        p_purchase_date: input.purchaseDate,
        p_cost: roundMoney(input.cost),
        p_useful_life_months: input.usefulLifeMonths,
      });

      if (error || !data) {
        return fail(toUserError(error, "Failed to register fixed asset."));
      }

      return ok(data as FixedAsset);
    } catch (error) {
      return fail(toUserError(error, "Failed to register fixed asset."));
    }
  },

  /**
   * List active fixed assets by purchase date, each enriched with the sum
   * already posted in depreciation_entries and the resulting remaining
   * (book) value — cost - depreciated_amount.
   */
  async listFixedAssets(): Promise<ServiceResult<FixedAssetWithDepreciation[]>> {
    try {
      const { data, error } = await supabase
        .from("fixed_assets")
        .select(
          "id, name, purchase_date, cost, useful_life_months, is_active, created_at",
        )
        .eq("is_active", true)
        .order("purchase_date", { ascending: true });

      if (error) {
        return fail(toUserError(error, "Failed to load fixed assets."));
      }

      const rows = (data ?? []) as FixedAsset[];
      const assetIds = rows.map((row) => row.id);

      const depreciatedMap = new Map<string, number>();

      if (assetIds.length > 0) {
        const { data: entryRows, error: entriesError } = await supabase
          .from("depreciation_entries")
          .select("fixed_asset_id, amount")
          .in("fixed_asset_id", assetIds);

        if (entriesError) {
          return fail(
            toUserError(entriesError, "Failed to load depreciation entries."),
          );
        }

        for (const entry of (entryRows ?? []) as DepreciationEntryAmountRow[]) {
          const amount =
            typeof entry.amount === "number" ? entry.amount : Number(entry.amount);
          depreciatedMap.set(
            entry.fixed_asset_id,
            (depreciatedMap.get(entry.fixed_asset_id) ?? 0) + amount,
          );
        }
      }

      const enriched: FixedAssetWithDepreciation[] = rows.map((row) => {
        const depreciatedAmount = roundMoney(depreciatedMap.get(row.id) ?? 0);
        return {
          ...row,
          depreciated_amount: depreciatedAmount,
          remaining_value: roundMoney(row.cost - depreciatedAmount),
        };
      });

      return ok(enriched);
    } catch (error) {
      return fail(toUserError(error, "Failed to load fixed assets."));
    }
  },

  /**
   * Catch up all months missed since the last visit for every active asset
   * (run_pending_depreciation, sql/084). Per-asset isolated on the SQL side
   * — a failure for one asset never blocks the others in the same call.
   */
  async runPendingDepreciation(): Promise<ServiceResult<RunDepreciationResult>> {
    try {
      const { data, error } = await supabase.rpc("run_pending_depreciation");

      if (error || !data) {
        return fail(toUserError(error, "Failed to run pending depreciation."));
      }

      return ok(toRunDepreciationResult(data as RunPendingDepreciationRpcResult));
    } catch (error) {
      return fail(toUserError(error, "Failed to run pending depreciation."));
    }
  },
};
