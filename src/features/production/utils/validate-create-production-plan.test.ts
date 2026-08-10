import { describe, expect, it } from "vitest";
import {
  getCreateProductionPlanValidationMessage,
  isCreateProductionPlanInputValid,
  validateCreateProductionPlanInput,
} from "./validate-create-production-plan";

describe("validateCreateProductionPlanInput", () => {
  it("requires name and planned date", () => {
    const errors = validateCreateProductionPlanInput({
      name: "  ",
      planning_date: "",
      notes: "optional",
    });

    expect(errors).toEqual({
      name: "Name is required",
      planning_date: "Planned Date is required",
    });
    expect(
      isCreateProductionPlanInputValid({
        name: "  ",
        planning_date: "",
        notes: "",
      }),
    ).toBe(false);
  });

  it("accepts a valid draft header", () => {
    const input = {
      name: "Saturday Market Prep",
      planning_date: "2026-07-20",
      notes: "",
    };

    expect(validateCreateProductionPlanInput(input)).toEqual({});
    expect(isCreateProductionPlanInputValid(input)).toBe(true);
    expect(getCreateProductionPlanValidationMessage(input)).toBeNull();
  });
});
