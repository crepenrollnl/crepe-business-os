/**
 * Global Search domain contracts (DEV-046).
 *
 * Read path: global_search SQL view.
 * Matching is performed in SQL via ILIKE on search_text.
 */

export const GLOBAL_SEARCH_ENTITY_TYPES = [
  "ingredient",
  "finished_good",
  "recipe",
  "customer",
  "supplier",
  "sale",
  "purchase",
] as const;

export type GlobalSearchEntityType =
  (typeof GLOBAL_SEARCH_ENTITY_TYPES)[number];

/**
 * Mapped row from global_search for service consumers.
 * search_text is not exposed — matching stays in SQL.
 */
export interface SearchResult {
  entityType: GlobalSearchEntityType;
  entityId: string;
  code: string | null;
  title: string;
  subtitle: string | null;
  status: string | null;
}

export type { ServiceResult } from "@/types/service";
