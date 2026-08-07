"use client";

import { useState, type FormEvent } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import type {
  ComponentRecipeOption,
  RecipeFormValues,
  RecipeIngredientOption,
  RecipeRole,
  RecipeWithRelations,
  RecipeYieldUnit,
} from "../types/recipe";
import {
  DEFAULT_RECIPE_YIELD_UNIT,
  RECIPE_ROLES,
  RECIPE_YIELD_UNITS,
  isRecipeYieldUnit,
} from "../types/recipe";

type RecipeEditorModalProps = {
  isOpen: boolean;
  recipe: RecipeWithRelations | null;
  initialValues: RecipeFormValues;
  ingredients: RecipeIngredientOption[];
  componentRecipes: ComponentRecipeOption[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (values: RecipeFormValues) => Promise<boolean>;
};

type LineDraft = {
  ingredient_id: string;
  quantity: string;
  unit: string;
};

type ComponentLineDraft = {
  component_recipe_id: string;
  quantity: string;
  unit: string;
};

type FormDraft = {
  name: string;
  description: string;
  yield_quantity: string;
  yield_unit: RecipeYieldUnit;
  is_active: boolean;
  recipe_role: RecipeRole;
  lines: LineDraft[];
  components: ComponentLineDraft[];
};

type FormErrors = {
  name?: string;
  yield_quantity?: string;
  yield_unit?: string;
  lines?: string;
  lineErrors?: Array<{
    ingredient_id?: string;
    quantity?: string;
    unit?: string;
  }>;
  components?: string;
  componentErrors?: Array<{
    component_recipe_id?: string;
    quantity?: string;
    unit?: string;
  }>;
};

const RECIPE_ROLE_LABEL: Record<RecipeRole, string> = {
  component: "Component (a sub-item produced ahead of time, e.g. dough)",
  assembly: "Assembly (a sold dish, built from components at sale time)",
};

function valuesToDraft(values: RecipeFormValues): FormDraft {
  return {
    name: values.name,
    description: values.description,
    yield_quantity: formatNumericInput(values.yield_quantity),
    yield_unit: isRecipeYieldUnit(values.yield_unit)
      ? values.yield_unit
      : DEFAULT_RECIPE_YIELD_UNIT,
    is_active: values.is_active,
    recipe_role: values.recipe_role,
    lines: values.lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: formatNumericInput(line.quantity),
      unit: line.unit,
    })),
    components: values.components.map((component) => ({
      component_recipe_id: component.component_recipe_id,
      quantity: formatNumericInput(component.quantity),
      unit: component.unit,
    })),
  };
}

function draftToValues(draft: FormDraft): RecipeFormValues {
  return {
    name: draft.name,
    description: draft.description,
    yield_quantity: parseNumericInput(draft.yield_quantity),
    yield_unit: draft.yield_unit,
    is_active: draft.is_active,
    recipe_role: draft.recipe_role,
    lines: draft.lines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: parseNumericInput(line.quantity),
      unit: line.unit,
    })),
    components: draft.components.map((component) => ({
      component_recipe_id: component.component_recipe_id,
      quantity: parseNumericInput(component.quantity),
      unit: component.unit,
    })),
  };
}

function validateDraft(draft: FormDraft): FormErrors {
  const errors: FormErrors = {};
  const lineErrors: NonNullable<FormErrors["lineErrors"]> = [];
  const seenIngredientIds = new Set<string>();

  if (!draft.name.trim()) {
    errors.name = "Recipe name is required";
  }

  const yieldQuantityRaw = draft.yield_quantity.trim();

  if (yieldQuantityRaw.length === 0) {
    errors.yield_quantity = "Yield quantity is required";
  } else {
    const yieldQuantity = parseNumericInput(yieldQuantityRaw);

    if (yieldQuantity === null || yieldQuantity <= 0) {
      errors.yield_quantity = "Yield quantity must be greater than zero";
    }
  }

  if (!isRecipeYieldUnit(draft.yield_unit)) {
    errors.yield_unit = "Yield unit is required";
  }

  if (draft.recipe_role === "component") {
    if (draft.lines.length === 0) {
      errors.lines = "Add at least one ingredient";
    }

    draft.lines.forEach((line) => {
      const lineError: {
        ingredient_id?: string;
        quantity?: string;
        unit?: string;
      } = {};

      if (!line.ingredient_id) {
        lineError.ingredient_id = "Ingredient is required";
      } else if (seenIngredientIds.has(line.ingredient_id)) {
        lineError.ingredient_id = "Ingredient already added";
      } else {
        seenIngredientIds.add(line.ingredient_id);
      }

      const quantityRaw = line.quantity.trim();

      if (quantityRaw.length === 0) {
        lineError.quantity = "Quantity is required";
      } else {
        const quantity = parseNumericInput(quantityRaw);

        if (quantity === null || quantity <= 0) {
          lineError.quantity = "Quantity must be greater than zero";
        }
      }

      if (!line.unit.trim()) {
        lineError.unit = "Unit is required";
      }

      lineErrors.push(lineError);
    });

    if (lineErrors.some((line) => Object.keys(line).length > 0)) {
      errors.lineErrors = lineErrors;
    }

    return errors;
  }

  const componentErrors: NonNullable<FormErrors["componentErrors"]> = [];
  const seenComponentIds = new Set<string>();

  if (draft.components.length === 0) {
    errors.components = "Add at least one component";
  }

  draft.components.forEach((component) => {
    const componentError: {
      component_recipe_id?: string;
      quantity?: string;
      unit?: string;
    } = {};

    if (!component.component_recipe_id) {
      componentError.component_recipe_id = "Component is required";
    } else if (seenComponentIds.has(component.component_recipe_id)) {
      componentError.component_recipe_id = "Component already added";
    } else {
      seenComponentIds.add(component.component_recipe_id);
    }

    const quantityRaw = component.quantity.trim();

    if (quantityRaw.length === 0) {
      componentError.quantity = "Quantity is required";
    } else {
      const quantity = parseNumericInput(quantityRaw);

      if (quantity === null || quantity <= 0) {
        componentError.quantity = "Quantity must be greater than zero";
      }
    }

    if (!component.unit.trim()) {
      componentError.unit = "Unit is required";
    }

    componentErrors.push(componentError);
  });

  if (componentErrors.some((component) => Object.keys(component).length > 0)) {
    errors.componentErrors = componentErrors;
  }

  return errors;
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500";

type RecipeEditorFormProps = Omit<RecipeEditorModalProps, "isOpen">;

function RecipeEditorForm({
  recipe,
  initialValues,
  ingredients,
  componentRecipes,
  isLoading,
  isSaving,
  error,
  onClose,
  onSave,
}: RecipeEditorFormProps) {
  const [formValues, setFormValues] = useState<FormDraft>(() =>
    valuesToDraft(initialValues),
  );
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const fieldErrors = validateDraft(formValues);
  const isFormValid = Object.keys(fieldErrors).length === 0;

  // Only recipes with recipe_role = 'component' may be picked as a
  // component, and a recipe may never be its own component (also enforced
  // by recipe_components' CHECK constraint and enforce_recipe_component_roles
  // trigger — filtered here too so the picker never offers an option that
  // would just fail on save).
  const selectableComponentRecipes = componentRecipes.filter(
    (option) => option.id !== recipe?.id,
  );

  const updateHeader = <K extends keyof Omit<FormDraft, "lines" | "components">>(
    field: K,
    value: FormDraft[K],
  ) => {
    setFormValues((current) => ({ ...current, [field]: value }));
  };

  const updateLine = <K extends keyof LineDraft>(
    index: number,
    field: K,
    value: LineDraft[K],
  ) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    }));
  };

  const selectIngredient = (index: number, ingredientId: string) => {
    const ingredient = ingredients.find((item) => item.id === ingredientId);

    setFormValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              ingredient_id: ingredientId,
              unit: ingredient?.unit ?? "",
            }
          : line,
      ),
    }));
  };

  const addLine = () => {
    setFormValues((current) => ({
      ...current,
      lines: [
        ...current.lines,
        { ingredient_id: "", quantity: "", unit: "" },
      ],
    }));
  };

  const updateComponentLine = <K extends keyof ComponentLineDraft>(
    index: number,
    field: K,
    value: ComponentLineDraft[K],
  ) => {
    setFormValues((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index
          ? { ...component, [field]: value }
          : component,
      ),
    }));
  };

  const selectComponentRecipe = (index: number, componentRecipeId: string) => {
    const option = componentRecipes.find(
      (item) => item.id === componentRecipeId,
    );

    setFormValues((current) => ({
      ...current,
      components: current.components.map((component, componentIndex) =>
        componentIndex === index
          ? {
              ...component,
              component_recipe_id: componentRecipeId,
              unit: option?.yield_unit ?? "",
            }
          : component,
      ),
    }));
  };

  const addComponentLine = () => {
    setFormValues((current) => ({
      ...current,
      components: [
        ...current.components,
        { component_recipe_id: "", quantity: "", unit: "" },
      ],
    }));
  };

  const removeComponentLine = (index: number) => {
    setFormValues((current) => ({
      ...current,
      components: current.components.filter(
        (_, componentIndex) => componentIndex !== index,
      ),
    }));
  };

  const removeLine = (index: number) => {
    setFormValues((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setHasAttemptedSubmit(true);

    if (!isFormValid) {
      return;
    }

    await onSave(draftToValues(formValues));
  };

  if (isLoading) {
    return (
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <div className="space-y-4">
          <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
          <div className="h-4 w-72 animate-pulse rounded bg-zinc-200" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-10 animate-pulse rounded bg-zinc-200" />
            ))}
          </div>
          <div className="mt-6 h-40 animate-pulse rounded bg-zinc-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-zinc-900">
          {recipe ? "Edit Recipe" : "Create Recipe"}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Define the bill of materials for this recipe. Inventory stock is not
          changed.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label
              htmlFor="recipe_name"
              className="block text-sm font-medium text-zinc-700"
            >
              Recipe name
            </label>
            <input
              id="recipe_name"
              type="text"
              value={formValues.name}
              onChange={(event) => updateHeader("name", event.target.value)}
              disabled={isSaving}
              className={inputClassName}
              placeholder="e.g. Classic crepe batter"
              aria-invalid={Boolean(hasAttemptedSubmit && fieldErrors.name)}
            />
            {hasAttemptedSubmit && fieldErrors.name && (
              <p className="text-sm text-red-600">{fieldErrors.name}</p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label
              htmlFor="recipe_description"
              className="block text-sm font-medium text-zinc-700"
            >
              Description
            </label>
            <textarea
              id="recipe_description"
              value={formValues.description}
              onChange={(event) =>
                updateHeader("description", event.target.value)
              }
              disabled={isSaving}
              rows={3}
              className={inputClassName}
              placeholder="Optional notes about this recipe"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="yield_quantity"
              className="block text-sm font-medium text-zinc-700"
            >
              Yield quantity
            </label>
            <NumericInput
              id="yield_quantity"
              value={formValues.yield_quantity}
              onChange={(value) => updateHeader("yield_quantity", value)}
              disabled={isSaving}
              placeholder="1"
              aria-invalid={Boolean(
                hasAttemptedSubmit && fieldErrors.yield_quantity,
              )}
            />
            {hasAttemptedSubmit && fieldErrors.yield_quantity && (
              <p className="text-sm text-red-600">{fieldErrors.yield_quantity}</p>
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="yield_unit"
              className="block text-sm font-medium text-zinc-700"
            >
              Yield unit
            </label>
            <select
              id="yield_unit"
              value={formValues.yield_unit}
              onChange={(event) =>
                updateHeader("yield_unit", event.target.value as RecipeYieldUnit)
              }
              disabled={isSaving}
              className={inputClassName}
              aria-invalid={Boolean(
                hasAttemptedSubmit && fieldErrors.yield_unit,
              )}
            >
              {RECIPE_YIELD_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            {hasAttemptedSubmit && fieldErrors.yield_unit && (
              <p className="text-sm text-red-600">{fieldErrors.yield_unit}</p>
            )}
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label
              htmlFor="recipe_role"
              className="block text-sm font-medium text-zinc-700"
            >
              Recipe type
            </label>
            <select
              id="recipe_role"
              value={formValues.recipe_role}
              onChange={(event) =>
                updateHeader("recipe_role", event.target.value as RecipeRole)
              }
              disabled={isSaving}
              className={inputClassName}
            >
              {RECIPE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {RECIPE_ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-3 text-sm font-medium text-zinc-700">
              <input
                type="checkbox"
                checked={formValues.is_active}
                onChange={(event) =>
                  updateHeader("is_active", event.target.checked)
                }
                disabled={isSaving}
                className="h-4 w-4 rounded border-zinc-300 text-amber-500 focus:ring-amber-500/30"
              />
              Active recipe
            </label>
          </div>
        </div>

        {formValues.recipe_role === "component" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-900">Ingredients</h3>
              <button
                type="button"
                onClick={addLine}
                disabled={isSaving}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Add line
              </button>
            </div>

            {hasAttemptedSubmit && fieldErrors.lines && (
              <p className="text-sm text-red-600">{fieldErrors.lines}</p>
            )}

            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                        Ingredient
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                        Quantity
                      </th>
                      <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                        Unit
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {formValues.lines.map((line, index) => {
                      const lineError = fieldErrors.lineErrors?.[index];
                      const selectedIngredientIds = new Set(
                        formValues.lines
                          .map((item, itemIndex) =>
                            itemIndex === index ? null : item.ingredient_id,
                          )
                          .filter((id): id is string => Boolean(id)),
                      );

                      return (
                        <tr key={index} className="border-t border-zinc-200">
                          <td className="px-3 py-3 align-top">
                            <select
                              value={line.ingredient_id}
                              onChange={(event) =>
                                selectIngredient(index, event.target.value)
                              }
                              disabled={isSaving}
                              className={inputClassName}
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && lineError?.ingredient_id,
                              )}
                            >
                              <option value="">Select ingredient</option>
                              {ingredients.map((ingredient) => (
                                <option
                                  key={ingredient.id}
                                  value={ingredient.id}
                                  disabled={
                                    selectedIngredientIds.has(ingredient.id) &&
                                    ingredient.id !== line.ingredient_id
                                  }
                                >
                                  {ingredient.name} ({ingredient.unit})
                                </option>
                              ))}
                            </select>
                            {hasAttemptedSubmit && lineError?.ingredient_id && (
                              <p className="mt-1 text-sm text-red-600">
                                {lineError.ingredient_id}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <NumericInput
                              value={line.quantity}
                              onChange={(value) =>
                                updateLine(index, "quantity", value)
                              }
                              disabled={isSaving}
                              className="text-right"
                              placeholder="0.00"
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && lineError?.quantity,
                              )}
                            />
                            {hasAttemptedSubmit && lineError?.quantity && (
                              <p className="mt-1 text-sm text-red-600">
                                {lineError.quantity}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="text"
                              value={line.unit}
                              readOnly
                              disabled={isSaving}
                              className={inputClassName}
                              placeholder="Select ingredient"
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && lineError?.unit,
                              )}
                            />
                            {hasAttemptedSubmit && lineError?.unit && (
                              <p className="mt-1 text-sm text-red-600">
                                {lineError.unit}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              disabled={isSaving || formValues.lines.length === 1}
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-900">Components</h3>
              <button
                type="button"
                onClick={addComponentLine}
                disabled={isSaving}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Add line
              </button>
            </div>
            <p className="text-sm text-zinc-500">
              How much of each pre-produced component is needed for one
              portion of this dish. Assembled at sale time — inventory stock
              is not changed here.
            </p>

            {hasAttemptedSubmit && fieldErrors.components && (
              <p className="text-sm text-red-600">{fieldErrors.components}</p>
            )}

            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                        Component
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                        Quantity
                      </th>
                      <th className="px-3 py-3 text-left text-sm font-semibold text-zinc-700">
                        Unit
                      </th>
                      <th className="px-3 py-3 text-right text-sm font-semibold text-zinc-700">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {formValues.components.map((component, index) => {
                      const componentError = fieldErrors.componentErrors?.[index];
                      const selectedComponentIds = new Set(
                        formValues.components
                          .map((item, itemIndex) =>
                            itemIndex === index
                              ? null
                              : item.component_recipe_id,
                          )
                          .filter((id): id is string => Boolean(id)),
                      );

                      return (
                        <tr key={index} className="border-t border-zinc-200">
                          <td className="px-3 py-3 align-top">
                            <select
                              value={component.component_recipe_id}
                              onChange={(event) =>
                                selectComponentRecipe(index, event.target.value)
                              }
                              disabled={isSaving}
                              className={inputClassName}
                              aria-invalid={Boolean(
                                hasAttemptedSubmit &&
                                  componentError?.component_recipe_id,
                              )}
                            >
                              <option value="">Select component</option>
                              {selectableComponentRecipes.map((option) => (
                                <option
                                  key={option.id}
                                  value={option.id}
                                  disabled={
                                    selectedComponentIds.has(option.id) &&
                                    option.id !== component.component_recipe_id
                                  }
                                >
                                  {option.name}
                                </option>
                              ))}
                            </select>
                            {hasAttemptedSubmit &&
                              componentError?.component_recipe_id && (
                                <p className="mt-1 text-sm text-red-600">
                                  {componentError.component_recipe_id}
                                </p>
                              )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <NumericInput
                              value={component.quantity}
                              onChange={(value) =>
                                updateComponentLine(index, "quantity", value)
                              }
                              disabled={isSaving}
                              className="text-right"
                              placeholder="0.00"
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && componentError?.quantity,
                              )}
                            />
                            {hasAttemptedSubmit && componentError?.quantity && (
                              <p className="mt-1 text-sm text-red-600">
                                {componentError.quantity}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <input
                              type="text"
                              value={component.unit}
                              readOnly
                              disabled={isSaving}
                              className={inputClassName}
                              placeholder="Select component"
                              aria-invalid={Boolean(
                                hasAttemptedSubmit && componentError?.unit,
                              )}
                            />
                            {hasAttemptedSubmit && componentError?.unit && (
                              <p className="mt-1 text-sm text-red-600">
                                {componentError.unit}
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right align-top">
                            <button
                              type="button"
                              onClick={() => removeComponentLine(index)}
                              disabled={
                                isSaving || formValues.components.length === 1
                              }
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse justify-end gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : recipe ? "Save changes" : "Create Recipe"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function RecipeEditorModal({
  isOpen,
  recipe,
  initialValues,
  ingredients,
  componentRecipes,
  isLoading,
  isSaving,
  error,
  onClose,
  onSave,
}: RecipeEditorModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isSaving ? undefined : onClose}
        disabled={isSaving}
      />

      <RecipeEditorForm
        key={recipe?.id ?? `create-${isLoading ? "loading" : "ready"}`}
        recipe={recipe}
        initialValues={initialValues}
        ingredients={ingredients}
        componentRecipes={componentRecipes}
        isLoading={isLoading}
        isSaving={isSaving}
        error={error}
        onClose={onClose}
        onSave={onSave}
      />
    </div>
  );
}
