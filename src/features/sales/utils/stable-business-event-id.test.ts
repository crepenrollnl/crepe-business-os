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

  it("matches the ids the database trigger posts under (same vectors as sql/147)", () => {
    expect(
      stableBusinessEventId(
        "sale_completed:00000000-0000-4000-8000-000000000001",
      ),
    ).toBe("c0a54b67-7e60-576f-b0c0-8fd8de2d1f52");
    expect(
      stableBusinessEventId(
        "cogs_recognized:00000000-0000-4000-8000-000000000001",
      ),
    ).toBe("16fe6b1e-b18b-5410-ac0f-f9debb82d8d0");
  });

  it("differs across sale event keys", () => {
    expect(stableBusinessEventId("sale_completed:a")).not.toBe(
      stableBusinessEventId("cogs_recognized:a"),
    );
  });
});
