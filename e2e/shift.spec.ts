import { test, expect } from "@playwright/test";

/**
 * Narrowest possible slice of the "purchase -> plan -> execute -> sale ->
 * shift close" critical path (see the E2E investigation this session):
 * log in (handled by the setup project) -> open a shift -> close it.
 *
 * Deliberately touches zero business data (no ingredients/recipes/
 * suppliers) -- it exists to prove the real RPC + UI + RLS path works
 * end to end, the same class of gap that unit tests with mocked Supabase
 * calls cannot catch (see critical finding #4 in the plan, only found by
 * manual browser testing).
 */
test("open shift then close it", async ({ page }) => {
  await page.goto("/");

  const panel = page.getByTestId("shift-status-panel");
  await expect(panel).toBeVisible();

  const statusLabel = page.getByTestId("shift-status-label");
  const openButton = page.getByTestId("open-shift-button");
  const closeButton = page.getByTestId("close-shift-button");

  // A previous run that failed mid-test can leave a shift open for this
  // test user -- close it first so the test starts from a known state
  // instead of assuming NEVER OPENED / CLOSED.
  if ((await statusLabel.textContent())?.trim() === "OPEN") {
    await closeButton.click();
    await expect(statusLabel).toHaveText("CLOSED");
  }

  await openButton.click();
  await expect(statusLabel).toHaveText("OPEN");

  await closeButton.click();
  await expect(statusLabel).toHaveText("CLOSED");
});
