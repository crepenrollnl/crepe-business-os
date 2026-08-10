import { formatDate, formatDateTime } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { SaleStatus } from "../types/sale";

export function formatSaleDate(value: string | null | undefined): string {
  return formatDate(value);
}

export function formatSaleDateTime(value: string | null | undefined): string {
  return formatDateTime(value);
}

export function formatSaleMoney(value: number): string {
  return formatMoney(value);
}

export function formatSaleStatus(status: SaleStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function getSaleStatusBadgeClass(status: SaleStatus): string {
  if (status === "confirmed" || status === "paid") {
    return "bg-green-100 text-green-700";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  return "bg-amber-100 text-amber-800";
}

export function formatSaleCustomer(customerId: string | null): string {
  if (!customerId) {
    return "Guest";
  }

  return customerId;
}
