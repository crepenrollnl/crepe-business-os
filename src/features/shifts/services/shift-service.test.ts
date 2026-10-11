/**
 * Service-level coverage for shiftService (DEV-112).
 *
 * Covers active lookup and the open_shift / close_shift RPCs (sql/142),
 * which enforce the single open shift and write both daily summaries.
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

import { shiftService } from "./shift-service";
import type { Shift } from "../types/shift";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPENED_AT = "2026-07-26T08:00:00.000Z";
const CREATED_AT = "2026-07-26T08:00:00.000Z";
const CLOSED_AT = "2026-07-26T18:00:00.000Z";

const SHIFT_SELECT =
  "id, opened_at, closed_at, status, notes, created_at";

function openRow(overrides?: Record<string, unknown>) {
  return {
    id: SHIFT_ID,
    opened_at: OPENED_AT,
    closed_at: null,
    status: "open",
    notes: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

function closedRow(overrides?: Record<string, unknown>) {
  return {
    id: SHIFT_ID,
    opened_at: OPENED_AT,
    closed_at: CLOSED_AT,
    status: "closed",
    notes: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

function mappedOpen(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: OPENED_AT,
    closed_at: null,
    status: "open",
    notes: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

function mappedClosed(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: OPENED_AT,
    closed_at: CLOSED_AT,
    status: "closed",
    notes: null,
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** close_shift returns numerics as JSON numbers or strings; both must map. */
function salesSummaryRow() {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    shift_id: SHIFT_ID,
    sales_count: 3,
    items_sold: "9.000",
    gross_revenue: 300,
    net_revenue: "250.00",
    average_receipt: 100,
    generated_at: CLOSED_AT,
    created_at: CLOSED_AT,
  };
}

function profitSummaryRow() {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    shift_id: SHIFT_ID,
    net_revenue: 250,
    total_cogs: "100.00",
    gross_profit: 150,
    gross_margin_percent: 60,
    generated_at: CLOSED_AT,
    created_at: CLOSED_AT,
  };
}

function mockActiveLookup(
  row: Record<string, unknown> | null,
  error: unknown = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: error ? null : row,
    error,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });

  return { select, eq, maybeSingle };
}

describe("shiftService (DEV-112)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getActiveShift", () => {
    it("returns the active open shift", async () => {
      const lookup = mockActiveLookup(openRow({ notes: "Morning" }));
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shifts");
        return { select: lookup.select };
      });

      const result = await shiftService.getActiveShift();

      expect(result.error).toBeNull();
      expect(result.data).toEqual(
        mappedOpen({ notes: "Morning" }) satisfies Shift,
      );
      expect(lookup.select).toHaveBeenCalledWith(SHIFT_SELECT);
      expect(lookup.eq).toHaveBeenCalledWith("status", "open");
    });

    it("returns null when no shift is open", async () => {
      const lookup = mockActiveLookup(null);
      supabaseMock.from.mockImplementation((table: string) => {
        expect(table).toBe("shifts");
        return { select: lookup.select };
      });

      const result = await shiftService.getActiveShift();

      expect(result.error).toBeNull();
      expect(result.data).toBeNull();
    });
  });

  describe("openShift", () => {
    it("calls open_shift with trimmed notes and maps the shift", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: openRow({ notes: "Start" }),
        error: null,
      });

      const result = await shiftService.openShift({ notes: "  Start  " });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        shift: mappedOpen({ notes: "Start" }),
      });
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("open_shift", {
        p_notes: "Start",
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("sends null notes when none are given", async () => {
      supabaseMock.rpc.mockResolvedValue({ data: openRow(), error: null });

      const result = await shiftService.openShift({});

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith("open_shift", {
        p_notes: null,
      });
    });

    it("surfaces the RPC error message verbatim", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "A shift is already open. Close it before opening another.",
        },
      });

      const result = await shiftService.openShift({});

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "A shift is already open. Close it before opening another.",
      );
    });

    it("rejects notes that are too long without calling the RPC", async () => {
      const result = await shiftService.openShift({ notes: "x".repeat(5000) });

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/^Notes must be \d+ characters or fewer\.$/);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("fails when the RPC returns an invalid shift", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: openRow({ status: "weird" }),
        error: null,
      });

      const result = await shiftService.openShift({});

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift opened but the response was invalid.");
    });
  });

  describe("closeShift", () => {
    it("calls close_shift and returns the shift with both summaries", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          shift: closedRow(),
          sales_summary: salesSummaryRow(),
          profit_summary: profitSummaryRow(),
        },
        error: null,
      });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        shift: mappedClosed(),
        salesSummary: {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          shift_id: SHIFT_ID,
          sales_count: 3,
          items_sold: 9,
          gross_revenue: 300,
          net_revenue: 250,
          average_receipt: 100,
          generated_at: CLOSED_AT,
          created_at: CLOSED_AT,
        },
        profitSummary: {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          shift_id: SHIFT_ID,
          net_revenue: 250,
          total_cogs: 100,
          gross_profit: 150,
          gross_margin_percent: 60,
          generated_at: CLOSED_AT,
          created_at: CLOSED_AT,
        },
      });
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("close_shift", {
        p_shift_id: SHIFT_ID,
        p_notes: null,
      });
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });

    it("passes trimmed notes when given", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          shift: closedRow({ notes: "Busy day" }),
          sales_summary: salesSummaryRow(),
          profit_summary: profitSummaryRow(),
        },
        error: null,
      });

      await shiftService.closeShift({
        shift_id: SHIFT_ID,
        notes: "  Busy day ",
      });

      expect(supabaseMock.rpc).toHaveBeenCalledWith("close_shift", {
        p_shift_id: SHIFT_ID,
        p_notes: "Busy day",
      });
    });

    it.each([
      "Shift was not found.",
      "This shift is already closed.",
    ])("surfaces the RPC error %s verbatim", async (message) => {
      supabaseMock.rpc.mockResolvedValue({ data: null, error: { message } });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.data).toBeNull();
      expect(result.error).toBe(message);
    });

    it("fails when a summary is missing from the RPC result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { shift: closedRow(), sales_summary: salesSummaryRow() },
        error: null,
      });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift closed but the response was invalid.");
    });

    it("requires a valid shift id without calling the RPC", async () => {
      const result = await shiftService.closeShift({ shift_id: "bad" });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });
  });
});
