/**
 * Finance module contracts.
 * Payments are defined in shared accounting types; finance owns operational cash views.
 */

import type { Payment } from "@/types/accounting";

export interface CashPosition {
  currency: string;
  available_amount: number;
  pending_inbound: number;
  pending_outbound: number;
  as_of: string;
}

export interface FinanceOverview {
  cash_position: CashPosition;
  recent_payments: Payment[];
}
