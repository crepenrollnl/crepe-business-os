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

  it("returns different ids for different keys", () => {
    expect(stableBusinessEventId("purchase_received:a")).not.toBe(
      stableBusinessEventId("purchase_received:b"),
    );
  });
});
