/**
 * Service-level coverage for cashReconciliationService (DEV-113).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
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
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const RECONCILIATION_SELECT =
  "id, shift_id, expected_cash, counted_cash, difference, notes, reconciled_at, created_at";

const SHIFT_SELECT =
  "id, opened_at, closed_at, status, notes, created_at";

function closedShiftRow() {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T18:00:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
  };
}

function openShiftRow() {
  return {
    ...closedShiftRow(),
    closed_at: null,
    status: "open",
  };
}

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

function mockShiftLookup(row: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

function mockExistingReconciliation(
  row: Record<string, unknown> | null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select, eq, maybeSingle };
}

describe("cashReconciliationService (DEV-113)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
    supabaseMock.rpc.mockResolvedValue({ data: true, error: null });
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
    it("creates a balanced reconciliation", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(null);

      const inserted = reconciliationRow({
        expected_cash: 50,
        counted_cash: 50,
        difference: 0,
      });
      const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
      const selectAfterInsert = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });

      let call = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        call += 1;
        if (call === 1) {
          expect(table).toBe("shifts");
          return { select: shiftLookup.select };
        }
        if (call === 2) {
          expect(table).toBe("shift_cash_reconciliations");
          return { select: existing.select };
        }
        expect(table).toBe("shift_cash_reconciliations");
        return { insert };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 50,
        opening_cash: 50,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        reconciliation: mappedReconciliation({
          expected_cash: 50,
          counted_cash: 50,
          difference: 0,
        }),
      });
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          shift_id: SHIFT_ID,
          expected_cash: 50,
          counted_cash: 50,
          difference: 0,
          reconciled_by: USER_ID,
        }),
      );
      expect(selectAfterInsert).toHaveBeenCalledWith(RECONCILIATION_SELECT);
      expect(shiftLookup.select).toHaveBeenCalledWith(SHIFT_SELECT);
    });

    it("creates a reconciliation with a positive difference", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(null);
      const inserted = reconciliationRow({
        expected_cash: 100,
        counted_cash: 110,
        difference: 10,
      });
      const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        call += 1;
        if (call === 1) {
          return { select: shiftLookup.select };
        }
        if (call === 2) {
          return { select: existing.select };
        }
        return { insert };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 110,
        opening_cash: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data?.reconciliation.difference).toBe(10);
      expect(
        cashReconciliationService.getCashReconciliationStatus(10),
      ).toBe("difference");
    });

    it("creates a reconciliation with a negative difference", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(null);
      const inserted = reconciliationRow({
        expected_cash: 100,
        counted_cash: 85,
        difference: -15,
      });
      const single = vi.fn().mockResolvedValue({ data: inserted, error: null });
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { select: shiftLookup.select };
        }
        if (call === 2) {
          return { select: existing.select };
        }
        return { insert };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 85,
        opening_cash: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data?.reconciliation.difference).toBe(-15);
    });

    it("rejects reconciling an active shift", async () => {
      const shiftLookup = mockShiftLookup(openShiftRow());
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shifts");
        return { select: shiftLookup.select };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 50,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Close the shift before reconciling cash.");
    });

    it("rejects duplicate reconciliation", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(reconciliationRow());

      let call = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        call += 1;
        if (call === 1) {
          expect(table).toBe("shifts");
          return { select: shiftLookup.select };
        }
        expect(table).toBe("shift_cash_reconciliations");
        return { select: existing.select };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 50,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("This shift is already reconciled.");
    });

    it("maps unique-constraint duplicate reconciliation errors", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(null);
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message:
                'duplicate key value violates unique constraint "shift_cash_reconciliations_shift_uidx"',
            },
          }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { select: shiftLookup.select };
        }
        if (call === 2) {
          return { select: existing.select };
        }
        return { insert };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 50,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("This shift is already reconciled.");
    });

    it("rejects negative counted cash without writing", async () => {
      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: -5,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Counted cash cannot be negative.");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("preserves frozen historical amounts on insert response", async () => {
      const shiftLookup = mockShiftLookup(closedShiftRow());
      const existing = mockExistingReconciliation(null);
      const inserted = reconciliationRow({
        expected_cash: 75,
        counted_cash: 75,
        difference: 0,
      });
      const insert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
        }),
      });

      let call = 0;
      supabaseMock.from.mockImplementation(() => {
        call += 1;
        if (call === 1) {
          return { select: shiftLookup.select };
        }
        if (call === 2) {
          return { select: existing.select };
        }
        return { insert };
      });

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: SHIFT_ID,
        counted_cash: 75,
        opening_cash: 75,
      });

      expect(result.error).toBeNull();
      expect(result.data?.reconciliation).toEqual(
        mappedReconciliation({
          expected_cash: 75,
          counted_cash: 75,
          difference: 0,
        }),
      );
      expect(
        cashReconciliationService.assertCashReconciliationHistoricallyImmutable(
          {
            previous: result.data!.reconciliation,
            next: result.data!.reconciliation,
          },
        ),
      ).toBeNull();
    });
  });
});
