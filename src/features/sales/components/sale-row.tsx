import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import type { SaleListItem, SaleStatus } from "../types/sale";

type SaleRowProps = {
  item: SaleListItem;
  onOpen: (item: SaleListItem) => void;
};

function getStatusBadgeClass(status: SaleStatus): string {
  if (status === "confirmed" || status === "paid") {
    return "bg-green-100 text-green-700";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  return "bg-amber-100 text-amber-800";
}

function formatStatus(status: SaleStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCustomer(customerId: string | null): string {
  if (!customerId) {
    return "Guest";
  }

  return customerId;
}

export function SaleRow({ item, onOpen }: SaleRowProps) {
  return (
    <tr className="border-t border-zinc-200 transition-colors hover:bg-zinc-50">
      <td className="px-4 py-4 font-medium text-zinc-900">
        {item.sale_number}
      </td>
      <td className="px-4 py-4 text-zinc-600">{formatDate(item.sale_date)}</td>
      <td className="px-4 py-4 text-zinc-600">
        {formatCustomer(item.customer_id)}
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(
            item.status,
          )}`}
        >
          {formatStatus(item.status)}
        </span>
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">
        {formatMoney(item.subtotal)}
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">
        {formatMoney(item.tax_total)}
      </td>
      <td className="px-4 py-4 text-right font-medium text-zinc-900">
        {formatMoney(item.total)}
      </td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          Open
        </button>
      </td>
    </tr>
  );
}
