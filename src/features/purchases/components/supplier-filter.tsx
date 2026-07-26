import type { PurchaseSupplier } from "../types/purchase";

type SupplierFilterProps = {
  suppliers: PurchaseSupplier[];
  value: string;
  onChange: (value: string) => void;
};

export function SupplierFilter({
  suppliers,
  value,
  onChange,
}: SupplierFilterProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-56"
    >
      <option value="">All suppliers</option>
      {suppliers.map((supplier) => (
        <option key={supplier.id} value={supplier.id}>
          {supplier.name}
        </option>
      ))}
    </select>
  );
}
