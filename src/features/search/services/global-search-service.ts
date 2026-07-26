/**
 * Global Search read service (DEV-046).
 *
 * Reads exclusively from global_search.
 * Matching uses SQL ILIKE on search_text — no TypeScript result filtering.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  GlobalSearchEntityType,
  SearchResult,
} from "../types/search";
import { GLOBAL_SEARCH_ENTITY_TYPES } from "../types/search";

const GLOBAL_SEARCH_VIEW = "global_search";

const SEARCH_SELECT =
  "entity_type, entity_id, code, title, subtitle, status";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const MAX_QUERY_LENGTH = 200;

interface GlobalSearchSqlRow {
  entity_type: string;
  entity_id: string;
  code: string | null;
  title: string;
  subtitle: string | null;
  status: string | null;
}

function isEntityType(value: string): value is GlobalSearchEntityType {
  return (GLOBAL_SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Escape ILIKE wildcards so user input is matched literally.
 */
function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function mapSearchRow(row: GlobalSearchSqlRow): SearchResult {
  if (!isEntityType(row.entity_type)) {
    throw new Error("Search entity type is invalid.");
  }

  return {
    entityType: row.entity_type,
    entityId: row.entity_id,
    code: row.code,
    title: row.title,
    subtitle: row.subtitle,
    status: row.status,
  };
}

function validateSearchInput(
  query: string,
  limit: number | undefined,
): { query: string; limit: number } | { error: string } {
  const trimmed = query?.trim() ?? "";

  if (trimmed.length === 0) {
    return { error: "Search query is required." };
  }

  if (trimmed.length > MAX_QUERY_LENGTH) {
    return {
      error: `Search query must be ${MAX_QUERY_LENGTH} characters or fewer.`,
    };
  }

  const resolvedLimit =
    limit === undefined || limit === null ? DEFAULT_SEARCH_LIMIT : limit;

  if (
    !Number.isFinite(resolvedLimit) ||
    !Number.isInteger(resolvedLimit) ||
    resolvedLimit < 1
  ) {
    return { error: "Search limit must be a positive integer." };
  }

  if (resolvedLimit > MAX_SEARCH_LIMIT) {
    return {
      error: `Search limit must be ${MAX_SEARCH_LIMIT} or fewer.`,
    };
  }

  return { query: trimmed, limit: resolvedLimit };
}

function mapReadError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message =
        typeof err === "object" &&
        err !== null &&
        "message" in err &&
        typeof (err as { message: unknown }).message === "string"
          ? (err as { message: string }).message
          : typeof err === "string"
            ? err
            : null;

      if (!message) {
        return null;
      }

      const normalized = message.toLowerCase();

      if (
        normalized.includes("global_search") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Global search is not available yet. Apply the global search database script and try again.";
      }

      return null;
    },
  });
}

export const globalSearchService = {
  /**
   * Search global_search via ILIKE on search_text.
   * Default limit is 20.
   */
  async search(
    query: string,
    limit?: number,
  ): Promise<ServiceResult<SearchResult[]>> {
    try {
      const validated = validateSearchInput(query, limit);
      if ("error" in validated) {
        return fail(validated.error);
      }

      const pattern = `%${escapeIlikePattern(validated.query)}%`;

      const { data, error } = await supabase
        .from(GLOBAL_SEARCH_VIEW)
        .select(SEARCH_SELECT)
        .ilike("search_text", pattern)
        .order("entity_type", { ascending: true })
        .order("title", { ascending: true })
        .order("entity_id", { ascending: true })
        .limit(validated.limit);

      if (error) {
        return fail(mapReadError(error, "Failed to search"));
      }

      try {
        return ok(
          ((data as GlobalSearchSqlRow[] | null) ?? []).map(mapSearchRow),
        );
      } catch {
        return fail("Search response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to search"));
    }
  },
};
