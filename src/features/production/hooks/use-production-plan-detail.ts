"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { productionService } from "../services/production-service";
import type {
  AddProductionPlanProductInput,
  ProductionFinishedGoodOption,
  ProductionPlanCalculationResult,
  ProductionPlanProduct,
  ProductionPlanWithRelations,
  UpdateProductionPlanProductQuantityInput,
} from "../types/production";

export function useProductionPlanDetail(planId: string) {
  const router = useRouter();
  const [plan, setPlan] = useState<ProductionPlanWithRelations | null>(null);
  const [finishedGoods, setFinishedGoods] = useState<
    ProductionFinishedGoodOption[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] =
    useState<ProductionPlanProduct | null>(null);
  const [removingProduct, setRemovingProduct] =
    useState<ProductionPlanProduct | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isUpdatingQuantity, setIsUpdatingQuantity] = useState(false);
  const [isRemovingProduct, setIsRemovingProduct] = useState(false);
  const [calculationResult, setCalculationResult] =
    useState<ProductionPlanCalculationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const clearCalculation = useCallback(() => {
    setCalculationResult(null);
    setCalculationError(null);
    setTransferError(null);
  }, []);

  const loadPlan = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const [planResult, optionsResult] = await Promise.all([
        productionService.getProductionPlanById(planId),
        productionService.getRecipeOptions(),
      ]);

      if (planResult.error || !planResult.data) {
        setPlan(null);
        setError(planResult.error ?? "Failed to load production plan");
        setFinishedGoods(optionsResult.data ?? []);
        setLoading(false);
        return;
      }

      setPlan(planResult.data);
      setError(null);
      setFinishedGoods(optionsResult.data ?? []);

      if (optionsResult.error) {
        setActionError(optionsResult.error);
      }

      setLoading(false);
    },
    [planId],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [planResult, optionsResult] = await Promise.all([
        productionService.getProductionPlanById(planId),
        productionService.getRecipeOptions(),
      ]);

      if (cancelled) {
        return;
      }

      if (planResult.error || !planResult.data) {
        setPlan(null);
        setError(planResult.error ?? "Failed to load production plan");
        setFinishedGoods(optionsResult.data ?? []);
        setLoading(false);
        return;
      }

      setPlan(planResult.data);
      setError(null);
      setFinishedGoods(optionsResult.data ?? []);

      if (optionsResult.error) {
        setActionError(optionsResult.error);
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [planId]);

  const openAddModal = useCallback(() => {
    setActionError(null);
    setIsAddModalOpen(true);
  }, []);

  const closeAddModal = useCallback(() => {
    if (isSavingProduct) {
      return;
    }

    setIsAddModalOpen(false);
    setActionError(null);
  }, [isSavingProduct]);

  const openEditQuantity = useCallback((product: ProductionPlanProduct) => {
    setActionError(null);
    setEditingProduct(product);
  }, []);

  const closeEditQuantity = useCallback(() => {
    if (isUpdatingQuantity) {
      return;
    }

    setEditingProduct(null);
    setActionError(null);
  }, [isUpdatingQuantity]);

  const openRemoveProduct = useCallback((product: ProductionPlanProduct) => {
    setActionError(null);
    setRemovingProduct(product);
  }, []);

  const closeRemoveProduct = useCallback(() => {
    if (isRemovingProduct) {
      return;
    }

    setRemovingProduct(null);
    setActionError(null);
  }, [isRemovingProduct]);

  const addProduct = useCallback(
    async (input: AddProductionPlanProductInput) => {
      setIsSavingProduct(true);
      setActionError(null);

      const result = await productionService.addProductToPlan(planId, input);

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to add product to plan");
        setIsSavingProduct(false);
        return false;
      }

      setPlan(result.data);
      clearCalculation();
      setIsAddModalOpen(false);
      setIsSavingProduct(false);
      return true;
    },
    [clearCalculation, planId],
  );

  const updateQuantity = useCallback(
    async (input: UpdateProductionPlanProductQuantityInput) => {
      if (!editingProduct) {
        return false;
      }

      setIsUpdatingQuantity(true);
      setActionError(null);

      const result = await productionService.updatePlanProductQuantity(
        planId,
        editingProduct.id,
        input,
      );

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to update planned quantity");
        setIsUpdatingQuantity(false);
        return false;
      }

      setPlan(result.data);
      clearCalculation();
      setEditingProduct(null);
      setIsUpdatingQuantity(false);
      return true;
    },
    [clearCalculation, editingProduct, planId],
  );

  const removeProduct = useCallback(async () => {
    if (!removingProduct) {
      return false;
    }

    setIsRemovingProduct(true);
    setActionError(null);

    const result = await productionService.removeProductFromPlan(
      planId,
      removingProduct.id,
    );

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to remove product");
      setIsRemovingProduct(false);
      return false;
    }

    setPlan(result.data);
    clearCalculation();
    setRemovingProduct(null);
    setIsRemovingProduct(false);
    return true;
  }, [clearCalculation, planId, removingProduct]);

  const calculateRequirements = useCallback(async () => {
    if (!plan || plan.products.length === 0 || isCalculating) {
      return false;
    }

    setIsCalculating(true);
    setCalculationError(null);
    setTransferError(null);

    const result = await productionService.calculatePlanRequirements(planId);

    if (result.error || !result.data) {
      setCalculationResult(null);
      setCalculationError(
        result.error ?? "Failed to calculate requirements",
      );
      setIsCalculating(false);
      return false;
    }

    setCalculationResult(result.data);
    setCalculationError(null);
    setIsCalculating(false);
    return true;
  }, [isCalculating, plan, planId]);

  const sendToPurchases = useCallback(async () => {
    if (
      !plan ||
      !calculationResult ||
      isTransferring ||
      plan.purchase_draft_status !== "not_created" ||
      plan.linked_purchase
    ) {
      return false;
    }

    if (calculationResult.purchase_draft_review.length === 0) {
      setTransferError(
        "Purchase Draft is empty. All required ingredients are available.",
      );
      return false;
    }

    setIsTransferring(true);
    setTransferError(null);

    const result = await productionService.sendPurchaseDraftToPurchases(
      planId,
      calculationResult.purchase_draft_review.map((line) => ({
        ingredient_id: line.ingredient_id,
        quantity: line.quantity,
      })),
    );

    if (result.error || !result.data) {
      setTransferError(result.error ?? "Failed to send purchase draft");
      setIsTransferring(false);
      return false;
    }

    setPlan(result.data);
    setIsTransferring(false);

    const purchaseId = result.data.linked_purchase?.id;
    if (purchaseId) {
      router.push(`/purchases?open=${purchaseId}`);
    }

    return true;
  }, [calculationResult, isTransferring, plan, planId, router]);

  const availableFinishedGoods = finishedGoods.filter(
    (option) =>
      !plan?.products.some((product) => product.recipe_id === option.id),
  );

  return {
    plan,
    finishedGoods,
    availableFinishedGoods,
    hasFinishedGoodsCatalog: finishedGoods.length > 0,
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
    retry: () => loadPlan(),
  };
}
