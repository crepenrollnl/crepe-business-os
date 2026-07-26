import type { IngredientCategory } from "../types/inventory";

type CategoryFilterProps = {
  categories: IngredientCategory[];
  value: string;
  onChange: (value: string) => void;
};

export function CategoryFilter({
  categories,
  value,
  onChange,
}: CategoryFilterProps) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 sm:w-56"
    >
      <option value="">All categories</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  );
}
