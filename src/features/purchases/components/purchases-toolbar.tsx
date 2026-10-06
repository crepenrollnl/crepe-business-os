import Link from "next/link";
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
  showReceipts?: boolean;
  unassignedCount?: number;
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
  showReceipts = false,
  unassignedCount = 0,
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

      <div className="flex flex-col gap-3 sm:flex-row">
        {showReceipts ? (
          <Link
            href="/purchases/receipts"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-zinc-50"
          >
            Receipts
            {unassignedCount > 0 ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-900 px-1.5 text-xs font-semibold text-white">
                {unassignedCount}
              </span>
            ) : null}
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onCreateClick}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
        >
          + Create Purchase
        </button>
      </div>
    </div>
  );
}
