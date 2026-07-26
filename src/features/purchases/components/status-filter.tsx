import type { PurchaseStatus } from "../types/purchase";

type StatusFilterProps = {
  value: PurchaseStatus | "";
  onChange: (value: PurchaseStatus | "") => void;
};

const STATUS_OPTIONS: Array<{ value: PurchaseStatus | ""; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <select
      value={value}
      onChange={(event) =>
        onChange(event.target.value as PurchaseStatus | "")
      }
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
