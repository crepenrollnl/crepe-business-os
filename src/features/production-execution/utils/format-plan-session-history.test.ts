import { describe, expect, it } from "vitest";
import type { ProductionPlanSessionHistoryItem } from "../types/production-session";
import {
  formatPlanSessionFactLabel,
  getPlanSessionDisplayDate,
  pickLatestCompletedPlanSession,
} from "./format-plan-session-history";

function session(
  overrides?: Partial<ProductionPlanSessionHistoryItem>,
): ProductionPlanSessionHistoryItem {
  return {
    id: "session-1",
    session_number: 1,
    status: "completed",
    started_at: "2026-08-22T08:00:00.000Z",
    completed_at: "2026-08-22T10:00:00.000Z",
    lines: [
      {
        recipe_id: "recipe-chicken",
        product_name: "Roasted chicken",
        yield_unit: "kg",
        produced_quantity: 7,
        sort_order: 0,
      },
    ],
    ...overrides,
  };
}

describe("formatPlanSessionFactLabel", () => {
  it("includes session number, status, quantity, unit, and product", () => {
    expect(formatPlanSessionFactLabel(session())).toBe(
      "Session #1 · Completed · 7 kg Roasted chicken",
    );
  });

  it("joins multiple recipe facts", () => {
    expect(
      formatPlanSessionFactLabel(
        session({
          lines: [
            {
              recipe_id: "recipe-chicken",
              product_name: "Roasted chicken",
              yield_unit: "kg",
              produced_quantity: 7,
              sort_order: 0,
            },
            {
              recipe_id: "recipe-sauce",
              product_name: "Garlic sauce",
              yield_unit: "kg",
              produced_quantity: 2.5,
              sort_order: 1,
            },
          ],
        }),
      ),
    ).toBe(
      "Session #1 · Completed · 7 kg Roasted chicken, 2.5 kg Garlic sauce",
    );
  });

  it("omits lines without a produced quantity", () => {
    expect(
      formatPlanSessionFactLabel(
        session({
          status: "in_progress",
          lines: [
            {
              recipe_id: "recipe-chicken",
              product_name: "Roasted chicken",
              yield_unit: "kg",
              produced_quantity: null,
              sort_order: 0,
            },
          ],
        }),
      ),
    ).toBe("Session #1 · In Progress");
  });
});

describe("getPlanSessionDisplayDate", () => {
  it("prefers completed_at when present", () => {
    expect(getPlanSessionDisplayDate(session())).toBe(
      "2026-08-22T10:00:00.000Z",
    );
  });

  it("falls back to started_at", () => {
    expect(
      getPlanSessionDisplayDate(session({ completed_at: null })),
    ).toBe("2026-08-22T08:00:00.000Z");
  });
});

describe("pickLatestCompletedPlanSession", () => {
  it("returns null when no session is completed", () => {
    expect(
      pickLatestCompletedPlanSession([
        session({ status: "in_progress", completed_at: null }),
      ]),
    ).toBeNull();
  });

  it("picks the completed session with the latest completed_at", () => {
    const first = session({
      id: "s1",
      session_number: 1,
      completed_at: "2026-08-21T10:00:00.000Z",
    });
    const second = session({
      id: "s2",
      session_number: 2,
      completed_at: "2026-08-22T10:00:00.000Z",
    });

    expect(pickLatestCompletedPlanSession([first, second])?.id).toBe("s2");
  });
});
