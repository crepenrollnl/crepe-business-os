import { describe, expect, it } from "vitest";
import {
  canAccessPath,
  isNavItemVisible,
  navItems,
  osHomePathForRole,
  rolesForPath,
  SELLER_HOME_PATH,
} from "./navigation";
import { canSeeCosts } from "./roles";

describe("route table (src/lib/navigation.ts)", () => {
  it.each([
    ["/pos", ["owner", "partner", "seller"]],
    ["/sales", ["owner", "partner", "seller"]],
    ["/sales/quick", ["owner", "partner", "seller"]],
    ["/sales/0b7c-sale", ["owner", "partner", "seller"]],
    ["/write-off-requests", ["owner", "partner", "seller"]],
    ["/inventory", ["owner", "partner", "seller"]],
    ["/recipes", ["owner", "partner", "seller"]],
    ["/finished-goods", ["owner", "partner", "seller"]],
    ["/", ["owner", "partner"]],
    ["/inventory/ingredients/i-1/movements", ["owner", "partner"]],
    ["/recipes/cost-report", ["owner", "partner"]],
    ["/purchases", ["owner", "partner"]],
    ["/purchases/receipts", ["owner", "partner"]],
    ["/production", ["owner", "partner"]],
    ["/production-planning/p-1", ["owner", "partner"]],
    ["/production-execution/sessions/s-1", ["owner", "partner"]],
    ["/accounting/profit-and-loss", ["owner", "partner"]],
    ["/expenses", ["owner", "partner"]],
    ["/fixed-assets", ["owner", "partner"]],
    ["/reports", ["owner", "partner"]],
    ["/reports/btw", ["owner", "partner"]],
    ["/reports/posting-failures", ["owner", "partner"]],
    ["/reports/sales-by-product", ["owner", "partner"]],
  ])("%s → %j", (path, roles) => {
    expect(rolesForPath(path)).toEqual(roles);
  });

  it("uses the longest matching path, not a plain string prefix", () => {
    expect(canAccessPath("/salesforce", "seller")).toBe(false);
    expect(canAccessPath("/recipes-archive", "seller")).toBe(false);
    expect(canAccessPath("/recipes/r-1", "seller")).toBe(true);
  });

  it("ignores query strings and a trailing slash", () => {
    expect(canAccessPath("/inventory?tab=finished-goods", "seller")).toBe(true);
    expect(canAccessPath("/purchases/", "seller")).toBe(false);
    expect(canAccessPath("/pos/", "seller")).toBe(true);
  });

  it("keeps an unlisted page owner/partner only", () => {
    expect(rolesForPath("/settings")).toEqual(["owner", "partner"]);
    expect(canAccessPath("/settings", "seller")).toBe(false);
  });

  it("allows nothing without a role or with an unknown role", () => {
    expect(canAccessPath("/pos", null)).toBe(false);
    expect(canAccessPath("/pos", "guest")).toBe(false);
  });

  it("drives the menu: every item is visible exactly when its page is open", () => {
    for (const role of ["owner", "partner", "seller", null]) {
      for (const item of navItems) {
        expect(isNavItemVisible(item, role)).toBe(canAccessPath(item.href, role));
      }
    }
  });

  it("Back to OS: dashboard for owner/partner, Sales (a seller page with the menu) for a seller", () => {
    expect(osHomePathForRole("owner")).toBe("/");
    expect(osHomePathForRole("partner")).toBe("/");
    expect(osHomePathForRole("seller")).toBe("/sales");
    expect(canAccessPath(osHomePathForRole("seller"), "seller")).toBe(true);
    expect(canAccessPath(SELLER_HOME_PATH, "seller")).toBe(true);
  });

  it("shows the Write-off requests menu item, with its pending counter, to every role", () => {
    const item = navItems.find((navItem) => navItem.href === "/write-off-requests");
    expect(item).toMatchObject({
      label: "Write-off requests",
      counter: "pendingWriteOffRequests",
    });
    for (const role of ["owner", "partner", "seller"]) {
      expect(item && isNavItemVisible(item, role)).toBe(true);
    }
  });

  it("canSeeCosts is owner and partner only", () => {
    expect(canSeeCosts("owner")).toBe(true);
    expect(canSeeCosts("partner")).toBe(true);
    expect(canSeeCosts("seller")).toBe(false);
    expect(canSeeCosts(null)).toBe(false);
  });
});
