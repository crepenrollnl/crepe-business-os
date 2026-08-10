"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProductionPlanModal } from "../components/production-plan-modal";
import { ProductionTable } from "../components/production-table";
import { ProductionToolbar } from "../components/production-toolbar";
import { useProduction } from "../hooks/use-production";

export function ProductionPage() {
  const {
    items,
    totalCount,
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
    isModalOpen,
    initialFormValues,
    isSaving,
    actionError,
    highlightedPlanId,
    openCreateModal,
    openPlan,
    closeModal,
    savePlan,
    retry,
  } = useProduction();

  return (
    <DashboardLayout activePath="/production-planning">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Production Planning
            </h1>
            <p className="mt-2 text-base text-zinc-600 sm:text-lg">
              Plan production, calculate ingredient requirements and prepare
              purchasing.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              disabled
              title="Refresh will be available in a later update"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              New Production Plan
            </button>
          </div>
        </div>

        <ProductionToolbar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />

        <ProductionTable
          items={items}
          totalCount={totalCount}
          hasActiveFilters={hasActiveFilters}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          highlightedPlanId={highlightedPlanId}
          onSort={toggleSort}
          onRetry={retry}
          onCreateClick={openCreateModal}
          onOpen={openPlan}
        />

        <ProductionPlanModal
          key={isModalOpen ? "open" : "closed"}
          isOpen={isModalOpen}
          initialValues={initialFormValues}
          isSaving={isSaving}
          error={actionError}
          onClose={closeModal}
          onSave={savePlan}
        />
      </div>
    </DashboardLayout>
  );
}
