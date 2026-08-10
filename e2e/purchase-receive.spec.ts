import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const AUTH_FILE = path.resolve(__dirname, "../playwright/.auth/user.json");

interface StorageStateFile {
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Supabase's default client persists the session under a per-project
 * localStorage key ("sb-<project-ref>-auth-token") whose value is itself a
 * JSON-encoded string. Read it back out of the storageState file
 * auth.setup.ts already saved, instead of logging in again just to get a
 * token for a plain REST call.
 */
function readSupabaseAccessToken(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!supabaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be set (see e2e/README.md).",
    );
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;

  const state = JSON.parse(
    readFileSync(AUTH_FILE, "utf-8"),
  ) as StorageStateFile;

  const entry = state.origins
    .flatMap((origin) => origin.localStorage)
    .find((item) => item.name === storageKey);

  if (!entry) {
    throw new Error(
      `Could not find Supabase session key "${storageKey}" in ${AUTH_FILE} -- run the "setup" project (auth.setup.ts) first.`,
    );
  }

  const session = JSON.parse(entry.value) as { access_token?: string };

  if (!session.access_token) {
    throw new Error(`Supabase session in ${AUTH_FILE} has no access_token.`);
  }

  return session.access_token;
}

/**
 * The app has no Suppliers UI yet -- the feature is scaffolded
 * (src/features/suppliers/services + types) but has no page/route/form,
 * by roadmap (see AGENTS.md: "Suppliers | After core ops"). create_supplier
 * is nonetheless a real RPC granted to `authenticated` and already used by
 * supplierService in unit tests. Calling it directly over the Supabase
 * REST API is the one setup step in this spec that isn't a browser click --
 * ingredient creation, purchase creation, and receiving all go through the
 * real UI below.
 */
async function createTestSupplier(name: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (see e2e/README.md).",
    );
  }

  const accessToken = readSupabaseAccessToken();

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_supplier`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ p_name: name }),
  });

  if (!response.ok) {
    throw new Error(
      `create_supplier RPC failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as
    | { supplier_id?: string }
    | Array<{ supplier_id?: string }>;
  const record = Array.isArray(body) ? body[0] : body;

  if (!record?.supplier_id) {
    throw new Error(
      `create_supplier RPC returned no supplier_id: ${JSON.stringify(body)}`,
    );
  }
}

/**
 * Narrow slice of the "purchase receive" step of the critical path (see
 * the E2E investigation and test-data-policy decision this session, both
 * in e2e/README.md): create a fresh TEST supplier + ingredient, place a
 * purchase against them, and receive it -- the real RPC + UI + RLS path
 * for the one action that actually mutates inventory stock.
 *
 * Every run creates brand-new "TEST "-prefixed rows (unique timestamp
 * suffix) so repeated/parallel runs never collide -- and, per the
 * test-data-policy decision, nothing here is deleted afterward. Periodic
 * cleanup is scripts/e2e-cleanup.sql, run by hand.
 */
test("create supplier and ingredient, then receive a purchase", async ({
  page,
}) => {
  const suffix = Date.now();
  const supplierName = `TEST Supplier E2E ${suffix}`;
  const ingredientName = `TEST Ingredient E2E ${suffix}`;
  const ingredientUnit = "kg";

  await createTestSupplier(supplierName);

  // --- Create the test ingredient through the real Inventory UI. ---
  await page.goto("/inventory");
  await page.getByRole("button", { name: "+ Add Ingredient" }).click();

  const ingredientForm = page.locator("form");
  await ingredientForm.getByLabel("Name").fill(ingredientName);
  await ingredientForm.getByLabel("Category").selectOption({ index: 1 });
  await ingredientForm.getByLabel("Unit", { exact: true }).fill(ingredientUnit);
  await ingredientForm.getByLabel("Current Stock").fill("0");
  await ingredientForm.getByLabel("Minimum Stock").fill("0");
  await ingredientForm.getByLabel("Cost Per Unit").fill("1");
  await ingredientForm.getByRole("button", { name: "Save" }).click();

  // Modal closes only after a successful save.
  await expect(ingredientForm).toHaveCount(0);

  // --- Create + receive a purchase through the real Purchases UI. ---
  await page.goto("/purchases");
  await page.getByRole("button", { name: "+ Create Purchase" }).click();

  const purchaseForm = page.locator("form");
  await purchaseForm
    .getByLabel("Supplier", { exact: true })
    .selectOption({ label: supplierName });

  const firstLine = purchaseForm.locator("tbody tr").first();
  await firstLine
    .locator("select")
    .first()
    .selectOption({ label: `${ingredientName} (${ingredientUnit})` });
  await firstLine.locator("input").nth(0).fill("2");
  await firstLine.locator("input").nth(1).fill("5");

  await purchaseForm.getByRole("button", { name: "Receive Goods" }).click();

  // Success signal: the modal switches to its read-only "received" state.
  // (Checked instead of matching the word "Received" directly -- the
  // underlying purchases list re-renders with the same status badge text
  // once this save completes, so a plain text match would be ambiguous.)
  await expect(
    page.getByText(
      "Received purchases are read-only and already applied to inventory.",
    ),
  ).toBeVisible();
  await expect(
    purchaseForm.getByRole("button", { name: "Receive Goods" }),
  ).toHaveCount(0);
});
