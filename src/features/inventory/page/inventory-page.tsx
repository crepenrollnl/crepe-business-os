"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DeleteDialog } from "../components/delete-dialog";
import { IngredientModal } from "../components/ingredient-modal";
import { InventoryTable } from "../components/inventory-table";
import { InventoryToolbar } from "../components/inventory-toolbar";
import { LowStockAlertsPanel } from "../components/low-stock-alerts-panel";
import { PurchasingReviewInfo } from "../components/purchasing-review-info";
import { useInventory } from "../hooks/use-inventory";

export function InventoryPage() {
  const {
    items,
    totalCount,
    hasActiveFilters,
    purchasingReviews,
    purchasingReviewMessages,
    lowStockAlerts,
    categories,
    suppliers,
    loading,
    error,
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingItem,
    deleteTarget,
    isSaving,
    isDeleting,
    actionError,
    openCreateModal,
    openEditModal,
    closeModal,
    openDeleteDialog,
    closeDeleteDialog,
    saveIngredient,
    deleteIngredient,
    retry,
  } = useInventory();

  return (
    <DashboardLayout activePath="/inventory">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Inventory
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Purchasing review for ingredients — forecast, recommendations, and
            supplier history. Informational only.
          </p>
        </div>

        <InventoryToolbar
          search={search}
          onSearchChange={setSearch}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          categories={categories}
          onAddClick={openCreateModal}
        />

        {!loading && !error ? (
          <>
            <PurchasingReviewInfo messages={purchasingReviewMessages} />
            <LowStockAlertsPanel alerts={lowStockAlerts} />
          </>
        ) : null}

        <InventoryTable
          items={items}
          purchasingReviews={purchasingReviews}
          totalCount={totalCount}
          hasActiveFilters={hasActiveFilters}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={toggleSort}
          onRetry={retry}
          onAddClick={openCreateModal}
          onEdit={openEditModal}
          onDelete={openDeleteDialog}
        />

        <IngredientModal
          isOpen={isModalOpen}
          item={editingItem}
          categories={categories}
          suppliers={suppliers}
          isSaving={isSaving}
          error={actionError}
          onClose={closeModal}
          onSave={saveIngredient}
        />

        <DeleteDialog
          item={deleteTarget}
          isDeleting={isDeleting}
          error={actionError}
          onClose={closeDeleteDialog}
          onConfirm={deleteIngredient}
        />
      </div>
    </DashboardLayout>
  );
}
