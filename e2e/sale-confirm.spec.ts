import { test, expect } from "@playwright/test";

/**
 * Full slice of the last step of the critical path (see the E2E
 * investigation this session, e2e/README.md): a real Assembly product
 * cannot be sold without a real, already-produced Component batch to
 * FIFO-allocate from (recipe_role = "assembly" is never itself produced --
 * see sql/085_recipe_assembly_layer.sql / docs/BATCH_CONSUMPTION.md), so
 * this spec necessarily repeats the whole plan -> execute chain (its own,
 * independent TEST entities -- not shared with production-execute.spec.ts)
 * before it can build an Assembly recipe on top and sell it.
 *
 * confirm_sale auto-opens a shift itself if none is open
 * (sql/079_confirm_sale_auto_open_shift.sql), so this spec never touches
 * /shift or shift.spec.ts's flow directly.
 *
 * Stock deduction (FIFO allocation of the component's finished-goods
 * batch) and a possible real accounting journal entry
 * (confirmSaleAndPostJournals) are both accepted for TEST data in the
 * shared dev project -- same decision already made for
 * production-execute.spec.ts, not reconsidered here.
 *
 * Every run creates brand-new "TEST "-prefixed rows (unique timestamp
 * suffix) so repeated/parallel runs never collide -- and, per the
 * test-data-policy decision (e2e/README.md), nothing here is deleted
 * afterward. Periodic cleanup is scripts/e2e-cleanup.sql, run by hand.
 */
test("build and execute a component, assemble it, sell it, confirm the sale", async ({
  page,
}) => {
  const suffix = Date.now();
  const ingredientName = `TEST Ingredient E2E Sale ${suffix}`;
  const ingredientUnit = "kg";
  const componentRecipeName = `TEST Component Recipe E2E Sale ${suffix}`;
  const assemblyRecipeName = `TEST Assembly Recipe E2E Sale ${suffix}`;
  const planName = `TEST Plan E2E Sale ${suffix}`;

  // Same shape as production-execute.spec.ts: yield_quantity 10, 1 kg
  // ingredient per batch, planned quantity 5 -> 0.5 kg required against
  // 100 in stock. Producing 5 units of the component leaves plenty of
  // finished-goods headroom for a 2-portion sale below (1 component unit
  // per assembly portion).
  const initialStock = 100;

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

  const ingredientRow = page.locator("tr", { hasText: ingredientName });
  await ingredientRow.getByRole("button", { name: "Edit" }).click();

  const editIngredientForm = page.locator("form");
  await editIngredientForm
    .getByLabel("Current Stock")
    .fill(String(initialStock));
  await editIngredientForm.getByRole("button", { name: "Save" }).click();
  await expect(editIngredientForm).toHaveCount(0);

  // --- Create the Component recipe. ---
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Create Recipe" }).click();

  const componentForm = page.locator("form");
  await componentForm.getByLabel("Recipe name").fill(componentRecipeName);
  await componentForm.getByLabel("Yield quantity").fill("10");
  await componentForm
    .getByLabel("Recipe type")
    .selectOption({ value: "component" });

  const ingredientLine = componentForm.locator("tbody tr").first();
  await ingredientLine
    .locator("select")
    .selectOption({ label: `${ingredientName} (${ingredientUnit})` });
  await ingredientLine.locator("input").first().fill("1");

  await componentForm.getByRole("button", { name: "Create Recipe" }).click();
  await expect(componentForm).toHaveCount(0);

  // --- Plan the component, confirm to ready_to_produce. ---
  await page.goto("/production-planning");
  await page.getByRole("button", { name: "New Production Plan" }).click();

  const planForm = page.locator("form");
  await planForm.getByLabel("Name").fill(planName);
  await planForm.getByRole("button", { name: "Create" }).click();

  const addProductTrigger = page
    .getByRole("button", { name: "+ Add Product" })
    .first();
  await expect(addProductTrigger).toBeVisible();
  await addProductTrigger.click();

  const addProductForm = page.locator("form");
  await addProductForm.getByLabel("Search").fill(componentRecipeName);
  await addProductForm
    .getByRole("button", { name: componentRecipeName })
    .click();
  await addProductForm.getByLabel("Planned Quantity").fill("5");
  await addProductForm.getByRole("button", { name: "Save" }).click();
  await expect(addProductForm).toHaveCount(0);

  await page.getByRole("button", { name: "Confirm Plan" }).click();
  await expect(page.getByText("Ready to Produce", { exact: true })).toBeVisible();

  // --- Execute production: create a real finished-goods batch. ---
  await page.goto("/production-execution");

  const queueRow = page.locator("tr", { hasText: planName });
  await expect(queueRow).toBeVisible();
  await queueRow.getByRole("button", { name: "Open" }).click();

  const startButton = page.getByRole("button", { name: "Start Production" });
  await expect(startButton).toBeVisible();
  await startButton.click();

  const producedInput = page.getByLabel(
    `Actual produced quantity for ${componentRecipeName}`,
  );
  await expect(producedInput).toBeVisible();
  await producedInput.fill("5");
  await page.getByRole("button", { name: "Finish Production" }).click();

  await expect(
    page.getByText(
      "Production session completed. Raw materials were consumed, production batches were created, and finished goods are now available for sales.",
    ),
  ).toBeVisible();

  // --- Create the Assembly recipe on top of the Component. ---
  await page.goto("/recipes");
  await page.getByRole("button", { name: "+ Create Recipe" }).click();

  const assemblyForm = page.locator("form");
  await assemblyForm.getByLabel("Recipe name").fill(assemblyRecipeName);
  await assemblyForm.getByLabel("Yield quantity").fill("1");
  await assemblyForm
    .getByLabel("Recipe type")
    .selectOption({ value: "assembly" });

  const componentLine = assemblyForm.locator("tbody tr").first();
  // This row now has two <select>s (recipe-editor-modal.tsx's Components
  // table gained a Type picker alongside the existing Component/Ingredient
  // picker, sql/089 UI work) -- scope to the cell whose default option text
  // is "Select component" so this stays unambiguous regardless of row
  // position, rather than a positional .nth(1).
  await componentLine
    .getByRole("cell", { name: "Select component" })
    .getByRole("combobox")
    .selectOption({ label: componentRecipeName });
  // Unit auto-fills (read-only) from the selected component recipe's
  // yield_unit -- only quantity needs a value. 1 component unit per
  // assembly portion; 2 portions sold below still leaves headroom against
  // the 5 units actually produced.
  await componentLine.locator("input").first().fill("1");

  await assemblyForm.getByRole("button", { name: "Create Recipe" }).click();
  await expect(assemblyForm).toHaveCount(0);

  // --- Create a draft sale, add the Assembly product, confirm. ---
  await page.goto("/sales");
  await page.getByRole("button", { name: "+ New Sale" }).click();

  // A successful create navigates straight to the new draft sale's detail
  // page (no customer required -- customer_id is optional).
  await expect(page.getByRole("heading", { name: /^Sale /, level: 1 })).toBeVisible();

  const addLineForm = page.locator("form");
  await addLineForm.getByLabel("Product").selectOption({ label: assemblyRecipeName });
  await addLineForm.getByLabel("Quantity").fill("2");
  await addLineForm.getByLabel("Unit price").fill("9.99");
  await addLineForm.getByRole("button", { name: "Add line" }).click();

  // Header "Confirm Sale" opens a confirmation dialog that has its own,
  // second "Confirm Sale" button -- both share the same accessible name
  // while the dialog is open, so .last() (the dialog's, rendered after the
  // header in the component tree) disambiguates deliberately, same
  // reasoning as the "+ Add Product" .first() earlier in this suite, not
  // a label-collision bug.
  await page.getByRole("button", { name: "Confirm Sale" }).click();
  await page.getByRole("button", { name: "Confirm Sale" }).last().click();

  // Success signal: the sale's locked banner (unique sentence, only
  // rendered once sale.status is confirmed/paid) and both "Confirm Sale"
  // buttons (header + dialog, now closed) gone.
  await expect(
    page.getByText(
      "This sale is locked. Line items and commercial totals cannot be changed.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Sale" })).toHaveCount(0);
});
