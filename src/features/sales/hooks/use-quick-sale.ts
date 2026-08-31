"use client";

import { useCallback, useMemo, useState } from "react";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { recipeService } from "@/features/recipes/services/recipe-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { calculateMoneyLineTotal, roundMoney } from "@/lib/money";
import { salesReadService } from "../services/sales-read-service";
import { salesService } from "../services/sales-service";
import type { QuickSaleLineInput, SaleDiscountType } from "../types/sale";
import {
  parseDiscountInput,
  resolveSaleHeaderDiscount,
} from "../utils/quick-sale-discount";
import {
  sortByProductName,
  sortBySoldQuantity,
} from "../utils/sort-by-sold-quantity";

/** A tappable Quick Sale tile: an active assembly recipe with a price set. */
export interface QuickSaleProduct {
  id: string;
  name: string;
  selling_price: number;
  image_url: string | null;
}

export interface QuickSaleCartLine {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

async function fetchQuickSaleProducts(): Promise<{
  data: QuickSaleProduct[];
  error: string | null;
}> {
  // Same recipe list already used by /sales' draft-sale product picker
  // (sale-detail-page.tsx) -- no new service, just a stricter filter:
  // only priced products can be tapped without a manual price entry step.
  const [recipesResult, qtyResult] = await Promise.all([
    recipeService.getRecipes(),
    salesReadService.getSoldQuantityByProductId(),
  ]);

  if (recipesResult.error || !recipesResult.data) {
    return { data: [], error: recipesResult.error };
  }

  const products = recipesResult.data
    .filter(
      (recipe) =>
        recipe.is_active &&
        recipe.recipe_role === "assembly" &&
        recipe.selling_price !== null,
    )
    .map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      selling_price: recipe.selling_price as number,
      image_url: recipe.image_url,
    }));

  if (qtyResult.error || !qtyResult.data) {
    return { data: sortByProductName(products), error: null };
  }

  return { data: sortBySoldQuantity(products, qtyResult.data), error: null };
}

export function useQuickSale() {
  const [products, setProducts] = useState<QuickSaleProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, QuickSaleCartLine>>({});
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [postingError, setPostingError] = useState<string | null>(null);
  const [lastConfirmedSaleNumber, setLastConfirmedSaleNumber] = useState<
    string | null
  >(null);
  const [sendToQueue, setSendToQueue] = useState(false);
  const [kitchenNote, setKitchenNote] = useState("");
  const [discountType, setDiscountType] =
    useState<SaleDiscountType>("percent");
  const [discountInput, setDiscountInput] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const result = await fetchQuickSaleProducts();
    setProducts(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useAsyncEffect(loadProducts, [loadProducts]);

  const addToCart = useCallback((product: QuickSaleProduct) => {
    setActionError(null);
    setLastConfirmedSaleNumber(null);

    // Unit price is frozen from the product at the moment it's tapped, not
    // re-read at confirm time -- matches the approved plan ("unit_price =
    // selling_price на момент добавления").
    setCart((current) => {
      const existing = current[product.id];

      return {
        ...current,
        [product.id]: existing
          ? { ...existing, quantity: existing.quantity + 1 }
          : {
              product_id: product.id,
              name: product.name,
              unit_price: product.selling_price,
              quantity: 1,
            },
      };
    });
  }, []);

  const incrementLine = useCallback((productId: string) => {
    setCart((current) => {
      const existing = current[productId];

      if (!existing) {
        return current;
      }

      return {
        ...current,
        [productId]: { ...existing, quantity: existing.quantity + 1 },
      };
    });
  }, []);

  const decrementLine = useCallback((productId: string) => {
    setCart((current) => {
      const existing = current[productId];

      if (!existing) {
        return current;
      }

      if (existing.quantity <= 1) {
        const next = { ...current };
        delete next[productId];
        return next;
      }

      return {
        ...current,
        [productId]: { ...existing, quantity: existing.quantity - 1 },
      };
    });
  }, []);

  const cartLines = useMemo(
    () =>
      Object.values(cart).sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [cart],
  );

  const itemsTotal = useMemo(
    () =>
      roundMoney(
        cartLines.reduce(
          (sum, line) =>
            sum + calculateMoneyLineTotal(line.quantity, line.unit_price),
          0,
        ),
      ),
    [cartLines],
  );

  const discountValue = useMemo(
    () => parseDiscountInput(discountInput),
    [discountInput],
  );

  const discountPreview = useMemo(
    () =>
      resolveSaleHeaderDiscount({
        catalogGross: itemsTotal,
        type: discountType,
        value: discountValue,
      }),
    [itemsTotal, discountType, discountValue],
  );

  const confirm = useCallback(async () => {
    if (cartLines.length === 0) {
      return false;
    }

    if (discountPreview.error) {
      setActionError(discountPreview.error);
      return false;
    }

    setConfirming(true);
    setActionError(null);
    setPostingError(null);

    const lines: QuickSaleLineInput[] = cartLines.map((line) => ({
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
    }));

    // Same accounting-context fallback pattern as use-sale.ts's confirm():
    // posting is best-effort and never blocks the sale itself.
    const contextResult =
      await accountingContextService.getCurrentAccountingContext();

    if (contextResult.error || !contextResult.data) {
      const fallback = await salesService.createAndConfirmSale({
        lines,
        kitchen_note: kitchenNote,
        discount_type: discountValue === null ? null : discountType,
        discount_value: discountValue,
      });

      if (fallback.error || !fallback.data) {
        setActionError(fallback.error ?? "Failed to confirm sale");
        setConfirming(false);
        return false;
      }

      setLastConfirmedSaleNumber(fallback.data.sale.sale_number);
      setPostingError(
        contextResult.error ?? "Accounting posting was skipped.",
      );

      if (sendToQueue) {
        const queued = await salesService.markSaleQueued(fallback.data.sale.id);
        if (queued.error) {
          setPostingError(queued.error);
        }
      }
    } else {
      const posted = await salesService.createAndConfirmSaleAndPostJournals(
        {
          lines,
          kitchen_note: kitchenNote,
          discount_type: discountValue === null ? null : discountType,
          discount_value: discountValue,
        },
        contextResult.data,
      );

      if (posted.error || !posted.data) {
        setActionError(posted.error ?? "Failed to confirm sale");
        setConfirming(false);
        return false;
      }

      setLastConfirmedSaleNumber(posted.data.sale.sale_number);
      setPostingError(posted.data.postingError);

      if (sendToQueue) {
        const queued = await salesService.markSaleQueued(posted.data.sale.id);
        if (queued.error) {
          setPostingError(posted.data.postingError ?? queued.error);
        }
      }
    }

    setCart({});
    setSendToQueue(false);
    setKitchenNote("");
    setDiscountType("percent");
    setDiscountInput("");
    setConfirming(false);
    return true;
  }, [
    cartLines,
    sendToQueue,
    kitchenNote,
    discountPreview.error,
    discountType,
    discountValue,
  ]);

  return {
    products,
    loading,
    error,
    cartLines,
    itemsTotal,
    discountType,
    setDiscountType,
    discountInput,
    setDiscountInput,
    discountAmount: discountPreview.discountAmount,
    payable: discountPreview.payable,
    discountError: discountPreview.error,
    confirming,
    actionError,
    postingError,
    lastConfirmedSaleNumber,
    sendToQueue,
    kitchenNote,
    addToCart,
    incrementLine,
    decrementLine,
    setSendToQueue,
    setKitchenNote,
    confirm,
    retry: loadProducts,
  };
}
