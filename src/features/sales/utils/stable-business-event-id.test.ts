import { describe, expect, it } from "vitest";
import { stableBusinessEventId } from "./stable-business-event-id";

describe("stableBusinessEventId (DEV-109)", () => {
  it("is deterministic for the same key", () => {
    const a = stableBusinessEventId("sale_completed:sale-1");
    const b = stableBusinessEventId("sale_completed:sale-1");
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("differs across sale event keys", () => {
    expect(stableBusinessEventId("sale_completed:a")).not.toBe(
      stableBusinessEventId("cogs_recognized:a"),
    );
  });
});
