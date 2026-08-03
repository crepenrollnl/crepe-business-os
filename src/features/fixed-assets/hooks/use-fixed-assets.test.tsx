/**
 * Hook coverage for useFixedAssets (Critical Finding #3, Phase E, step 2 —
 * post-review fix).
 *
 * Covers the two scenarios found in review: a failed depreciation catch-up
 * must not block an otherwise-successful asset list, and registering an
 * asset with a historical purchase_date must reflect its already-elapsed
 * depreciation immediately, without a separate page reload.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixedAssetWithDepreciation } from "../types/fixed-asset";

const {
  registerFixedAssetMock,
  listFixedAssetsMock,
  runPendingDepreciationMock,
} = vi.hoisted(() => ({
  registerFixedAssetMock: vi.fn(),
  listFixedAssetsMock: vi.fn(),
  runPendingDepreciationMock: vi.fn(),
}));

vi.mock("../services/fixed-asset-service", () => ({
  fixedAssetService: {
    registerFixedAsset: (...args: unknown[]) => registerFixedAssetMock(...args),
    listFixedAssets: (...args: unknown[]) => listFixedAssetsMock(...args),
    runPendingDepreciation: (...args: unknown[]) =>
      runPendingDepreciationMock(...args),
  },
}));

import { useFixedAssets } from "./use-fixed-assets";

const FOOD_TRUCK: FixedAssetWithDepreciation = {
  id: "asset-1",
  name: "Food truck",
  purchase_date: "2026-01-15",
  cost: 24000,
  useful_life_months: 60,
  is_active: true,
  created_at: "2026-01-15T10:00:00.000Z",
  depreciated_amount: 0,
  remaining_value: 24000,
};

describe("useFixedAssets", () => {
  beforeEach(() => {
    registerFixedAssetMock.mockReset();
    listFixedAssetsMock.mockReset();
    runPendingDepreciationMock.mockReset();
  });

  it("shows the asset list normally with a separate warning when the depreciation catch-up itself fails", async () => {
    runPendingDepreciationMock.mockResolvedValue({
      data: null,
      error: "Depreciation Expense account (6200) is missing or inactive.",
    });
    listFixedAssetsMock.mockResolvedValue({ data: [FOOD_TRUCK], error: null });

    const { result } = renderHook(() => useFixedAssets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // The list itself loaded fine -- must not be reported as a list error.
    expect(result.current.error).toBeNull();
    expect(result.current.assets).toEqual([FOOD_TRUCK]);

    // The depreciation-run failure is surfaced separately, non-blocking.
    expect(result.current.depreciationWarning).toBe(
      "Depreciation Expense account (6200) is missing or inactive.",
    );
    expect(result.current.depreciationBanner).toBeNull();
  });

  it("catches up depreciation for a newly registered historical asset before reloading the list, and shows the same banner as on page load", async () => {
    // Initial page load: no assets yet, nothing to depreciate.
    runPendingDepreciationMock.mockResolvedValueOnce({
      data: { entriesCreated: 0, totalAmount: 0, details: [], skipped: [] },
      error: null,
    });
    listFixedAssetsMock.mockResolvedValueOnce({ data: [], error: null });

    const { result } = renderHook(() => useFixedAssets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Register an asset bought 3 months ago.
    registerFixedAssetMock.mockResolvedValue({
      data: { ...FOOD_TRUCK, depreciated_amount: undefined, remaining_value: undefined },
      error: null,
    });

    // After registration, the hook must run depreciation catch-up BEFORE
    // reloading the list -- these are the only mocks configured for that
    // second round, so out-of-order calls would surface as unmocked
    // rejections/undefined data.
    runPendingDepreciationMock.mockResolvedValueOnce({
      data: {
        entriesCreated: 3,
        totalAmount: 1200,
        details: [
          { fixedAssetId: "asset-1", period: "2026-06-01", amount: 400, postingNumber: "JE-1" },
          { fixedAssetId: "asset-1", period: "2026-07-01", amount: 400, postingNumber: "JE-2" },
          { fixedAssetId: "asset-1", period: "2026-08-01", amount: 400, postingNumber: "JE-3" },
        ],
        skipped: [],
      },
      error: null,
    });
    const depreciatedAsset: FixedAssetWithDepreciation = {
      ...FOOD_TRUCK,
      depreciated_amount: 1200,
      remaining_value: 22800,
    };
    listFixedAssetsMock.mockResolvedValueOnce({
      data: [depreciatedAsset],
      error: null,
    });

    let succeeded = false;
    await act(async () => {
      succeeded = await result.current.submitAsset({
        name: "Food truck",
        purchaseDate: "2026-01-15",
        cost: 24000,
        usefulLifeMonths: 60,
      });
    });

    expect(succeeded).toBe(true);
    // The list already reflects the just-posted depreciation -- no
    // separate reload was needed.
    expect(result.current.assets).toEqual([depreciatedAsset]);
    expect(result.current.depreciationBanner).toEqual({
      entriesCreated: 3,
      totalAmount: 1200,
      details: [
        { fixedAssetId: "asset-1", period: "2026-06-01", amount: 400, postingNumber: "JE-1" },
        { fixedAssetId: "asset-1", period: "2026-07-01", amount: 400, postingNumber: "JE-2" },
        { fixedAssetId: "asset-1", period: "2026-08-01", amount: 400, postingNumber: "JE-3" },
      ],
      skipped: [],
    });
  });
});
