import { describe, expect, it } from "vitest";
import { stableBusinessEventId } from "./stable-business-event-id";

describe("stableBusinessEventId (DEV-105)", () => {
  it("returns a stable UUID for the same key", () => {
    const a = stableBusinessEventId("production_completed:session-1");
    const b = stableBusinessEventId("production_completed:session-1");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("matches the ids the database trigger posts under (same vectors as sql/149)", () => {
    expect(
      stableBusinessEventId(
        "production_completed:00000000-0000-4000-8000-000000000001",
      ),
    ).toBe("00804158-d7b6-554b-8cc3-1c7e5d386f1e");
    expect(
      stableBusinessEventId(
        "production_completed:00000000-0000-4000-8000-000000000002",
      ),
    ).toBe("9cc3e665-f3aa-50b7-8b15-d38bbc3b0c64");
  });

  it("returns different ids for different keys", () => {
    expect(stableBusinessEventId("production_completed:a")).not.toBe(
      stableBusinessEventId("production_completed:b"),
    );
  });
});
