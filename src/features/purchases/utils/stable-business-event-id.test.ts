import { describe, expect, it } from "vitest";
import { stableBusinessEventId } from "./stable-business-event-id";

describe("stableBusinessEventId (purchases accounting)", () => {
  it("returns a stable UUID for the same key", () => {
    const a = stableBusinessEventId("purchase_received:purchase-1");
    const b = stableBusinessEventId("purchase_received:purchase-1");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("matches the ids the database trigger posts under (same vectors as sql/150)", () => {
    expect(
      stableBusinessEventId(
        "purchase_received:00000000-0000-4000-8000-000000000001",
      ),
    ).toBe("9c483a98-95eb-5198-906f-c92fc7da8ede");
    expect(
      stableBusinessEventId(
        "purchase_received:00000000-0000-4000-8000-000000000002",
      ),
    ).toBe("fa1f59d4-2589-57e8-92ed-27ce40438bd1");
  });

  it("returns different ids for different keys", () => {
    expect(stableBusinessEventId("purchase_received:a")).not.toBe(
      stableBusinessEventId("purchase_received:b"),
    );
  });
});
