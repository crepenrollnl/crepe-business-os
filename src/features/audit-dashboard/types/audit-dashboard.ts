/**
 * Audit Dashboard domain contracts (DEV-070).
 *
 * Read path: get_audit_dashboard RPC over audit_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_audit_dashboard for service consumers.
 */
export interface AuditDashboard {
  total_audit_events: number;
  events_today: number;
  events_last_7_days: number;
  failed_operations: number;
  user_activity_count: number;
  production_events: number;
  inventory_events: number;
  sales_events: number;
  purchase_events: number;
  last_audit_event_at: string | null;
}

export type { ServiceResult } from "@/types/service";
