/**
 * Production Dashboard domain contracts (DEV-065).
 *
 * Read path: get_production_dashboard RPC over production_dashboard.
 * Values come from SQL - never recalculated in TypeScript.
 */

/**
 * Mapped row from get_production_dashboard for service consumers.
 * average_batch_duration is seconds from SQL AVG(epoch).
 */
export interface ProductionDashboard {
  total_batches: number;
  completed_batches: number;
  failed_batches: number;
  total_finished_goods: number;
  last_production_date: string | null;
  average_batch_duration: number | null;
}

export type { ServiceResult } from "@/types/service";
