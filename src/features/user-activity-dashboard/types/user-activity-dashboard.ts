/**
 * User Activity Dashboard domain contracts (DEV-071).
 *
 * Read path: get_user_activity_dashboard RPC over user_activity_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_user_activity_dashboard for service consumers.
 */
export interface UserActivityDashboard {
  active_users_today: number;
  active_users_last_7_days: number;
  total_user_actions: number;
  production_actions: number;
  inventory_actions: number;
  purchase_actions: number;
  sales_actions: number;
  last_user_activity_at: string | null;
  most_active_user: string | null;
  average_actions_per_user: number | null;
}

export type { ServiceResult } from "@/types/service";
