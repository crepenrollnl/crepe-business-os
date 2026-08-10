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

No ingredients/recipes/suppliers/etc. are seeded or asserted on. Specs that
need business data should create it themselves with an unmistakable prefix
(e.g. `TEST `, matching the manual SQL verification scenarios used
elsewhere this session) and clean it up, since there is no per-test
transaction rollback available across real HTTP requests the way there is
for a single SQL session.
