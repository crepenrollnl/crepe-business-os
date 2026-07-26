"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { recipeService } from "@/features/recipes/services/recipe-service";
import { ConfirmSaleDialog } from "../components/confirm-sale-dialog";
import { SaleHeader } from "../components/sale-header";
import {
  SaleLinesSection,
  type SaleProductOption,
} from "../components/sale-lines-section";
import { SaleTotals } from "../components/sale-totals";
import { useSale } from "../hooks/use-sale";

type SaleDetailPageProps = {
  saleId: string;
};

function isNotFoundError(error: string | null): boolean {
  if (!error) {
    return false;
  }

  return error.toLowerCase().includes("not found");
}

export function SaleDetailPage({ saleId }: SaleDetailPageProps) {
  const {
    sale,
    loading,
    error,
    confirming,
    mutating,
    actionError,
    addSaleLine,
    updateSaleLine,
    deleteSaleLine,
    confirm,
    retry,
  } = useSale(saleId);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const [products, setProducts] = useState<SaleProductOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await recipeService.getRecipes();

      if (cancelled) {
        return;
      }

      if (result.error || !result.data) {
        setProducts([]);
        return;
      }

      setProducts(
        result.data
          .filter((recipe) => recipe.is_active)
          .map((recipe) => ({
            id: recipe.id,
            name: recipe.name,
          })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = async () => {
    setConfirmAttempted(true);
    const ok = await confirm();
    if (ok) {
      setIsConfirmDialogOpen(false);
      setConfirmAttempted(false);
    }
    return ok;
  };

  const openConfirmDialog = () => {
    setConfirmAttempted(false);
    setIsConfirmDialogOpen(true);
  };

  const canEdit = sale?.status === "draft";
  const canConfirm = Boolean(canEdit && (sale?.lines.length ?? 0) > 0);

  return (
    <DashboardLayout activePath="/sales">
      <div className="mx-auto max-w-7xl space-y-8">
        {loading ? (
          <div className="space-y-6">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
            <div className="h-64 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : error || !sale ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-base font-medium text-red-800">
              {isNotFoundError(error) ? "Sale not found" : "Failed to load sale"}
            </p>
            <p className="mt-2 text-sm text-red-600">
              {error ?? "Sale was not found."}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/sales"
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
              >
                Back to Sales
              </Link>
              {!isNotFoundError(error) ? (
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                >
                  Try again
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <SaleHeader
              sale={sale}
              confirming={confirming}
              mutating={mutating}
              canConfirm={canConfirm}
              actionError={actionError}
              onConfirmClick={openConfirmDialog}
            />

            {mutating ? (
              <p className="text-sm text-zinc-500">Saving sale line changes…</p>
            ) : null}

            {confirming ? (
              <p className="text-sm text-zinc-500">Confirming sale…</p>
            ) : null}

            <SaleLinesSection
              lines={sale.lines}
              products={products}
              canEdit={Boolean(canEdit)}
              mutating={mutating || confirming}
              onAddLine={addSaleLine}
              onUpdateQuantity={updateSaleLine}
              onDeleteLine={deleteSaleLine}
            />
            <SaleTotals sale={sale} />

            {sale.status === "confirmed" || sale.status === "paid" ? (
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800">
                This sale is locked. Line items and commercial totals cannot be
                changed.
              </div>
            ) : null}

            {sale.status === "cancelled" ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-700">
                This sale is cancelled and read-only.
              </div>
            ) : null}

            <ConfirmSaleDialog
              isOpen={isConfirmDialogOpen}
              saleNumber={sale.sale_number}
              confirming={confirming}
              error={confirmAttempted ? actionError : null}
              onClose={() => {
                if (!confirming) {
                  setIsConfirmDialogOpen(false);
                  setConfirmAttempted(false);
                }
              }}
              onConfirm={handleConfirm}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
