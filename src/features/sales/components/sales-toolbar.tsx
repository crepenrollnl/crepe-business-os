import { SearchBox } from "./search-box";
import { StatusFilter } from "./status-filter";
import type { SaleStatus } from "../types/sale";

type SalesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: SaleStatus | "";
  onStatusFilterChange: (value: SaleStatus | "") => void;
  creating: boolean;
  onCreateClick: () => void;
};

export function SalesToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  creating,
  onCreateClick,
}: SalesToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={onSearchChange} />
        <StatusFilter value={statusFilter} onChange={onStatusFilterChange} />
      </div>

      <button
        type="button"
        onClick={onCreateClick}
        disabled={creating}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {creating ? "Creating..." : "+ New Sale"}
      </button>
    </div>
  );
}
