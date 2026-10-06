"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PurchaseDocumentModal } from "../components/purchase-document-modal";
import { PurchasesTable } from "../components/purchases-table";
import { PurchasesToolbar } from "../components/purchases-toolbar";
import { useCanManagePurchaseReceipts } from "../hooks/use-can-manage-purchase-receipts";
import { usePurchases } from "../hooks/use-purchases";
import { useUnassignedReceiptCount } from "../hooks/use-purchase-receipts";

export function PurchasesPage() {
  const {
    items,
    totalCount,
    hasActiveFilters,
    suppliers,
    ingredients,
    loading,
    error,
    search,
    setSearch,
    supplierFilter,
    setSupplierFilter,
    statusFilter,
    setStatusFilter,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingPurchase,
    initialFormValues,
    isLoadingPurchase,
    isSaving,
    actionError,
    postingError,
    accountingPreview,
    openCreateModal,
    openPurchaseModal,
    closeModal,
    saveDraft,
    receiveGoods,
    retry,
  } = usePurchases();
  const access = useCanManagePurchaseReceipts();
  const showReceipts = access.status === "allowed";
  const { count: unassignedCount, refresh: refreshUnassignedCount } =
    useUnassignedReceiptCount(showReceipts);

  return (
    <DashboardLayout activePath="/purchases">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Purchases
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Record supplier purchases and receive goods into inventory stock.
          </p>
        </div>

        <PurchasesToolbar
          search={search}
          onSearchChange={setSearch}
          supplierFilter={supplierFilter}
          onSupplierFilterChange={setSupplierFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          suppliers={suppliers}
          onCreateClick={openCreateModal}
          showReceipts={showReceipts}
          unassignedCount={unassignedCount}
        />

        <PurchasesTable
          items={items}
          totalCount={totalCount}
          hasActiveFilters={hasActiveFilters}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={toggleSort}
          onRetry={retry}
          onCreateClick={openCreateModal}
          onOpen={(item) => void openPurchaseModal(item)}
        />

        <PurchaseDocumentModal
          isOpen={isModalOpen}
          purchase={editingPurchase}
          initialValues={initialFormValues}
          suppliers={suppliers}
          ingredients={ingredients}
          isLoading={isLoadingPurchase}
          isSaving={isSaving}
          error={actionError}
          accountingPreview={accountingPreview}
          postingError={postingError}
          onClose={() => {
            closeModal();
            void refreshUnassignedCount();
          }}
          onSaveDraft={saveDraft}
          onReceiveGoods={receiveGoods}
        />
      </div>
    </DashboardLayout>
  );
}
