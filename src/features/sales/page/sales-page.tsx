"use client";

import { useRouter } from "next/navigation";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SalesModeToggle } from "../components/sales-mode-toggle";
import { SalesTable } from "../components/sales-table";
import { SalesToolbar } from "../components/sales-toolbar";
import { useSales } from "../hooks/use-sales";
import type { SaleListItem } from "../types/sale";

export function SalesPage() {
  const router = useRouter();
  const {
    items,
    totalCount,
    filteredCount,
    hasActiveFilters,
    loading,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    sortField,
    sortDirection,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    creating,
    actionError,
    createDraft,
    retry,
  } = useSales();

  const openSale = (item: SaleListItem) => {
    router.push(`/sales/${item.sale_id}`);
  };

  const handleCreateDraft = async () => {
    const saleId = await createDraft();
    if (saleId) {
      router.push(`/sales/${saleId}`);
    }
  };

  return (
    <DashboardLayout activePath="/sales">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Sales
            </h1>
            <p className="mt-2 text-base text-zinc-600 sm:text-lg">
              Review customer sales and open documents to confirm draft orders.
            </p>
          </div>

          <SalesModeToggle active="draft" />
        </div>

        <SalesToolbar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          creating={creating}
          onCreateClick={() => {
            void handleCreateDraft();
          }}
        />

        {actionError ? (
          <p className="text-sm text-red-600" role="alert">
            {actionError}
          </p>
        ) : null}

        <SalesTable
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
          onOpen={openSale}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          creating={creating}
          onCreateClick={() => {
            void handleCreateDraft();
          }}
        />
      </div>
    </DashboardLayout>
  );
}
