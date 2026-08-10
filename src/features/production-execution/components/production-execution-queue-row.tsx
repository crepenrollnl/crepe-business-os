import type { ExecutableProductionPlan } from "../types/production-execution";
import {
  formatExecutablePlanStatus,
  formatExecutionDate,
  formatExecutionDateTime,
  getExecutablePlanStatusBadgeClass,
  getLastCalculatedAt,
} from "../utils/format-execution-plan";

type ProductionExecutionQueueRowProps = {
  item: ExecutableProductionPlan;
  onOpen: (item: ExecutableProductionPlan) => void;
};

export function ProductionExecutionQueueRow({
  item,
  onOpen,
}: ProductionExecutionQueueRowProps) {
  return (
    <tr className="border-t border-zinc-200 transition-colors hover:bg-zinc-50">
      <td className="px-4 py-4 font-medium text-zinc-900">{item.name}</td>
      <td className="px-4 py-4 text-zinc-600">
        {formatExecutionDate(item.planning_date)}
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">
        {item.product_count}
      </td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getExecutablePlanStatusBadgeClass(
            item.status,
          )}`}
        >
          {formatExecutablePlanStatus(item.status)}
        </span>
      </td>
      <td className="px-4 py-4 text-zinc-600">
        {formatExecutionDateTime(getLastCalculatedAt(item))}
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
