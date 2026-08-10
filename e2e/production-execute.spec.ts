import { test, expect } from "@playwright/test";

/**
 * Narrow slice of the "production execute" step of the critical path (see
 * the E2E investigation this session, e2e/README.md): create a fresh TEST
 * ingredient with sufficient stock, a TEST recipe (role = Component), a
 * production plan that reaches ready_to_produce, start a production
 * session, finish it, and confirm raw stock was actually deducted. This is
 * the first step in the critical path that both mutates
 * ingredients.current_stock for real (complete_production_session) and can
 * post a real accounting journal entry (completeSessionAndPostJournal) --
 * both accepted for TEST data in the shared dev project (see investigation
 * notes: the real business's accounting now lives in a separate Vercel
 * Production Supabase project, so this no longer touches real books).
 *
 * Every run creates brand-new "TEST "-prefixed rows (unique timestamp
 * suffix) so repeated/parallel runs never collide -- and, per the
 * test-data-policy decision (e2e/README.md), nothing here is deleted
 * afterward. Periodic cleanup is scripts/e2e-cleanup.sql, run by hand
 * (journal_entries/ledger_entries are deliberately excluded from that
 * script -- see its header comment).
 */
test("create recipe and plan, execute production, confirm stock deducted", async ({
  page,
}) => {
  const suffix = Date.now();
  const ingredientName = `TEST Ingredient E2E Execute ${suffix}`;
  const ingredientUnit = "kg";
  const recipeName = `TEST Recipe E2E Execute ${suffix}`;
  const planName = `TEST Plan E2E Execute ${suffix}`;

  // Recipe: yield_quantity 10, 1 kg ingredient per batch. Plan: planned
  // quantity 5. required = ingredient_quantity * planned / yield = 0.5 kg
  // (complete_production_session scales by actual_produced_quantity /
  // recipe.yield_quantity -- see sql/007_complete_production.sql -- and
  // actual is entered equal to planned below, so the result is the same
  // 0.5 kg either way). Initial stock of 100 leaves enormous headroom.
  const initialStock = 100;
  const expectedStockAfter = "99.5";

  // --- Create the TEST ingredient through the real Inventory UI. ---
  await page.goto("/inventory");
  await page.getByRole("button", { name: "+ Add Ingredient" }).click();

  const createIngredientForm = page.locator("form");
  await createIngredientForm.getByLabel("Name").fill(ingredientName);
  await createIngredientForm.getByLabel("Category").selectOption({ index: 1 });
  await createIngredientForm
    .getByLabel("Unit", { exact: true })
    .fill(ingredientUnit);
  await createIngredientForm.getByLabel("Current Stock").fill("0");
  await createIngredientForm.getByLabel("Minimum Stock").fill("0");
  await createIngredientForm.getByLabel("Cost Per Unit").fill("1");
  await createIngredientForm.getByRole("button", { name: "Save" }).click();
  await expect(createIngredientForm).toHaveCount(0);

  // --- Set sufficient stock via Edit (same form, real updateIngredient
  // path -- shorter than routing through a full purchase-receive flow,
  // and the field isn't locked since the ingredient isn't used in any
  // recipe yet). ---
  const ingredientRow = page.locator("tr", { hasText: ingredientName });
  await ingredientRow.getByRole("button", { name: "Edit" }).click();

  const editIngredientForm = page.locator("form");
  await editIngredientForm
    .getByLabel("Current Stock")
    .fill(String(initialStock));
  await editIngredientForm.getByRole("button", { name: "Save" }).click();
  await expect(editIngredientForm).toHaveCount(0);
  await expect(ingredientRow.getByTestId("current-quantity")).toHaveText(
    String(initialStock),
  );

  // --- Create a Component-role TEST recipe through the real Recipes UI. ---
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Create Recipe" }).click();

  const recipeForm = page.locator("form");
  await recipeForm.getByLabel("Recipe name").fill(recipeName);
  await recipeForm.getByLabel("Yield quantity").fill("10");
  await recipeForm
    .getByLabel("Recipe type")
    .selectOption({ value: "component" });

  const ingredientLine = recipeForm.locator("tbody tr").first();
  await ingredientLine
    .locator("select")
    .selectOption({ label: `${ingredientName} (${ingredientUnit})` });
  await ingredientLine.locator("input").first().fill("1");

  await recipeForm.getByRole("button", { name: "Create Recipe" }).click();
  await expect(recipeForm).toHaveCount(0);

  // --- Create the production plan, add the recipe, and confirm. ---
  await page.goto("/production-planning");
  await page.getByRole("button", { name: "New Production Plan" }).click();

  const planForm = page.locator("form");
  await planForm.getByLabel("Name").fill(planName);
  await planForm.getByRole("button", { name: "Create" }).click();

  // Two "+ Add Product" buttons render on a fresh 0-product plan (header +
  // empty-state, production-plan-products-section.tsx), both equivalent --
  // .first() is deliberate here, not a label-collision bug.
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

  // Hard requirement, not a soft check: with 100 in stock against a 0.5
  // requirement the plan must reach ready_to_produce, not just leave
  // "draft". If it doesn't, that's a blocker for this test, not something
  // to work around here.
  await expect(page.getByText("Ready to Produce", { exact: true })).toBeVisible();

  // --- Open the plan from the Production Execution queue and start it. ---
  await page.goto("/production-execution");

  const queueRow = page.locator("tr", { hasText: planName });
  await expect(queueRow).toBeVisible();
  await queueRow.getByRole("button", { name: "Open" }).click();

  const startButton = page.getByRole("button", { name: "Start Production" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  // --- Enter the actual produced quantity and finish. ---
  const producedInput = page.getByLabel(
    `Actual produced quantity for ${recipeName}`,
  );
  await expect(producedInput).toBeVisible();
  await producedInput.fill("5");

  await page.getByRole("button", { name: "Finish Production" }).click();

  // Success signal: the session's completed banner (unique sentence, only
  // rendered once session.status === "completed") and the Finish button
  // gone.
  await expect(
    page.getByText(
      "Production session completed. Raw materials were consumed, production batches were created, and finished goods are now available for sales.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finish Production" }),
  ).toHaveCount(0);

  // --- Confirm the real stock deduction in Inventory. ---
  await page.goto("/inventory");
  await expect(
    page.locator("tr", { hasText: ingredientName }).getByTestId("current-quantity"),
  ).toHaveText(expectedStockAfter);
});
