/**
 * Unit coverage for getSearchResultHref (DEV-047 navigation mapping).
 *
 * Routes must be derived only from entityType + entityId.
 * No service imports or database calls.
 */

import { describe, expect, it } from "vitest";
import { getSearchResultHref } from "./search-result-href";
import type { GlobalSearchEntityType } from "../types/search";

const ENTITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_WITH_SPECIAL = "id with/spaces&chars?";

describe("getSearchResultHref", () => {
  it.each([
    ["ingredient", `/inventory?id=${encodeURIComponent(ENTITY_ID)}`],
    ["finished_good", `/recipes?id=${encodeURIComponent(ENTITY_ID)}`],
    ["recipe", `/recipes?id=${encodeURIComponent(ENTITY_ID)}`],
    ["customer", `/sales?customerId=${encodeURIComponent(ENTITY_ID)}`],
    ["supplier", `/purchases?supplierId=${encodeURIComponent(ENTITY_ID)}`],
    ["sale", `/sales/${encodeURIComponent(ENTITY_ID)}`],
    ["purchase", `/purchases?id=${encodeURIComponent(ENTITY_ID)}`],
  ] as const satisfies ReadonlyArray<readonly [GlobalSearchEntityType, string]>)(
    "maps %s using only entityType + entityId",
    (entityType, expected) => {
      expect(getSearchResultHref(entityType, ENTITY_ID)).toBe(expected);
    },
  );

  it("encodes entityId with encodeURIComponent", () => {
    const encoded = encodeURIComponent(ID_WITH_SPECIAL);

    expect(getSearchResultHref("ingredient", ID_WITH_SPECIAL)).toBe(
      `/inventory?id=${encoded}`,
    );
    expect(getSearchResultHref("sale", ID_WITH_SPECIAL)).toBe(
      `/sales/${encoded}`,
    );
    expect(getSearchResultHref("customer", ID_WITH_SPECIAL)).toBe(
      `/sales?customerId=${encoded}`,
    );
  });

  it("does not import or call any search services", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("./search-result-href.ts", import.meta.url),
        "utf8",
      ),
    );

    expect(source).not.toMatch(/global-search-service|globalSearchService/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/supabase["']/);
    expect(source).not.toMatch(/\bsupabase\b/);
    expect(source).not.toMatch(/\.from\(|\.rpc\(/);
  });
});
