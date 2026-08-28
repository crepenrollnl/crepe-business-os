import { describe, expect, it } from "vitest";
import { isCompletedSaleStatus } from "./is-completed-sale-status";

describe("isCompletedSaleStatus", () => {
  it("treats confirmed and paid as completed", () => {
    expect(isCompletedSaleStatus("confirmed")).toBe(true);
    expect(isCompletedSaleStatus("paid")).toBe(true);
  });

  it("treats draft and cancelled as not completed", () => {
    expect(isCompletedSaleStatus("draft")).toBe(false);
    expect(isCompletedSaleStatus("cancelled")).toBe(false);
  });
});
