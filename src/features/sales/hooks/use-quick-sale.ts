"use client";

import { useCallback, useMemo, useState } from "react";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { recipeService } from "@/features/recipes/services/recipe-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { salesService } from "../services/sales-service";
import type { QuickSaleLineInput } from "../types/sale";

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
  const result = await recipeService.getRecipes();

  if (result.error || !result.data) {
    return { data: [], error: result.error };
  }

  const products = result.data
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
    }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

  return { data: products, error: null };
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

  const subtotal = useMemo(
    () =>
      cartLines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0),
    [cartLines],
  );

  const confirm = useCallback(async () => {
    if (cartLines.length === 0) {
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
        { lines, kitchen_note: kitchenNote },
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
    setConfirming(false);
    return true;
  }, [cartLines, sendToQueue, kitchenNote]);

  return {
    products,
    loading,
    error,
    cartLines,
    subtotal,
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
