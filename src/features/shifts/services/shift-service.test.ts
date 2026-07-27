/**
 * Service-level coverage for shiftService (DEV-112).
 *
 * Covers open / close / active lookup, duplicate guards, and historical preservation.
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

import { shiftService } from "./shift-service";
import type { Shift } from "../types/shift";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

function mockOpenInsert(
  active: Record<string, unknown> | null,
  inserted: Record<string, unknown> | null,
  insertError: unknown = null,
) {
  const activeLookup = mockActiveLookup(active);

  const single = vi.fn().mockResolvedValue({
    data: insertError ? null : inserted,
    error: insertError,
  });
  const selectAfterInsert = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select: selectAfterInsert });

  let call = 0;
  supabaseMock.from.mockImplementation((table: string) => {
    expect(table).toBe("shifts");
    call += 1;
    if (call === 1) {
      return { select: activeLookup.select };
    }
    return { insert };
  });

  return { activeLookup, insert, selectAfterInsert, single };
}

function mockCloseFlow(options: {
  existing: Record<string, unknown> | null;
  updated?: Record<string, unknown> | null;
  loadError?: unknown;
  updateError?: unknown;
}) {
  const loadMaybeSingle = vi.fn().mockResolvedValue({
    data: options.loadError ? null : options.existing,
    error: options.loadError ?? null,
  });
  const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle });
  const loadSelect = vi.fn().mockReturnValue({ eq: loadEq });

  const updateMaybeSingle = vi.fn().mockResolvedValue({
    data: options.updateError ? null : (options.updated ?? null),
    error: options.updateError ?? null,
  });
  const updateSelect = vi.fn().mockReturnValue({
    maybeSingle: updateMaybeSingle,
  });
  const updateEqStatus = vi.fn().mockReturnValue({ select: updateSelect });
  const updateEqId = vi.fn().mockReturnValue({ eq: updateEqStatus });
  const update = vi.fn().mockReturnValue({ eq: updateEqId });

  let call = 0;
  supabaseMock.from.mockImplementation((table: string) => {
    expect(table).toBe("shifts");
    call += 1;
    if (call === 1) {
      return { select: loadSelect };
    }
    return { update };
  });

  return {
    loadSelect,
    loadEq,
    loadMaybeSingle,
    update,
    updateSelect,
    updateEqId,
    updateEqStatus,
    updateMaybeSingle,
  };
}

describe("shiftService (DEV-112)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
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
    it("opens a shift when none is active", async () => {
      const flow = mockOpenInsert(null, openRow({ notes: "Start" }));

      const result = await shiftService.openShift({ notes: "  Start  " });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        shift: mappedOpen({ notes: "Start" }),
      });
      expect(flow.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "open",
          closed_at: null,
          notes: "Start",
          opened_by: USER_ID,
        }),
      );
    });

    it("rejects duplicate open when an active shift already exists", async () => {
      const flow = mockOpenInsert(openRow(), null);

      const result = await shiftService.openShift({});

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "A shift is already open. Close it before opening another.",
      );
      expect(flow.insert).not.toHaveBeenCalled();
    });

    it("maps unique-index duplicate open errors", async () => {
      const flow = mockOpenInsert(null, null, {
        message:
          'duplicate key value violates unique constraint "shifts_one_open_uidx"',
      });

      const result = await shiftService.openShift({});

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "A shift is already open. Close it before opening another.",
      );
      expect(flow.insert).toHaveBeenCalled();
    });

    it("requires authentication", async () => {
      supabaseMock.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await shiftService.openShift({});

      expect(result.data).toBeNull();
      expect(result.error).toBe("You must be signed in to open a shift.");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });
  });

  describe("closeShift", () => {
    it("closes an open shift and preserves opened_at / id", async () => {
      const flow = mockCloseFlow({
        existing: openRow(),
        updated: closedRow(),
      });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        shift: mappedClosed(),
      });
      expect(result.data?.shift.id).toBe(SHIFT_ID);
      expect(result.data?.shift.opened_at).toBe(OPENED_AT);
      expect(result.data?.shift.created_at).toBe(CREATED_AT);
      expect(flow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "closed",
          closed_by: USER_ID,
        }),
      );
      expect(flow.updateEqId).toHaveBeenCalledWith("id", SHIFT_ID);
      expect(flow.updateEqStatus).toHaveBeenCalledWith("status", "open");
    });

    it("rejects closing a non-existent shift", async () => {
      const flow = mockCloseFlow({ existing: null });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift was not found.");
      expect(flow.update).not.toHaveBeenCalled();
    });

    it("rejects duplicate close of an already closed shift", async () => {
      const flow = mockCloseFlow({ existing: closedRow() });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.data).toBeNull();
      expect(result.error).toBe("This shift is already closed.");
      expect(flow.update).not.toHaveBeenCalled();
    });

    it("rejects concurrent duplicate close when update matches no open row", async () => {
      const flow = mockCloseFlow({
        existing: openRow(),
        updated: null,
      });

      const result = await shiftService.closeShift({ shift_id: SHIFT_ID });

      expect(result.data).toBeNull();
      expect(result.error).toBe("This shift is already closed.");
      expect(flow.update).toHaveBeenCalled();
    });

    it("requires a valid shift id", async () => {
      const result = await shiftService.closeShift({ shift_id: "bad" });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Shift id is required.");
      expect(supabaseMock.from).not.toHaveBeenCalled();
    });
  });
});
