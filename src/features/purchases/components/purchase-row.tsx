import type { PurchaseListItem, PurchaseStatus } from "../types/purchase";

type PurchaseRowProps = {
  item: PurchaseListItem;
  onOpen: (item: PurchaseListItem) => void;
};

function formatDate(value: string): string {
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

function getStatusBadgeClass(status: PurchaseStatus): string {
  if (status === "received") {
    return "bg-green-100 text-green-700";
  }

  if (status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  return "bg-amber-100 text-amber-800";
}

function formatStatus(status: PurchaseStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function PurchaseRow({ item, onOpen }: PurchaseRowProps) {
  return (
    <tr className="border-t border-zinc-200 transition-colors hover:bg-zinc-50">
      <td className="px-4 py-4 font-medium text-zinc-900">
        {item.invoice_number ?? "—"}
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {item.supplier?.name ?? "—"}
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {formatDate(item.purchased_at)}
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
      <td className="px-4 py-4 text-right text-zinc-600">{item.item_count}</td>
      <td className="px-4 py-4 text-right font-medium text-zinc-900">
        €{item.total.toFixed(2)}
      </td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          {item.status === "draft" ? "Edit" : "View"}
        </button>
      </td>
    </tr>
  );
}
