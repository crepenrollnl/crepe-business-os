import type { EntityId } from "@/types/erp";

import type { ShoppingList } from "../shopping-list/types";
import type {
  PlanValidationIssue,
  ValidationResult,
} from "../types/validation";
import { validationFail, validationOk } from "../types/validation";
import type { IngredientPackagingInfo } from "./types";

function isInvalidQuantity(value: number): boolean {
  return !Number.isFinite(value);
}

function isInvalidShoppingListShape(shoppingList: ShoppingList): boolean {
  if (shoppingList == null || typeof shoppingList !== "object") {
    return true;
  }
  if (!Array.isArray(shoppingList.items)) {
    return true;
  }
  if (shoppingList.summary == null || typeof shoppingList.summary !== "object") {
    return true;
  }
  return false;
}

/**
 * Validate a ShoppingList (and optional packaging metadata) before
 * procurement recommendation generation.
 *
 * Checks:
 * - invalid / malformed Shopping List
 * - duplicate ingredients on the shopping list
 * - invalid / zero / negative package sizes
 * - duplicate packaging entries for the same ingredient
 * - non-finite or negative shortage quantities
 *
 * Never mutates inputs. Never throws for validation failures.
 */
export function validateShoppingListForProcurement(
  shoppingList: ShoppingList,
  packaging: readonly IngredientPackagingInfo[] = [],
): ValidationResult {
  if (isInvalidShoppingListShape(shoppingList)) {
    return validationFail([
      {
        code: "invalid_shopping_list",
        message: "Shopping list is missing or malformed.",
        field: "shoppingList",
      },
    ]);
  }

  const issues: PlanValidationIssue[] = [];
  const seenIngredients = new Map<EntityId, number>();
  const items = shoppingList.items;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const fieldPrefix = `items[${index}]`;

    if (
      item == null ||
      typeof item !== "object" ||
      typeof item.ingredientId !== "string" ||
      item.ingredientId.length === 0 ||
      typeof item.unit !== "string" ||
      typeof item.ingredientName !== "string"
    ) {
      issues.push({
        code: "invalid_shopping_list",
        message: "Shopping list item is invalid.",
        field: fieldPrefix,
        ingredientId:
          item &&
          typeof item === "object" &&
          typeof (item as { ingredientId?: unknown }).ingredientId === "string"
            ? (item as { ingredientId: EntityId }).ingredientId
            : undefined,
      });
      continue;
    }

    const previousIndex = seenIngredients.get(item.ingredientId);
    if (previousIndex !== undefined) {
      issues.push({
        code: "duplicate_ingredient",
        message:
          "Shopping list must not contain duplicate ingredient entries.",
        field: `${fieldPrefix}.ingredientId`,
        ingredientId: item.ingredientId,
      });
    } else {
      seenIngredients.set(item.ingredientId, index);
    }

    if (isInvalidQuantity(item.shortageQuantity)) {
      issues.push({
        code: "invalid_shopping_list",
        message: "Shortage quantity must be a finite number.",
        field: `${fieldPrefix}.shortageQuantity`,
        ingredientId: item.ingredientId,
      });
    } else if (item.shortageQuantity < 0) {
      issues.push({
        code: "negative_shortage",
        message: "Shortage quantity cannot be negative.",
        field: `${fieldPrefix}.shortageQuantity`,
        ingredientId: item.ingredientId,
      });
    } else if (item.shortageQuantity === 0) {
      issues.push({
        code: "invalid_shopping_list",
        message:
          "Shopping list must not contain zero-shortage items.",
        field: `${fieldPrefix}.shortageQuantity`,
        ingredientId: item.ingredientId,
      });
    }
  }

  const seenPackaging = new Map<EntityId, number>();

  for (let index = 0; index < packaging.length; index += 1) {
    const entry = packaging[index];
    const fieldPrefix = `packaging[${index}]`;

    if (
      entry == null ||
      typeof entry !== "object" ||
      typeof entry.ingredientId !== "string" ||
      entry.ingredientId.length === 0
    ) {
      issues.push({
        code: "invalid_package_size",
        message: "Packaging entry is missing a valid ingredient id.",
        field: fieldPrefix,
      });
      continue;
    }

    const previousPackagingIndex = seenPackaging.get(entry.ingredientId);
    if (previousPackagingIndex !== undefined) {
      issues.push({
        code: "duplicate_ingredient",
        message:
          "Packaging metadata must not contain duplicate ingredient entries.",
        field: `${fieldPrefix}.ingredientId`,
        ingredientId: entry.ingredientId,
      });
    } else {
      seenPackaging.set(entry.ingredientId, index);
    }

    if (entry.packageSize === undefined) {
      continue;
    }

    if (isInvalidQuantity(entry.packageSize)) {
      issues.push({
        code: "invalid_package_size",
        message: "Package size must be a finite number.",
        field: `${fieldPrefix}.packageSize`,
        ingredientId: entry.ingredientId,
      });
    } else if (entry.packageSize === 0) {
      issues.push({
        code: "zero_package_size",
        message: "Package size cannot be zero.",
        field: `${fieldPrefix}.packageSize`,
        ingredientId: entry.ingredientId,
      });
    } else if (entry.packageSize < 0) {
      issues.push({
        code: "negative_package_size",
        message: "Package size cannot be negative.",
        field: `${fieldPrefix}.packageSize`,
        ingredientId: entry.ingredientId,
      });
    }
  }

  if (issues.length === 0) {
    return validationOk();
  }

  return validationFail(issues);
}
