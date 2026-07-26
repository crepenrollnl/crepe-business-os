/**
 * Notifications domain contracts (DEV-050).
 *
 * Read path: notifications SQL view.
 * Classification, severity, title, and message come from SQL — never
 * recalculated in TypeScript.
 */

export const NOTIFICATION_TYPES = [
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "NEGATIVE_STOCK",
  "PRODUCTION_COMPLETED",
  "PURCHASE_RECEIVED",
  "SALE_CONFIRMED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "info",
] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_ENTITY_TYPES = [
  "ingredient",
  "production_session",
  "purchase",
  "sale",
] as const;

export type NotificationEntityType =
  (typeof NOTIFICATION_ENTITY_TYPES)[number];

/**
 * Mapped row from notifications for service consumers.
 */
export interface Notification {
  id: string;
  notificationType: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
  createdAt: string;
  isRead: boolean;
}

export type { ServiceResult } from "@/types/service";
