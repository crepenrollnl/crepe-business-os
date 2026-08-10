import type { CreateProductionPlanInput } from "../types/production";

export interface CreateProductionPlanFieldErrors {
  name?: string;
  planning_date?: string;
}

/**
 * Shared create-plan validation (UI + service).
 * New plans are header-only drafts: name + planned date required; notes optional.
 */
export function validateCreateProductionPlanInput(
  input: CreateProductionPlanInput,
): CreateProductionPlanFieldErrors {
  const errors: CreateProductionPlanFieldErrors = {};

  if (!input.name.trim()) {
    errors.name = "Name is required";
  }

  if (!input.planning_date.trim()) {
    errors.planning_date = "Planned Date is required";
  }

  return errors;
}

export function getCreateProductionPlanValidationMessage(
  input: CreateProductionPlanInput,
): string | null {
  const errors = validateCreateProductionPlanInput(input);
  return errors.name ?? errors.planning_date ?? null;
}

export function isCreateProductionPlanInputValid(
  input: CreateProductionPlanInput,
): boolean {
  return getCreateProductionPlanValidationMessage(input) === null;
}
