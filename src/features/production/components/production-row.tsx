import type { ProductionPlanListItem } from "../types/production";
import {
  formatProductionPlanDate,
  formatProductionPlanStatus,
  getProductionPlanStatusBadgeClass,
} from "../utils/format-production-plan";

type ProductionRowProps = {
  item: ProductionPlanListItem;
  highlighted?: boolean;
  onOpen: (item: ProductionPlanListItem) => void;
};

export function ProductionRow({
  item,
  highlighted = false,
  onOpen,
}: ProductionRowProps) {
  return (
    <tr
      className={`border-t border-zinc-200 transition-colors hover:bg-zinc-50 ${
        highlighted ? "animate-pulse bg-amber-50" : ""
      }`}
    >
      <td className="px-4 py-4 font-medium text-zinc-900">{item.name}</td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getProductionPlanStatusBadgeClass(
            item.status,
          )}`}
        >
          {formatProductionPlanStatus(item.status)}
        </span>
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {formatProductionPlanDate(item.planning_date)}
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">
        {item.product_count}
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {formatProductionPlanDate(item.created_at)}
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {formatProductionPlanDate(item.updated_at ?? item.created_at)}
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
