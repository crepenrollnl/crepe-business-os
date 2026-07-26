/**
 * Audit Log read service (DEV-048).
 *
 * Reads exclusively from audit_log.
 * Does NOT mutate data, recalculate events, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { AuditEntityType, AuditEvent } from "../types/audit";
import { AUDIT_ENTITY_TYPES } from "../types/audit";

const AUDIT_LOG_VIEW = "audit_log";

const AUDIT_SELECT =
  "event_id, occurred_at, entity_type, entity_id, action, user_id, summary, metadata";

const DEFAULT_AUDIT_LIMIT = 100;
const MAX_AUDIT_LIMIT = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuditLogSqlRow {
  event_id: string;
  occurred_at: string;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: string | null;
  summary: string;
  metadata: unknown;
}

function isEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

function mapMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function mapAuditRow(row: AuditLogSqlRow): AuditEvent {
  if (!isEntityType(row.entity_type)) {
    throw new Error("Audit entity type is invalid.");
  }

  return {
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    userId: row.user_id,
    summary: row.summary,
    metadata: mapMetadata(row.metadata),
  };
}

function resolveLimit(
  limit: number | undefined,
): { limit: number } | { error: string } {
  const resolved =
    limit === undefined || limit === null ? DEFAULT_AUDIT_LIMIT : limit;

  if (
    !Number.isFinite(resolved) ||
    !Number.isInteger(resolved) ||
    resolved < 1
  ) {
    return { error: "Audit log limit must be a positive integer." };
  }

  if (resolved > MAX_AUDIT_LIMIT) {
    return {
      error: `Audit log limit must be ${MAX_AUDIT_LIMIT} or fewer.`,
    };
  }

  return { limit: resolved };
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
        normalized.includes("audit_log") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Audit log is not available yet. Apply the audit log database script and try again.";
      }

      return null;
    },
  });
}

export const auditLogService = {
  /**
   * List recent audit events from audit_log.
   * Default limit is 100. Ordered by occurred_at DESC.
   */
  async getAuditLog(limit?: number): Promise<ServiceResult<AuditEvent[]>> {
    try {
      const resolved = resolveLimit(limit);
      if ("error" in resolved) {
        return fail(resolved.error);
      }

      const { data, error } = await supabase
        .from(AUDIT_LOG_VIEW)
        .select(AUDIT_SELECT)
        .order("occurred_at", { ascending: false })
        .order("event_id", { ascending: true })
        .limit(resolved.limit);

      if (error) {
        return fail(mapReadError(error, "Failed to load audit log"));
      }

      try {
        return ok(
          ((data as AuditLogSqlRow[] | null) ?? []).map(mapAuditRow),
        );
      } catch {
        return fail("Audit log response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load audit log"));
    }
  },

  /**
   * List audit events for one entity from audit_log.
   * Ordered by occurred_at DESC.
   */
  async getEntityHistory(
    entityType: string,
    entityId: string,
  ): Promise<ServiceResult<AuditEvent[]>> {
    try {
      const trimmedType = entityType?.trim() ?? "";
      if (!trimmedType || !isEntityType(trimmedType)) {
        return fail("Entity type is required.");
      }

      const trimmedId = entityId?.trim() ?? "";
      if (!trimmedId || !UUID_RE.test(trimmedId)) {
        return fail("Entity id is required.");
      }

      const { data, error } = await supabase
        .from(AUDIT_LOG_VIEW)
        .select(AUDIT_SELECT)
        .eq("entity_type", trimmedType)
        .eq("entity_id", trimmedId)
        .order("occurred_at", { ascending: false })
        .order("event_id", { ascending: true });

      if (error) {
        return fail(mapReadError(error, "Failed to load entity history"));
      }

      try {
        return ok(
          ((data as AuditLogSqlRow[] | null) ?? []).map(mapAuditRow),
        );
      } catch {
        return fail("Entity history response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load entity history"));
    }
  },
};
