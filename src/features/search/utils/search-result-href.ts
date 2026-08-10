import type { GlobalSearchEntityType } from "../types/search";

/**
 * Map a search hit to an existing app route using only entityType + entityId.
 * No database lookups.
 */
export function getSearchResultHref(
  entityType: GlobalSearchEntityType,
  entityId: string,
): string {
  const id = encodeURIComponent(entityId);

  switch (entityType) {
    case "ingredient":
      return `/inventory?id=${id}`;
    case "finished_good":
      return `/recipes?id=${id}`;
    case "recipe":
      return `/recipes?id=${id}`;
    case "customer":
      return `/sales?customerId=${id}`;
    case "supplier":
      return `/purchases?supplierId=${id}`;
    case "sale":
      return `/sales/${id}`;
    case "purchase":
      return `/purchases?id=${id}`;
  }
}
