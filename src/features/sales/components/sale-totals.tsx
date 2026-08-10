import type { SaleDetail } from "../types/sale";
import { formatSaleMoney } from "../utils/format-sale";

type SaleTotalsProps = {
  sale: SaleDetail;
};

export function SaleTotals({ sale }: SaleTotalsProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:ml-auto sm:max-w-sm">
      <h2 className="text-base font-semibold text-zinc-900">Totals</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-zinc-500">Subtotal</dt>
          <dd className="font-medium text-zinc-800">
            {formatSaleMoney(sale.subtotal)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-zinc-500">Tax</dt>
          <dd className="font-medium text-zinc-800">
            {formatSaleMoney(sale.tax_total)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-3">
          <dt className="font-semibold text-zinc-900">Total</dt>
          <dd className="text-base font-semibold text-zinc-900">
            {formatSaleMoney(sale.total)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
