/**
 * Service-level coverage for cashReconciliationService (DEV-113).
 *
 * The reconciliation is written by reconcile_shift_cash (sql/142), which
 * checks the shift and computes expected cash / difference on the server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { cashReconciliationService } from "./cash-reconciliation-service";
import type { CashReconciliation } from "../types/cash-reconciliation";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function reconciliationRow(overrides?: Record<string, unknown>) {
  return {
    id: RECON_ID,
    shift_id: SHIFT_ID,
    expected_cash: 100,
    counted_cash: 100,
    difference: 0,
    notes: null,
    reconciled_at: "2026-07-26T18:05:00.000Z",
    created_at: "2026-07-26T18:05:00.000Z",
    ...overrides,
  };
}

function mappedReconciliation(
  overrides?: Partial<CashReconciliation>,
): CashReconciliation {
  return {
    id: RECON_ID,
    shift_id: SHIFT_ID,
    expected_cash: 100,
    counted_cash: 100,
    difference: 0,
    notes: null,
    reconciled_at: "2026-07-26T18:05:00.000Z",
    created_at: "2026-07-26T18:05:00.000Z",
    ...overrides,
  };
}

describe("cashReconciliationService (DEV-113)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getExpectedCashForShift", () => {
    it("calculates expected cash from opening / in / out", () => {
      expect(
        cashReconciliationService.getExpectedCashForShift({
          opening_cash: 40,
          cash_in: 60,
          cash_out: 5,
        }),
      ).toBe(95);
    });
  });

  describe("reconcileShiftCash", () => {
    it("calls reconcile_shift_cash with zero defaults and maps the row", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: reconciliationRow({
          expected_cash: 0,
          counted_cash: 100,
          difference: 100,
        }),
        error: null,
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        reconciliation: mappedReconciliation({
          expected_cash: 0,
          counted_cash: 100,
          difference: 100,
        }),
      });
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("reconcile_shift_cash", {
        p_shift_id: SHIFT_ID,
        p_counted_cash: 100,
        p_opening_cash: 0,
        p_cash_in: 0,
        p_cash_out: 0,
        p_notes: null,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("passes opening / in / out and trimmed notes", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: reconciliationRow({
          expected_cash: "95.00",
          counted_cash: "90.00",
          difference: "-5.00",
          notes: "Short",
        }),
        error: null,
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 90,
        opening_cash: 40,
        cash_in: 60,
        cash_out: 5,
        notes: "  Short ",
      });

      expect(result.error).toBeNull();
      expect(result.data?.reconciliation).toEqual(
        mappedReconciliation({
          expected_cash: 95,
          counted_cash: 90,
          difference: -5,
          notes: "Short",
        }),
      );
      expect(supabaseMock.rpc).toHaveBeenCalledWith("reconcile_shift_cash", {
        p_shift_id: SHIFT_ID,
        p_counted_cash: 90,
        p_opening_cash: 40,
        p_cash_in: 60,
        p_cash_out: 5,
        p_notes: "Short",
      });
    });

    it.each([
      "Close the shift before reconciling cash.",
      "This shift is already reconciled.",
      "Shift was not found.",
    ])("surfaces the RPC error %s verbatim", async (message) => {
      supabaseMock.rpc.mockResolvedValue({ data: null, error: { message } });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 100,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(message);
    });

    it("rejects negative counted cash without calling the RPC", async () => {
      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: -1,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Counted cash cannot be negative.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects an invalid shift id without calling the RPC", async () => {
      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: "bad",
        counted_cash: 100,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("fails when the RPC returns an invalid row", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: reconciliationRow({ expected_cash: "abc" }),
        error: null,
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 100,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Cash reconciliation saved but the response was invalid.",
      );
    });
  });
});
