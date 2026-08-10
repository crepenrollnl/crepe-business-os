import type {
  AddProductionPlanProductInput,
  UpdateProductionPlanProductQuantityInput,
} from "../types/production";

export interface PlanProductQuantityFieldErrors {
  planned_quantity?: string;
}

export interface AddPlanProductFieldErrors extends PlanProductQuantityFieldErrors {
  recipe_id?: string;
}

/** Form-friendly input before quantity is coerced to a number. */
export interface AddPlanProductFormInput {
  recipe_id: string;
  planned_quantity: number | null;
}

export function validatePlanProductQuantity(
  plannedQuantity: number | null | undefined,
): string | undefined {
  if (
    plannedQuantity === null ||
    plannedQuantity === undefined ||
    Number.isNaN(plannedQuantity)
  ) {
    return "Planned Quantity is required";
  }

  if (plannedQuantity <= 0) {
    return "Planned Quantity must be greater than zero";
  }

  return undefined;
}

export function validateAddPlanProductInput(
  input: AddPlanProductFormInput,
): AddPlanProductFieldErrors {
  const errors: AddPlanProductFieldErrors = {};

  if (!input.recipe_id.trim()) {
    errors.recipe_id = "Select a finished good";
  }

  const quantityError = validatePlanProductQuantity(input.planned_quantity);
  if (quantityError) {
    errors.planned_quantity = quantityError;
  }

  return errors;
}

export function getAddPlanProductValidationMessage(
  input: AddPlanProductFormInput | AddProductionPlanProductInput,
): string | null {
  const errors = validateAddPlanProductInput({
    recipe_id: input.recipe_id,
    planned_quantity: input.planned_quantity,
  });
  return errors.recipe_id ?? errors.planned_quantity ?? null;
}

export function isAddPlanProductInputValid(
  input: AddPlanProductFormInput | AddProductionPlanProductInput,
): boolean {
  return getAddPlanProductValidationMessage(input) === null;
}

export function validateUpdatePlanProductQuantityInput(
  input: {
    planned_quantity: number | null;
  },
): PlanProductQuantityFieldErrors {
  const errors: PlanProductQuantityFieldErrors = {};
  const quantityError = validatePlanProductQuantity(input.planned_quantity);

  if (quantityError) {
    errors.planned_quantity = quantityError;
  }

  return errors;
}

export function getUpdatePlanProductQuantityValidationMessage(
  input: {
    planned_quantity: number | null;
  } | UpdateProductionPlanProductQuantityInput,
): string | null {
  return (
    validateUpdatePlanProductQuantityInput({
      planned_quantity: input.planned_quantity,
    }).planned_quantity ?? null
  );
}

export function isUpdatePlanProductQuantityInputValid(
  input: {
    planned_quantity: number | null;
  } | UpdateProductionPlanProductQuantityInput,
): boolean {
  return getUpdatePlanProductQuantityValidationMessage(input) === null;
}
