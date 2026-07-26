/**
 * Notifications read service (DEV-050).
 *
 * Reads exclusively from notifications.
 * Does NOT mutate data, recalculate alerts/events, cache, or write tables.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  Notification,
  NotificationEntityType,
  NotificationSeverity,
  NotificationType,
} from "../types/notification";
import {
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
} from "../types/notification";

const NOTIFICATIONS_VIEW = "notifications";

const NOTIFICATIONS_SELECT =
  "id, notification_type, severity, title, message, entity_type, entity_id, created_at, is_read";

const DEFAULT_NOTIFICATIONS_LIMIT = 50;
const MAX_NOTIFICATIONS_LIMIT = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface NotificationSqlRow {
  id: string;
  notification_type: string;
  severity: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  is_read: boolean;
}

function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

function isNotificationSeverity(
  value: string,
): value is NotificationSeverity {
  return (NOTIFICATION_SEVERITIES as readonly string[]).includes(value);
}

function isEntityType(value: string): value is NotificationEntityType {
  return (NOTIFICATION_ENTITY_TYPES as readonly string[]).includes(value);
}

function mapNotificationRow(row: NotificationSqlRow): Notification {
  if (!isNotificationType(row.notification_type)) {
    throw new Error("Notification type is invalid.");
  }

  if (!isNotificationSeverity(row.severity)) {
    throw new Error("Notification severity is invalid.");
  }

  if (!isEntityType(row.entity_type)) {
    throw new Error("Notification entity type is invalid.");
  }

  return {
    id: row.id,
    notificationType: row.notification_type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
    isRead: row.is_read,
  };
}

function resolveLimit(
  limit: number | undefined,
): { limit: number } | { error: string } {
  const resolved =
    limit === undefined || limit === null
      ? DEFAULT_NOTIFICATIONS_LIMIT
      : limit;

  if (
    !Number.isFinite(resolved) ||
    !Number.isInteger(resolved) ||
    resolved < 1
  ) {
    return { error: "Notifications limit must be a positive integer." };
  }

  if (resolved > MAX_NOTIFICATIONS_LIMIT) {
    return {
      error: `Notifications limit must be ${MAX_NOTIFICATIONS_LIMIT} or fewer.`,
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
        normalized.includes("notifications") &&
        (normalized.includes("does not exist") ||
          normalized.includes("schema cache") ||
          normalized.includes("42p01"))
      ) {
        return "Notifications are not available yet. Apply the notifications database script and try again.";
      }

      return null;
    },
  });
}

export const notificationService = {
  /**
   * List recent notifications from notifications.
   * Default limit is 50. Ordered by created_at DESC.
   */
  async getNotifications(
    limit?: number,
  ): Promise<ServiceResult<Notification[]>> {
    try {
      const resolved = resolveLimit(limit);
      if ("error" in resolved) {
        return fail(resolved.error);
      }

      const { data, error } = await supabase
        .from(NOTIFICATIONS_VIEW)
        .select(NOTIFICATIONS_SELECT)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .limit(resolved.limit);

      if (error) {
        return fail(mapReadError(error, "Failed to load notifications"));
      }

      try {
        return ok(
          ((data as NotificationSqlRow[] | null) ?? []).map(
            mapNotificationRow,
          ),
        );
      } catch {
        return fail("Notifications response was invalid.");
      }
    } catch (error) {
      return fail(mapReadError(error, "Failed to load notifications"));
    }
  },

  /**
   * List notifications for one entity from notifications.
   * Ordered by created_at DESC.
   */
  async getNotificationsByEntity(
    entityType: string,
    entityId: string,
  ): Promise<ServiceResult<Notification[]>> {
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
        .from(NOTIFICATIONS_VIEW)
        .select(NOTIFICATIONS_SELECT)
        .eq("entity_type", trimmedType)
        .eq("entity_id", trimmedId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true });

      if (error) {
        return fail(
          mapReadError(error, "Failed to load entity notifications"),
        );
      }

      try {
        return ok(
          ((data as NotificationSqlRow[] | null) ?? []).map(
            mapNotificationRow,
          ),
        );
      } catch {
        return fail("Entity notifications response was invalid.");
      }
    } catch (error) {
      return fail(
        mapReadError(error, "Failed to load entity notifications"),
      );
    }
  },
};
