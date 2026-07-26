import { SALE_STATUSES, type SaleStatus } from "../types/sale";

type StatusFilterProps = {
  value: SaleStatus | "";
  onChange: (value: SaleStatus | "") => void;
};

const STATUS_OPTIONS: Array<{ value: SaleStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  ...SALE_STATUSES.map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
];

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as SaleStatus | "")}
      className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-44"
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.label} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
