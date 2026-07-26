import type { ProductionPlanStatus } from "../types/production";

type StatusFilterProps = {
  value: ProductionPlanStatus | "";
  onChange: (value: ProductionPlanStatus | "") => void;
};

const STATUS_OPTIONS: Array<{
  value: ProductionPlanStatus | "";
  label: string;
}> = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "planned", label: "Planned" },
  { value: "waiting_for_purchases", label: "Waiting for Purchases" },
  { value: "ready_to_produce", label: "Ready to Produce" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <select
      value={value}
      onChange={(event) =>
        onChange(event.target.value as ProductionPlanStatus | "")
      }
      className="rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option.value || "all"} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
