/**
 * DEV-017 — inventory mutation surface for Production Execution.
 *
 * Client helpers must not expose decrement_ingredient_stock.
 * Stock decrease is only allowed via complete_production_session.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe("stock-mutation-service (DEV-017)", () => {
  let stockMutationService: typeof import("./stock-mutation-service");

  beforeAll(async () => {
    stockMutationService = await import("./stock-mutation-service");
  });

  it("does not export a public decreaseIngredientStock helper", () => {
    expect("decreaseIngredientStock" in stockMutationService).toBe(false);
    expect(
      (stockMutationService as Record<string, unknown>).decreaseIngredientStock,
    ).toBeUndefined();
  });

  it("keeps increaseIngredientStock for the Purchases receive path only", () => {
    expect(typeof stockMutationService.increaseIngredientStock).toBe(
      "function",
    );
  });
});
