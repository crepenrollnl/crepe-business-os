import type { EntityId } from "@/types/erp";

import {
  isProcurementRecommendationReason,
  type ProcurementRecommendation,
} from "../procurement/types";
import type {
  PlanValidationIssue,
  ValidationResult,
} from "../types/validation";
import { validationFail, validationOk } from "../types/validation";

function isInvalidQuantity(value: number): boolean {
  return !Number.isFinite(value);
}

function isInvalidRecommendationShape(
  recommendation: ProcurementRecommendation,
): boolean {
  if (recommendation == null || typeof recommendation !== "object") {
    return true;
  }
  if (!Array.isArray(recommendation.items)) {
    return true;
  }
  if (
    recommendation.summary == null ||
    typeof recommendation.summary !== "object"
  ) {
    return true;
  }
  return false;
}

/**
 * Validate a ProcurementRecommendation before Purchase Draft generation.
 *
 * Checks:
 * - invalid / malformed recommendation
 * - empty recommendation (no lines to draft)
 * - duplicate ingredients
 * - non-finite / zero / negative purchase quantities
 * - invalid packagesToBuy
 * - invalid recommendation reasons
 *
 * Never mutates inputs. Never throws for validation failures.
 */
export function validateProcurementRecommendationForDraft(
  recommendation: ProcurementRecommendation,
): ValidationResult {
  if (isInvalidRecommendationShape(recommendation)) {
    return validationFail([
      {
        code: "invalid_procurement_recommendation",
        message: "Procurement recommendation is missing or malformed.",
        field: "recommendation",
      },
    ]);
  }

  if (recommendation.items.length === 0) {
    return validationFail([
      {
        code: "empty_procurement_recommendation",
        message:
          "Procurement recommendation must contain at least one item.",
        field: "recommendation.items",
      },
    ]);
  }

  const issues: PlanValidationIssue[] = [];
  const seenIngredients = new Map<EntityId, number>();
  const items = recommendation.items;

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
        code: "invalid_procurement_recommendation",
        message: "Procurement recommendation item is invalid.",
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
          "Procurement recommendation must not contain duplicate ingredient entries.",
        field: `${fieldPrefix}.ingredientId`,
        ingredientId: item.ingredientId,
      });
    } else {
      seenIngredients.set(item.ingredientId, index);
    }

    if (isInvalidQuantity(item.recommendedPurchaseQuantity)) {
      issues.push({
        code: "invalid_quantity",
        message: "Recommended purchase quantity must be a finite number.",
        field: `${fieldPrefix}.recommendedPurchaseQuantity`,
        ingredientId: item.ingredientId,
      });
    } else if (item.recommendedPurchaseQuantity < 0) {
      issues.push({
        code: "negative_quantity",
        message: "Recommended purchase quantity cannot be negative.",
        field: `${fieldPrefix}.recommendedPurchaseQuantity`,
        ingredientId: item.ingredientId,
      });
    } else if (item.recommendedPurchaseQuantity === 0) {
      issues.push({
        code: "zero_quantity",
        message: "Recommended purchase quantity cannot be zero.",
        field: `${fieldPrefix}.recommendedPurchaseQuantity`,
        ingredientId: item.ingredientId,
      });
    }

    if (isInvalidQuantity(item.packagesToBuy)) {
      issues.push({
        code: "invalid_quantity",
        message: "Packages to buy must be a finite number.",
        field: `${fieldPrefix}.packagesToBuy`,
        ingredientId: item.ingredientId,
      });
    } else if (item.packagesToBuy < 0) {
      issues.push({
        code: "negative_quantity",
        message: "Packages to buy cannot be negative.",
        field: `${fieldPrefix}.packagesToBuy`,
        ingredientId: item.ingredientId,
      });
    } else if (item.packagesToBuy === 0) {
      issues.push({
        code: "zero_quantity",
        message: "Packages to buy cannot be zero.",
        field: `${fieldPrefix}.packagesToBuy`,
        ingredientId: item.ingredientId,
      });
    } else if (!Number.isInteger(item.packagesToBuy)) {
      issues.push({
        code: "invalid_quantity",
        message: "Packages to buy must be a whole number.",
        field: `${fieldPrefix}.packagesToBuy`,
        ingredientId: item.ingredientId,
      });
    }

    if (
      typeof item.recommendationReason !== "string" ||
      !isProcurementRecommendationReason(item.recommendationReason)
    ) {
      issues.push({
        code: "invalid_procurement_recommendation",
        message: "Recommendation reason is missing or unrecognized.",
        field: `${fieldPrefix}.recommendationReason`,
        ingredientId: item.ingredientId,
      });
    }

    if (item.packageSize !== undefined) {
      if (isInvalidQuantity(item.packageSize)) {
        issues.push({
          code: "invalid_package_size",
          message: "Package size must be a finite number.",
          field: `${fieldPrefix}.packageSize`,
          ingredientId: item.ingredientId,
        });
      } else if (item.packageSize === 0) {
        issues.push({
          code: "zero_package_size",
          message: "Package size cannot be zero.",
          field: `${fieldPrefix}.packageSize`,
          ingredientId: item.ingredientId,
        });
      } else if (item.packageSize < 0) {
        issues.push({
          code: "negative_package_size",
          message: "Package size cannot be negative.",
          field: `${fieldPrefix}.packageSize`,
          ingredientId: item.ingredientId,
        });
      }
    }
  }

  if (issues.length === 0) {
    return validationOk();
  }

  return validationFail(issues);
}
