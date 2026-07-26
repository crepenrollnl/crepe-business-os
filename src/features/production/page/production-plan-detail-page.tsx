"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { AddPlanProductModal } from "../components/add-plan-product-modal";
import { EditPlanProductQuantityModal } from "../components/edit-plan-product-quantity-modal";
import { ProductionPlanCalculationWorkspace } from "../components/production-plan-calculation-workspace";
import { ProductionPlanDetailHeader } from "../components/production-plan-detail-header";
import { ProductionPlanProductsSection } from "../components/production-plan-products-section";
import { RemovePlanProductDialog } from "../components/remove-plan-product-dialog";
import { useProductionPlanDetail } from "../hooks/use-production-plan-detail";

type ProductionPlanDetailPageProps = {
  planId: string;
};

export function ProductionPlanDetailPage({
  planId,
}: ProductionPlanDetailPageProps) {
  const {
    plan,
    availableFinishedGoods,
    hasFinishedGoodsCatalog,
    loading,
    error,
    actionError,
    isAddModalOpen,
    editingProduct,
    removingProduct,
    isSavingProduct,
    isUpdatingQuantity,
    isRemovingProduct,
    calculationResult,
    isCalculating,
    calculationError,
    isTransferring,
    transferError,
    openAddModal,
    closeAddModal,
    openEditQuantity,
    closeEditQuantity,
    openRemoveProduct,
    closeRemoveProduct,
    addProduct,
    updateQuantity,
    removeProduct,
    calculateRequirements,
    sendToPurchases,
    retry,
  } = useProductionPlanDetail(planId);

  const canEdit =
    plan !== null &&
    plan.status !== "completed" &&
    plan.status !== "cancelled";

  return (
    <DashboardLayout activePath="/production-planning">
      <div className="mx-auto max-w-7xl space-y-8">
        {loading ? (
          <div className="space-y-6">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
            <div className="h-64 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : error || !plan ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-base font-medium text-red-800">
              Failed to load production plan
            </p>
            <p className="mt-2 text-sm text-red-600">
              {error ?? "Production plan was not found."}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <ProductionPlanDetailHeader
              plan={plan}
              canCalculate={plan.products.length > 0}
              isCalculating={isCalculating}
              onCalculate={() => {
                void calculateRequirements();
              }}
            />

            <ProductionPlanProductsSection
              products={plan.products}
              canEdit={canEdit}
              onAddProduct={openAddModal}
              onEditQuantity={openEditQuantity}
              onRemoveProduct={openRemoveProduct}
            />

            <ProductionPlanCalculationWorkspace
              result={calculationResult}
              isCalculating={isCalculating}
              error={calculationError}
              transferStatus={plan.purchase_draft_status}
              linkedPurchase={plan.linked_purchase}
              isTransferring={isTransferring}
              transferError={transferError}
              transferDisabled={
                !canEdit || plan.purchase_draft_status !== "not_created"
              }
              onSendToPurchases={() => {
                void sendToPurchases();
              }}
            />
          </>
        )}

        <AddPlanProductModal
          isOpen={isAddModalOpen}
          options={availableFinishedGoods}
          hasCatalog={hasFinishedGoodsCatalog}
          isSaving={isSavingProduct}
          error={actionError}
          onClose={closeAddModal}
          onSave={addProduct}
        />

        <EditPlanProductQuantityModal
          key={editingProduct?.id ?? "closed"}
          product={editingProduct}
          isSaving={isUpdatingQuantity}
          error={actionError}
          onClose={closeEditQuantity}
          onSave={updateQuantity}
        />

        <RemovePlanProductDialog
          product={removingProduct}
          isRemoving={isRemovingProduct}
          error={actionError}
          onClose={closeRemoveProduct}
          onConfirm={removeProduct}
        />
      </div>
    </DashboardLayout>
  );
}
