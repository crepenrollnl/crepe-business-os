import { describe, expect, it } from "vitest";
import {
  getAddPlanProductValidationMessage,
  getUpdatePlanProductQuantityValidationMessage,
  isAddPlanProductInputValid,
  isUpdatePlanProductQuantityInputValid,
  validateAddPlanProductInput,
  validatePlanProductQuantity,
} from "./validate-plan-product";

describe("validatePlanProductQuantity", () => {
  it("requires a quantity", () => {
    expect(validatePlanProductQuantity(null)).toBe(
      "Planned Quantity is required",
    );
    expect(validatePlanProductQuantity(undefined)).toBe(
      "Planned Quantity is required",
    );
  });

  it("rejects zero and negative quantities", () => {
    expect(validatePlanProductQuantity(0)).toBe(
      "Planned Quantity must be greater than zero",
    );
    expect(validatePlanProductQuantity(-1)).toBe(
      "Planned Quantity must be greater than zero",
    );
  });

  it("accepts positive quantities", () => {
    expect(validatePlanProductQuantity(1)).toBeUndefined();
    expect(validatePlanProductQuantity(0.5)).toBeUndefined();
  });
});

describe("validateAddPlanProductInput", () => {
  it("requires a finished good selection", () => {
    expect(
      validateAddPlanProductInput({
        recipe_id: "  ",
        planned_quantity: 2,
      }),
    ).toEqual({
      recipe_id: "Select a finished good",
    });
  });

  it("requires planned quantity", () => {
    expect(
      validateAddPlanProductInput({
        recipe_id: "recipe-1",
        planned_quantity: null,
      }),
    ).toEqual({
      planned_quantity: "Planned Quantity is required",
    });
  });

  it("returns null message when valid", () => {
    expect(
      getAddPlanProductValidationMessage({
        recipe_id: "recipe-1",
        planned_quantity: 3,
      }),
    ).toBeNull();
    expect(
      isAddPlanProductInputValid({
        recipe_id: "recipe-1",
        planned_quantity: 3,
      }),
    ).toBe(true);
  });
});

describe("validateUpdatePlanProductQuantityInput", () => {
  it("rejects invalid quantities", () => {
    expect(
      getUpdatePlanProductQuantityValidationMessage({
        planned_quantity: 0,
      }),
    ).toBe("Planned Quantity must be greater than zero");
    expect(
      isUpdatePlanProductQuantityInputValid({
        planned_quantity: 4,
      }),
    ).toBe(true);
  });
});
