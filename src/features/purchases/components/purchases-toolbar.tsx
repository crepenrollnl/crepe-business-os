import type { PurchaseStatus, PurchaseSupplier } from "../types/purchase";
import { SearchBox } from "./search-box";
import { StatusFilter } from "./status-filter";
import { SupplierFilter } from "./supplier-filter";

type PurchasesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  supplierFilter: string;
  onSupplierFilterChange: (value: string) => void;
  statusFilter: PurchaseStatus | "";
  onStatusFilterChange: (value: PurchaseStatus | "") => void;
  suppliers: PurchaseSupplier[];
  onCreateClick: () => void;
};

export function PurchasesToolbar({
  search,
  onSearchChange,
  supplierFilter,
  onSupplierFilterChange,
  statusFilter,
  onStatusFilterChange,
  suppliers,
  onCreateClick,
}: PurchasesToolbarProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={onSearchChange} />
        <SupplierFilter
          suppliers={suppliers}
          value={supplierFilter}
          onChange={onSupplierFilterChange}
        />
        <StatusFilter value={statusFilter} onChange={onStatusFilterChange} />
      </div>

      <button
        type="button"
        onClick={onCreateClick}
        className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
      >
        + Create Purchase
      </button>
    </div>
  );
}
