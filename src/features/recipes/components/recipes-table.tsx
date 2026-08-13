import type {
  RecipeListItem,
  RecipeSortDirection,
  RecipeSortField,
} from "../types/recipe";
import { RecipeRow } from "./recipe-row";

type RecipesTableProps = {
  items: RecipeListItem[];
  totalCount: number;
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  sortField: RecipeSortField;
  sortDirection: RecipeSortDirection;
  onSort: (field: RecipeSortField) => void;
  onRetry: () => void;
  onCreateClick: () => void;
  onView: (item: RecipeListItem) => void;
  onEdit: (item: RecipeListItem) => void;
  onDelete: (item: RecipeListItem) => void;
};

function RecipesTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 5 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function EmptyStateIcon() {
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-7 w-7"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
        />
      </svg>
    </div>
  );
}

type RecipesEmptyStateProps = {
  hasActiveFilters: boolean;
  onCreateClick: () => void;
};

function RecipesEmptyState({
  hasActiveFilters,
  onCreateClick,
}: RecipesEmptyStateProps) {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-16 text-center">
        <div className="mx-auto max-w-sm">
          <EmptyStateIcon />
          <p className="mt-4 text-base font-medium text-zinc-900">
            {hasActiveFilters ? "No matching recipes" : "No recipes yet"}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            {hasActiveFilters
              ? "Try adjusting your search to find what you need."
              : "Create your first recipe to define ingredient bills of materials."}
          </p>
          {!hasActiveFilters && (
            <button
              type="button"
              onClick={onCreateClick}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              + Create Recipe
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type SortableHeaderProps = {
  label: string;
  field: RecipeSortField;
  sortField: RecipeSortField;
  sortDirection: RecipeSortDirection;
  align?: "left" | "right";
  onSort: (field: RecipeSortField) => void;
};

function SortableHeader({
  label,
  field,
  sortField,
  sortDirection,
  align = "left",
  onSort,
}: SortableHeaderProps) {
  const isActive = sortField === field;
  const ariaSort = isActive
    ? sortDirection === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <th
      aria-sort={ariaSort}
      className={`px-4 py-3 text-sm font-semibold text-zinc-700 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-zinc-900" : "text-zinc-700"}`}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className={`text-xs ${isActive ? "text-amber-600" : "text-zinc-400"}`}
        >
          {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function RecipesTable({
  items,
  totalCount,
  hasActiveFilters,
  loading,
  error,
  sortField,
  sortDirection,
  onSort,
  onRetry,
  onCreateClick,
  onView,
  onEdit,
  onDelete,
}: RecipesTableProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load recipes
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <SortableHeader
                label="Recipe"
                field="name"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Ingredients"
                field="item_count"
                sortField={sortField}
                sortDirection={sortDirection}
                align="right"
                onSort={onSort}
              />
              <SortableHeader
                label="Yield"
                field="yield_quantity"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Status
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <RecipesTableSkeleton />
            ) : items.length === 0 ? (
              <RecipesEmptyState
                hasActiveFilters={hasActiveFilters && totalCount > 0}
                onCreateClick={onCreateClick}
              />
            ) : (
              items.map((item) => (
                <RecipeRow
                  key={item.id}
                  item={item}
                  onView={onView}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
