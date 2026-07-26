import type { SaleStatus } from "../types/sale";

export function formatSaleDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatSaleDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSaleMoney(value: number): string {
  return `€${value.toFixed(2)}`;
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
