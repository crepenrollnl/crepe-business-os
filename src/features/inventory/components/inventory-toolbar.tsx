import type { IngredientCategory } from "../types/inventory";
import { CategoryFilter } from "./category-filter";
import { SearchBox } from "./search-box";

type InventoryToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categories: IngredientCategory[];
  onAddClick: () => void;
};

export function InventoryToolbar({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  categories,
  onAddClick,
}: InventoryToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={onSearchChange} />
        <CategoryFilter
          categories={categories}
          value={categoryFilter}
          onChange={onCategoryFilterChange}
        />
      </div>

      <button
        type="button"
        onClick={onAddClick}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
      >
        + Add Ingredient
      </button>
    </div>
  );
}
