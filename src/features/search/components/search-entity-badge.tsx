import type { GlobalSearchEntityType } from "../types/search";

type SearchEntityBadgeProps = {
  entityType: GlobalSearchEntityType;
};

const ENTITY_LABELS: Record<GlobalSearchEntityType, string> = {
  ingredient: "Ingredient",
  finished_good: "Finished Good",
  recipe: "Recipe",
  customer: "Customer",
  supplier: "Supplier",
  sale: "Sale",
  purchase: "Purchase",
};

const ENTITY_BADGE_CLASS: Record<GlobalSearchEntityType, string> = {
  ingredient: "bg-amber-100 text-amber-800",
  finished_good: "bg-emerald-100 text-emerald-800",
  recipe: "bg-sky-100 text-sky-800",
  customer: "bg-violet-100 text-violet-800",
  supplier: "bg-orange-100 text-orange-800",
  sale: "bg-blue-100 text-blue-800",
  purchase: "bg-teal-100 text-teal-800",
};

/**
 * Presentational entity-type badge for search results.
 */
export function SearchEntityBadge({ entityType }: SearchEntityBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${ENTITY_BADGE_CLASS[entityType]}`}
    >
      <span aria-hidden="true" className="font-semibold">
        {ENTITY_LABELS[entityType].charAt(0)}
      </span>
      {ENTITY_LABELS[entityType]}
    </span>
  );
}
