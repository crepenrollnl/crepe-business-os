import { SearchBox } from "./search-box";

type RecipesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  onCreateClick: () => void;
};

export function RecipesToolbar({
  search,
  onSearchChange,
  onCreateClick,
}: RecipesToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={onSearchChange} />
      </div>

      <button
        type="button"
        onClick={onCreateClick}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
      >
        + Create Recipe
      </button>
    </div>
  );
}
