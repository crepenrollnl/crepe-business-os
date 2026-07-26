/**
 * Audit Log domain contracts (DEV-048).
 *
 * Read path: audit_log SQL view.
 * Event projection comes from SQL — never recalculated in TypeScript.
 */

export const AUDIT_ENTITY_TYPES = [
  "purchase",
  "production_session",
  "production_batch",
  "sale",
  "customer",
  "supplier",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Mapped row from audit_log for service consumers.
 */
export interface AuditEvent {
  eventId: string;
  occurredAt: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  userId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
}

export type { ServiceResult } from "@/types/service";
