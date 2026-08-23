"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { FinishedGoodsTable } from "../components/finished-goods-table";
import { FinishedGoodsToolbar } from "../components/finished-goods-toolbar";
import { useFinishedGoods } from "../hooks/use-finished-goods";

type FinishedGoodsPageProps = {
  /** Skip DashboardLayout when composed under Inventory workspace tabs. */
  embedded?: boolean;
};

export function FinishedGoodsPage({
  embedded = false,
}: FinishedGoodsPageProps) {
  const {
    items,
    totalCount,
    filteredCount,
    hasActiveFilters,
    loading,
    error,
    search,
    setSearch,
    sortField,
    sortDirection,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    retry,
  } = useFinishedGoods();

  const content = (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          Finished Goods
        </h1>
        <p className="mt-2 text-base text-zinc-600 sm:text-lg">
          Remaining produced goods and components. Quantities are calculated
          from production batches minus sales — not a second inventory ledger.
        </p>
      </div>

      <FinishedGoodsToolbar search={search} onSearchChange={setSearch} />

      <FinishedGoodsTable
        items={items}
        totalCount={totalCount}
        filteredCount={filteredCount}
        hasActiveFilters={hasActiveFilters}
        loading={loading}
        error={error}
        sortField={sortField}
        sortDirection={sortDirection}
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        onSort={toggleSort}
        onRetry={retry}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <DashboardLayout activePath="/inventory">{content}</DashboardLayout>
  );
}
