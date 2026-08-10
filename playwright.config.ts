import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

/**
 * E2E config (Playwright). Separate from vitest.config.ts -- unit tests
 * stay on Vitest/jsdom, this drives a real browser against a real Next.js
 * server and a real Supabase project (see e2e/README.md for the current
 * "shared dev database" strategy and its tradeoffs).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "html",
  // Real network round-trips to Supabase Auth/PostgREST are slower and less
  // predictable than jsdom-mocked unit tests -- keep well above Vitest's
  // effectively-instant default.
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  // Playwright starts `npm run dev` itself and waits for baseURL to respond
  // before running tests, then tears it down after -- locally this reuses
  // an already-running dev server instead of starting a second one; in CI
  // it always starts fresh.
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
