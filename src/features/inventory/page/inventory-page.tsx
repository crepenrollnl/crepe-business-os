"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { useRole } from "@/hooks/use-role";
import { canSeeCosts } from "@/lib/roles";
import { AdjustStockModal } from "../components/adjust-stock-modal";
import { DeleteDialog } from "../components/delete-dialog";
import { IngredientModal } from "../components/ingredient-modal";
import { IngredientStockLevelsTable } from "../components/ingredient-stock-levels-table";
import { InventoryTable } from "../components/inventory-table";
import { InventoryToolbar } from "../components/inventory-toolbar";
import { LowStockAlertsPanel } from "../components/low-stock-alerts-panel";
import { PurchasingReviewInfo } from "../components/purchasing-review-info";
import { useIngredientStockLevels } from "../hooks/use-ingredient-stock-levels";
import { useInventoryAdjustment } from "../hooks/use-inventory-adjustment";
import { useInventory } from "../hooks/use-inventory";

type InventoryPageProps = {
  /** Skip DashboardLayout when composed under Inventory workspace tabs. */
  embedded?: boolean;
};

/**
 * Inventory for owner/partner, or the seller's quantities-only view
 * (S4/U5). The two are separate components so a seller never runs the
 * owner data load (ingredients with costs, suppliers, stock movements,
 * purchase history) — not even in the background.
 */
export function InventoryPage({ embedded = false }: InventoryPageProps) {
  const { role } = useRole();
  const content = canSeeCosts(role) ? (
    <InventoryManagementContent />
  ) : (
    <IngredientStockLevelsContent />
  );

  if (embedded) {
    return content;
  }

  return (
    <DashboardLayout activePath="/inventory">{content}</DashboardLayout>
  );
}

/** Owner/partner Inventory: prices, suppliers, purchasing review, actions. */
function InventoryManagementContent() {
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
    recipeUsageCount,
    isCheckingRecipeUsage,
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
    refreshAfterAdjustment,
  } = useInventory();
  const {
    canAdjustStock,
    adjustingItem,
    isAdjustModalOpen,
    isAdjusting,
    adjustError,
    openAdjustModal,
    closeAdjustModal,
    submitAdjustment,
  } = useInventoryAdjustment({ onSuccess: refreshAfterAdjustment });

  const content = (
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
        canAdjustStock={canAdjustStock}
        onAdjust={openAdjustModal}
      />

      <IngredientModal
        isOpen={isModalOpen}
        item={editingItem}
        categories={categories}
        suppliers={suppliers}
        isSaving={isSaving}
        error={actionError}
        recipeUsageCount={recipeUsageCount}
        isCheckingRecipeUsage={isCheckingRecipeUsage}
        onClose={closeModal}
        onSave={saveIngredient}
        canAdjustStock={canAdjustStock}
        onAdjust={openAdjustModal}
      />

      <AdjustStockModal
        isOpen={isAdjustModalOpen}
        item={adjustingItem}
        isSaving={isAdjusting}
        error={adjustError}
        onClose={closeAdjustModal}
        onSubmit={submitAdjustment}
      />

      <DeleteDialog
        item={deleteTarget}
        isDeleting={isDeleting}
        error={actionError}
        onClose={closeDeleteDialog}
        onConfirm={deleteIngredient}
      />
    </div>
  );

  return content;
}

/**
 * Seller Inventory: ingredient quantities only, from ingredient_stock_levels
 * (sql/155). No prices, suppliers, purchasing review, low-stock forecast or
 * actions; the row colours show low / out of stock.
 */
function IngredientStockLevelsContent() {
  const {
    items,
    totalCount,
    hasActiveFilters,
    categories,
    loading,
    error,
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    sortField,
    sortDirection,
    toggleSort,
    retry,
  } = useIngredientStockLevels();

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          Inventory
        </h1>
        <p className="mt-2 text-base text-zinc-600 sm:text-lg">
          Current ingredient stock levels.
        </p>
      </div>

      <InventoryToolbar
        search={search}
        onSearchChange={setSearch}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        categories={categories}
      />

      <IngredientStockLevelsTable
        items={items}
        totalCount={totalCount}
        hasActiveFilters={hasActiveFilters}
        loading={loading}
        error={error}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={toggleSort}
        onRetry={() => {
          void retry();
        }}
      />
    </div>
  );
}
