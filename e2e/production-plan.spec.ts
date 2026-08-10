import { test, expect } from "@playwright/test";

/**
 * Narrow slice of the "production plan" step of the critical path (see the
 * E2E investigation this session, e2e/README.md): create a fresh TEST
 * ingredient, a TEST recipe (role = Component -- only component recipes are
 * selectable in Production Planning, see production-service.ts
 * getRecipeOptions), a production plan, attach the recipe to it, and
 * Confirm. The whole path up to and including Confirm is a draft/intent
 * layer only (confirm_production_plan writes production_plan_ingredients
 * and moves plan status, never ingredients.current_stock or purchases) --
 * real stock deduction happens later in Production Execution, a separate
 * future step.
 *
 * Every run creates brand-new "TEST "-prefixed rows (unique timestamp
 * suffix) so repeated/parallel runs never collide -- and, per the
 * test-data-policy decision (e2e/README.md), nothing here is deleted
 * afterward. Periodic cleanup is scripts/e2e-cleanup.sql, run by hand.
 */
test("create recipe and production plan, then confirm", async ({ page }) => {
  const suffix = Date.now();
  const ingredientName = `TEST Ingredient E2E Plan ${suffix}`;
  const ingredientUnit = "kg";
  const recipeName = `TEST Recipe E2E ${suffix}`;
  const planName = `TEST Plan E2E ${suffix}`;

  // --- Create the test ingredient through the real Inventory UI. ---
  // A fresh ingredient of its own, not shared with purchase-receive.spec.ts
  // -- specs stay independent of each other.
  await page.goto("/inventory");
  await page.getByRole("button", { name: "+ Add Ingredient" }).click();

  const ingredientForm = page.locator("form");
  await ingredientForm.getByLabel("Name").fill(ingredientName);
  await ingredientForm.getByLabel("Category").selectOption({ index: 1 });
  await ingredientForm
    .getByLabel("Unit", { exact: true })
    .fill(ingredientUnit);
  await ingredientForm.getByLabel("Current Stock").fill("0");
  await ingredientForm.getByLabel("Minimum Stock").fill("0");
  await ingredientForm.getByLabel("Cost Per Unit").fill("1");
  await ingredientForm.getByRole("button", { name: "Save" }).click();

  // Modal closes only after a successful save.
  await expect(ingredientForm).toHaveCount(0);

  // --- Create a Component-role TEST recipe through the real Recipes UI. ---
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Create Recipe" }).click();

  const recipeForm = page.locator("form");
  await recipeForm.getByLabel("Recipe name").fill(recipeName);
  await recipeForm.getByLabel("Yield quantity").fill("10");
  // Default role is "assembly" (see types/recipe.ts DEFAULT_RECIPE_ROLE) --
  // must switch to "component", the only role Production Planning offers.
  await recipeForm
    .getByLabel("Recipe type")
    .selectOption({ value: "component" });

  const ingredientLine = recipeForm.locator("tbody tr").first();
  await ingredientLine
    .locator("select")
    .selectOption({ label: `${ingredientName} (${ingredientUnit})` });
  // Unit auto-fills (read-only) from the selected ingredient -- only
  // quantity needs a value.
  await ingredientLine.locator("input").first().fill("1");

  await recipeForm.getByRole("button", { name: "Create Recipe" }).click();
  await expect(recipeForm).toHaveCount(0);

  // --- Create the production plan through the real Production Planning UI. ---
  await page.goto("/production-planning");
  await page.getByRole("button", { name: "New Production Plan" }).click();

  const planForm = page.locator("form");
  await planForm.getByLabel("Name").fill(planName);
  await planForm.getByRole("button", { name: "Create" }).click();

  // A successful create navigates to the plan detail page. With zero
  // products on a fresh plan, "+ Add Product" renders twice (header button
  // + empty-state button, production-plan-products-section.tsx) -- both do
  // the exact same thing (onClick={onAddProduct}), so .first() is a
  // deliberate choice here, not the label-collision bug fixed earlier in
  // purchase-receive.spec.ts.
  const addProductTrigger = page
    .getByRole("button", { name: "+ Add Product" })
    .first();
  await expect(addProductTrigger).toBeVisible();
  await addProductTrigger.click();

  const addProductForm = page.locator("form");
  await addProductForm.getByLabel("Search").fill(recipeName);
  await addProductForm.getByRole("button", { name: recipeName }).click();
  await addProductForm.getByLabel("Planned Quantity").fill("5");
  await addProductForm.getByRole("button", { name: "Save" }).click();

  await expect(addProductForm).toHaveCount(0);

  await page.getByRole("button", { name: "Confirm Plan" }).click();

  // Success signal: the plan left "draft". "Confirm Plan" only renders
  // while plan.status === "draft" (production-plan-detail-header.tsx), and
  // the TEST ingredient has zero stock, so the plan is expected to land on
  // "planned" (insufficient), not "ready_to_produce" -- either is a valid
  // non-draft outcome, so this checks "not draft" rather than one exact
  // status string.
  await expect(
    page.getByRole("button", { name: "Confirm Plan" }),
  ).toHaveCount(0);
  await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
});
