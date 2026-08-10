/**
 * Fixed Assets & Straight-Line Depreciation service coverage (Critical
 * Finding #3, Phase E, step 2).
 *
 * register_fixed_asset / run_pending_depreciation themselves (posting,
 * per-asset isolation, rounding remainder) are covered in SQL (sql/084) —
 * this file covers RPC parameter/response mapping and the
 * depreciated/remaining aggregation built in listFixedAssets.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { fixedAssetService } from "./fixed-asset-service";

function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (
    resolve: (value: { data: unknown; error: unknown }) => void,
  ) => resolve(result);
  return chain;
}

describe("fixedAssetService.registerFixedAsset", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("calls register_fixed_asset with trimmed name and rounded cost", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        id: "asset-1",
        name: "Food truck",
        purchase_date: "2026-01-15",
        cost: 24000,
        useful_life_months: 60,
        is_active: true,
        created_at: "2026-08-03T10:00:00.000Z",
      },
      error: null,
    });

    const result = await fixedAssetService.registerFixedAsset({
      name: "  Food truck  ",
      purchaseDate: "2026-01-15",
      cost: 24000.005,
      usefulLifeMonths: 60,
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("register_fixed_asset", {
      p_name: "Food truck",
      p_purchase_date: "2026-01-15",
      p_cost: 24000.01,
      p_useful_life_months: 60,
    });

    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("asset-1");
  });

  it("surfaces the RPC's own error message instead of a generic fallback", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Useful life (months) must be greater than 0." },
    });

    const result = await fixedAssetService.registerFixedAsset({
      name: "Oven",
      purchaseDate: "2026-01-01",
      cost: 500,
      usefulLifeMonths: 0,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("Useful life (months) must be greater than 0.");
  });
});

describe("fixedAssetService.listFixedAssets", () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
  });

  it("computes depreciated_amount and remaining_value from depreciation_entries", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "fixed_assets") {
        return queryChain({
          data: [
            {
              id: "asset-1",
              name: "Food truck",
              purchase_date: "2026-01-15",
              cost: 24000,
              useful_life_months: 60,
              is_active: true,
              created_at: "2026-01-15T10:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "depreciation_entries") {
        return queryChain({
          data: [
            { fixed_asset_id: "asset-1", amount: 400 },
            { fixed_asset_id: "asset-1", amount: 400 },
            { fixed_asset_id: "asset-1", amount: 400 },
          ],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await fixedAssetService.listFixedAssets();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "asset-1",
        depreciated_amount: 1200,
        remaining_value: 22800,
      }),
    ]);
  });

  it("returns depreciated_amount 0 / remaining_value === cost for an asset with no entries yet", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "fixed_assets") {
        return queryChain({
          data: [
            {
              id: "asset-2",
              name: "Refrigeration unit",
              purchase_date: "2026-08-01",
              cost: 3000,
              useful_life_months: 36,
              is_active: true,
              created_at: "2026-08-01T10:00:00.000Z",
            },
          ],
          error: null,
        });
      }
      if (table === "depreciation_entries") {
        return queryChain({ data: [], error: null });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await fixedAssetService.listFixedAssets();

    expect(result.data).toEqual([
      expect.objectContaining({
        depreciated_amount: 0,
        remaining_value: 3000,
      }),
    ]);
  });

  it("returns an empty list without querying depreciation_entries when there are no assets", async () => {
    const entriesFrom = vi.fn();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "fixed_assets") {
        return queryChain({ data: [], error: null });
      }
      entriesFrom(table);
      return queryChain({ data: [], error: null });
    });

    const result = await fixedAssetService.listFixedAssets();

    expect(result.data).toEqual([]);
    expect(entriesFrom).not.toHaveBeenCalled();
  });

  it("fails clearly when fixed_assets cannot be loaded", async () => {
    supabaseMock.from.mockImplementation(() =>
      queryChain({ data: null, error: { message: "boom" } }),
    );

    const result = await fixedAssetService.listFixedAssets();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("fixedAssetService.runPendingDepreciation", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("maps entries_created/total_amount/details/skipped to camelCase", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        entries_created: 2,
        total_amount: 800,
        details: [
          {
            fixed_asset_id: "asset-1",
            period: "2026-07-01",
            amount: 400,
            posting_number: "JE-2026-000010",
          },
          {
            fixed_asset_id: "asset-1",
            period: "2026-08-01",
            amount: 400,
            posting_number: "JE-2026-000011",
          },
        ],
        skipped: [{ fixed_asset_id: "asset-2", reason: "No open fiscal period covers 2027-01-01." }],
      },
      error: null,
    });

    const result = await fixedAssetService.runPendingDepreciation();

    expect(supabaseMock.rpc).toHaveBeenCalledWith("run_pending_depreciation");
    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      entriesCreated: 2,
      totalAmount: 800,
      details: [
        {
          fixedAssetId: "asset-1",
          period: "2026-07-01",
          amount: 400,
          postingNumber: "JE-2026-000010",
        },
        {
          fixedAssetId: "asset-1",
          period: "2026-08-01",
          amount: 400,
          postingNumber: "JE-2026-000011",
        },
      ],
      skipped: [
        {
          fixedAssetId: "asset-2",
          reason: "No open fiscal period covers 2027-01-01.",
        },
      ],
    });
  });

  it("fails clearly when the RPC errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "Depreciation Expense account (6200) is missing or inactive." },
    });

    const result = await fixedAssetService.runPendingDepreciation();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Depreciation Expense account (6200) is missing or inactive.",
    );
  });
});
