import type { RecipeListItem } from "../types/recipe";

type RecipeRowProps = {
  item: RecipeListItem;
  onView: (item: RecipeListItem) => void;
  onEdit: (item: RecipeListItem) => void;
  onDelete: (item: RecipeListItem) => void;
};

function formatYield(item: RecipeListItem): string {
  return `${item.yield_quantity} ${item.yield_unit}`;
}

function getStatusBadgeClass(isActive: boolean): string {
  if (isActive) {
    return "bg-green-100 text-green-700";
  }

  return "bg-zinc-100 text-zinc-600";
}

export function RecipeRow({ item, onView, onEdit, onDelete }: RecipeRowProps) {
  return (
    <tr className="border-t border-zinc-200 transition-colors hover:bg-zinc-50">
      <td className="px-4 py-4">
        <div className="font-medium text-zinc-900">{item.name}</div>
        {item.description && (
          <p className="mt-1 line-clamp-1 text-sm text-zinc-500">
            {item.description}
          </p>
        )}
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">{item.item_count}</td>
      <td className="px-4 py-4 text-zinc-600">{formatYield(item)}</td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(
            item.is_active,
          )}`}
        >
          {item.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => onView(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            View
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
