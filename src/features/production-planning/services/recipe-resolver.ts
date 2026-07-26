import type { EntityId } from "@/types/erp";

import type { ResolvedRecipeBom } from "../types/recipe";

/**
 * Resolves recipe bill-of-materials for planning calculations.
 *
 * Read-only. Must not mutate recipes, inventory, or create documents.
 *
 * Interface only — no database in this package.
 */
export interface RecipeResolver {
  /**
   * Resolve a recipe BOM by id.
   * Returns null when the recipe does not exist.
   */
  resolve(recipeId: EntityId): ResolvedRecipeBom | null;

  /**
   * Resolve many recipes. Missing ids are omitted from the map.
   */
  resolveMany(
    recipeIds: readonly EntityId[],
  ): ReadonlyMap<EntityId, ResolvedRecipeBom>;
}
