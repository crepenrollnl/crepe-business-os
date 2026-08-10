# E2E tests (Playwright)

Separate from the Vitest unit suite (`src/**/*.test.ts(x)`) — these drive a
real browser against a real running Next.js server and the project's
**shared dev Supabase project** (no local/dedicated test database yet; see
the E2E investigation from 08.08.2026 for the tradeoffs and the two other
options considered).

## Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — same
  values as `.env.local`, needed to build/run the Next.js server these tests
  hit.
- `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` — credentials for a dedicated
  Supabase Auth test user (already created; do not use a real user's
  credentials).

## Running locally

```bash
E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npm run test:e2e
```

First run downloads browser binaries if missing: `npx playwright install`.

## How auth works

`auth.setup.ts` runs once (the `setup` project in `playwright.config.ts`),
logs in through the real `/login` form, and saves the session to
`playwright/.auth/user.json` (gitignored). Every other spec reuses that
file via `storageState` instead of logging in again.

## Test data policy

No ingredients/recipes/suppliers/etc. are seeded ahead of time. Specs that
need business data (unlike `shift.spec.ts`, which only toggles a single
status field and leaves nothing behind) create it themselves through the
real UI, with an unmistakable prefix (`TEST `) on every name/label.

**Decision (09.08.2026): specs do NOT delete this data afterward.** An
earlier draft of this policy said specs should "clean it up" — that turned
out to be unenforceable with the app's actual capabilities, discovered
while building `purchase-receive.spec.ts`: `deleteIngredient` refuses once
an ingredient is used in a purchase (even a draft), there is no
`deleteSupplier` in the codebase at all, and `purchaseService` has no
user-facing purchase deletion (only an internal rollback of a row it just
inserted, immediately, on the same request). So instead:

- Every spec creates fresh `TEST `-prefixed rows on every run (no shared
  fixtures assumed to exist, no dependence on a previous run's leftovers)
  so repeated/parallel runs never collide.
- Nothing is deleted at the end of a spec. This is a deliberate accepted
  tradeoff, not an oversight — the shared dev Supabase project will
  accumulate `TEST `-prefixed rows over time.
- Periodic manual cleanup is a separate, human-triggered step:
  [`scripts/e2e-cleanup.sql`](../scripts/e2e-cleanup.sql), run by hand in
  the Supabase SQL Editor whenever the clutter is worth clearing. It is
  never run automatically (not from CI, not from any test).
