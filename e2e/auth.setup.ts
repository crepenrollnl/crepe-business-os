import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/user.json";

/**
 * Playwright's documented auth-setup pattern: run once (the "setup"
 * project in playwright.config.ts), log in through the real /login form,
 * then save storageState so every other test starts already authenticated
 * instead of repeating the login flow (and burning Supabase Auth rate
 * limits) in each spec.
 */
setup("authenticate", async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set (see e2e/README.md).",
    );
  }

  await page.goto("/login");

  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();

  // AuthGuard on "/" redirects unauthenticated visitors straight back to
  // /login, so landing on "/" and staying there is the real success signal.
  await expect(page).toHaveURL("/");

  await page.context().storageState({ path: authFile });
});
