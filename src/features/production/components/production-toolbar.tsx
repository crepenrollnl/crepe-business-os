import type { ProductionPlanStatus } from "../types/production";
import { SearchBox } from "./search-box";
import { StatusFilter } from "./status-filter";

type ProductionToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: ProductionPlanStatus | "";
  onStatusFilterChange: (value: ProductionPlanStatus | "") => void;
};

export function ProductionToolbar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: ProductionToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <SearchBox value={search} onChange={onSearchChange} />
      <StatusFilter value={statusFilter} onChange={onStatusFilterChange} />
    </div>
  );
}
