# Crepe'n Roll OS

## Product Vision

Crepe'n Roll OS is a commercial ERP platform for small and medium food businesses.

It is designed for:

- food trucks
- catering companies
- restaurants
- multi-location kitchens
- production-led food brands

It is not a single-purpose food truck app.

It is a long-term operating system for food businesses, covering operations, inventory, sales, purchasing, production, accounting, reporting, and AI-assisted workflows.

---

## Product Principles

1. **Scalability first** — every module must support growth in data volume, locations, and feature depth.
2. **Transaction-first** — every financial and stock-affecting operation eventually creates a Transaction.
3. **Clean architecture** — UI, hooks, services, and types remain strictly separated.
4. **Inventory as the quality standard** — new modules must match Inventory quality before they ship.
5. **No temporary hacks** — prefer durable design over short-term shortcuts.
6. **Preserve working software** — never break existing functionality while evolving the platform.
7. **One financial module** — Accounting owns all financial capabilities; do not create parallel Finance or Taxes modules.
8. **Architecture Freeze v1.0** — the ERP Core is frozen; see [`docs/ARCHITECTURE_FREEZE_V1.md`](docs/ARCHITECTURE_FREEZE_V1.md). Core entities may not be redesigned without an ADR.

---

## Current Platform Status

**Actual module status is tracked in [`src/constants/modules.ts`](src/constants/modules.ts) — the machine-readable source of truth.** The table below is a human-readable description for context; where it conflicts with `modules.ts`, `modules.ts` wins. (Last reconciled 02.09.2026 — Finished Goods UI, Sales surfaces, and Reports sub-pages were stale here.)

| Area | Status |
|---|---|
| Authentication | Live |
| Dashboard | Live |
| Inventory CRUD | Live (reference module). Per-ingredient movement history is a drill-down at `/inventory/ingredients/{id}/movements` (`src/features/inventory-movement-history`) — not a separate registry module. |
| Supabase integration | Live |
| Products | Planned |
| Recipes | Live |
| Suppliers (module UI) | Planned (service + `create_supplier` RPC exist; no UI at all) |
| Purchases | Live |
| Production (Planning + Execution) | Live — full plan → confirm → execute cycle, E2E-covered |
| Finished Goods | Live — domain services + read-only tab on `/inventory` (not a sidebar item); `/finished-goods` redirects there. Matches `modules.ts` (`status: "live"`). |
| Sales | Live — draft → lines → confirm (FIFO finished-goods allocation, accounting posting), E2E-covered. Also live: Quick Sale (`/sales/quick`) with header discount (percent or amount, sql/110); tablet POS (`/pos`, direct URL only, not in sidebar) reuses the same cart and discount. |
| Shifts | Live — open/close and cash reconciliation on Dashboard; Shift tab on `/pos`. No dedicated `/shifts` route. |
| Customers | Planned (service layer + `create_customer` RPC exist; no UI) |
| Events | Planned (types only) |
| Accounting | Live core — chart of accounts, journals, ledger, posting engine, VAT, business events, wired into Purchases/Production/Sales; `/expenses` and `/fixed-assets` are live routed UI; no unified Accounting workspace screen yet. Singleton company settings (`company_settings`, sql/028, `src/features/company-settings`) hold name/currency/timezone for this install — not a registry module and not a nav screen. |
| Users / Roles | Planned — service layer exists (`src/features/users`), no Users UI. Runtime roles are `profiles` (sql/097: owner / partner / seller) linked to Supabase Auth; the unused `users` / `user_roles` tables are not that path. |
| Reports | Live (`/reports` workspace). Also live in the sidebar: BTW Report (`/reports/btw`, Netherlands VAT declaration) and Sales by Product (`/reports/sales-by-product`). |
| AI Assistant | Planned |

### Live database tables

- `ingredients`
- `ingredient_categories`
- `suppliers`

These tables must be preserved. Future schema work extends them; it does not replace them casually.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| UI | React 19 + Tailwind CSS |
| Backend data | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Server model | React Server Components + client hooks where needed |
| Mutations | Feature services today; Server Actions when a clear server boundary is required |

---

## System Architecture

```
src/
  app/                  # Next.js routes only (thin wrappers)
  components/           # Shared presentational UI + layout shell
  constants/            # Shared constants
  features/             # Domain modules (feature-based)
  hooks/                # Shared cross-feature hooks only
  lib/                  # Infrastructure (Supabase client, navigation, utilities)
  types/                # Shared cross-domain contracts
```

### Feature module shape

Every feature owns:

```
features/<feature>/
  components/           # Presentational UI
  hooks/                # UI state and orchestration
  services/             # Supabase / data access only
  types/                # Feature-owned interfaces
  utils/                # Feature-local pure helpers
  page/                 # Feature page composition
```

Module layout, shared primitives, error handling, and import boundaries:
[`docs/MODULE_FOUNDATION.md`](docs/MODULE_FOUNDATION.md).

### Responsibility boundaries

| Layer | Owns | Must not own |
|---|---|---|
| `app/` routes | Routing, auth guards, page mounting | Business logic, Supabase queries |
| Components | Rendering, local form UI state | Database access, domain rules |
| Hooks | Loading state, filters, modal flow, calling services | Raw SQL / Supabase client usage |
| Services | All database access, data mapping, error normalization | JSX, UI state |
| Types | Contracts and input/output shapes | Runtime side effects |
| Utils | Pure feature-local helpers | Database clients, React components |

Modules communicate through services. Do not import another feature’s components, hooks, or pages.

### Inventory is the reference implementation

Inventory currently demonstrates the required pattern:

- typed domain interfaces
- service-layer Supabase access
- hook-managed UI state
- presentational components
- search + filters
- CRUD modals with validation
- loading / empty / error states
- dashboard layout integration

All future modules must follow this pattern.

---

## Canonical Platform Modules

The platform contains only these modules (see `src/constants/modules.ts`):

1. Dashboard
2. Inventory
3. Products
4. Recipes
5. Suppliers
6. Purchases
7. Production Planning (`src/features/production`)
8. Production Execution (`src/features/production-execution`)
9. Finished Goods (`src/features/finished-goods`) — live (Inventory tab, not a nav module)
10. Sales — includes Quick Sale (`/sales/quick`, header discount) and tablet POS (`/pos`, direct URL)
11. Shifts (`src/features/shifts`) — live (Dashboard + `/pos` tab; no `/shifts` route)
12. Customers
13. Events
14. Accounting
15. Reports — includes BTW Report (`/reports/btw`) and Sales by Product (`/reports/sales-by-product`)
16. AI
17. Users & Roles (`src/features/users`) — planned

---

## Transaction-First Architecture

The ERP revolves around transactions.

Every future operation must eventually create exactly one business `Transaction` (and, where relevant, linked stock and accounting effects):

| Operation | Future effect |
|---|---|
| Purchase | Transaction + stock increase + payable / cash movement |
| Sale | Transaction + stock decrease + receivable / cash movement |
| Production | Transaction + ingredient consumption + finished-goods increase |
| Waste | Transaction + stock decrease + expense recognition |
| Transfer | Transaction + stock move between locations/batches |
| Inventory adjustment | Transaction + stock correction |
| Salary | Transaction + payroll expense + payment |
| Tax | Transaction + tax liability / settlement |
| Expense | Transaction + expense recognition + payment |
| Refund | Transaction + reversal / contra sale effects |

### Rules

1. No operational module may permanently bypass the transaction model.
2. Stock quantity changes must be explainable through `stock_movements` (and later `stock_batches`).
3. Financial reporting must be explainable through journal entries linked to transactions.
4. Until accounting is implemented, modules may prepare typed contracts and foreign keys for transactions, but must not invent parallel ledgers.

Shared contracts live in:

- `src/types/transactions.ts`
- `src/types/accounting.ts`
- `src/types/database.ts`

---

## Database Philosophy

### Design rules

1. **Preserve existing tables** — extend, do not destroy.
2. **Prefer additive migrations** — nullable columns, new tables, backfills.
3. **Use UUIDs** for primary keys unless a strong reason exists otherwise.
4. **Every mutable business row** should support audit fields (`created_at`, `updated_at`, and later `created_by` where relevant).
5. **Soft deletes** are preferred for master data that participates in history (products, customers, suppliers).
6. **Hard deletes** are acceptable only for draft or purely disposable rows.
7. **Monetary values** use numeric precision suitable for currency; never floating heuristics in business rules.
8. **Stock truth** comes from movements/batches over time, not only from a mutable `current_stock` field.
9. **Multi-entity readiness** — design tables so organization / location scoping can be added without rewriting modules.

### Current inventory model (live)

- `ingredient_categories` — classification of raw materials
- `ingredients` — stockable raw materials with unit, stock, minimum stock, cost
- `suppliers` — vendor master data referenced by ingredients

### Planned core operational tables

| Table | Purpose |
|---|---|
| `products` | Sellable / finished catalog items |
| `recipes` | Bill of materials / preparation definition |
| `recipe_items` | Ingredient lines inside a recipe |
| `purchases` | Purchase headers (supplier invoices / receipts) |
| `purchase_items` | Purchased lines affecting stock and cost |
| `stock_movements` | Immutable ledger of quantity changes |
| `stock_batches` | Lot / batch tracking and cost layers |
| `sales` | Sale headers |
| `sale_items` | Sold lines |
| `sale_batch_consumptions` | Append-only FIFO consumption layers and COGS audit (see `docs/BATCH_CONSUMPTION.md`, `docs/SALES.md`) |
| `production_batches` | Immutable Production Execution output; produced qty/cost only — remaining is calculated (see `docs/BATCH_CONSUMPTION.md`) |
| `customers` | Customer master data |
| `events` | Catering / market / service events |
| `production_orders` | Production runs |
| `production_items` | Produced output and consumption links |

### Planned accounting tables

Full proposal: [`docs/ACCOUNTING_DATA_MODEL.md`](docs/ACCOUNTING_DATA_MODEL.md).

| Table | Purpose |
|---|---|
| `transactions` | Universal business event spine |
| `accounts` | Chart of accounts |
| `fiscal_periods` | Open / closed / locked posting windows |
| `currency_rates` | FX rates into company base currency |
| `posting_rules` / `posting_rule_lines` | Event → account role mappings |
| `account_role_bindings` | Role → concrete account bindings |
| `accounting_business_events` | Immutable financial intake for posting |
| `journal_entries` / `journal_lines` | Double-entry postings |
| `ledger_entries` | Append-only general ledger facts |
| `payments` | Cash / bank / card settlements |
| `bank_accounts` | Bank and cash accounts |
| `tax_rates` | VAT and other tax definitions |
| `vat_periods` | VAT reporting periods and filing state |
| `fixed_assets` | Fixed asset register readiness |

### Inventory evolution path

Today:

- `ingredients.current_stock` is the working stock figure
- `ingredients.cost_per_unit` is the working unit cost

Target:

- `stock_movements` become the audit trail for quantity changes
- `stock_batches` support FIFO / average cost strategies
- `ingredients.current_stock` remains a fast read model, updated by movement posting
- purchases and production never silently edit stock without a movement

---

## Accounting Architecture (Prepared, Not Implemented)

Accounting is the sole financial module. It will become the home for:

- VAT
- Taxes
- Bank Accounts
- General Ledger
- Journal Entries
- Balance Sheet
- Profit & Loss
- Cash Flow
- Fixed Assets
- Payroll integration
- Financial reports

**Canonical architecture:** [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md)  
**Data model / SQL plan:** [`docs/ACCOUNTING_DATA_MODEL.md`](docs/ACCOUNTING_DATA_MODEL.md)  
**Shared contracts:** `src/types/accounting.ts`

### Design intent

1. Required flow: Business Event → Posting Engine → Journal Entry → Ledger → Financial Reports.
2. Every posted journal entry balances debits and credits in company base currency.
3. Operational modules emit Accounting Business Events; Accounting alone posts journals/ledger.
4. Operational modules never write accounting tables.
5. Multi-currency is first-class (base currency, transaction currency, exchange rate, base/transaction amounts).
6. VAT and tax workflows live inside Accounting; they do not invent a second financial truth.
7. Reports are projections over accounting and operational data, not isolated spreadsheets.
8. There is no separate Finance or Taxes feature module.

Accounting UI is partial (Expenses and Fixed Assets routes; no unified Accounting workspace). SQL posting RPCs and the TypeScript posting engine are live and wired into Purchases, Production, and Sales. Architecture and contracts remain locked by DEV-086 / `docs/ACCOUNTING.md`.

---

## Module Responsibilities

| Module | Responsibility |
|---|---|
| **Auth** | Session, login/logout, route guards |
| **Dashboard** | Cross-module operational overview |
| **Inventory** | Ingredient stock master, stock warnings, category/supplier links, CRUD |
| **Products** | Sellable catalog, pricing, product-recipe links |
| **Recipes** | BOM, cost rollup, allergens, future nutrition |
| **Suppliers** | Vendor master, contacts, purchase history |
| **Purchases** | Supplier receiving, invoice capture, stock increase, cost updates |
| **Production** | Convert ingredients into finished goods via recipes (Planning + Execution; Execution creates Production Batches) |
| **Finished Goods** | Read-only aggregated view of sellable availability from Produced − Consumed (specs: `docs/FINISHED_GOODS.md`, `docs/BATCH_CONSUMPTION.md`) — never stores inventory |
| **Sales** | Sale documents, append-only Sale Batch Consumption (FIFO), COGS/profit from consumption layers, revenue transactions (specs: `docs/SALES.md`, `docs/BATCH_CONSUMPTION.md`) — never mutates Inventory, never updates Production Batches, never creates Finished Goods |
| **Shifts** | Shift open/close, cash reconciliation, daily sales/profit summaries — UI on Dashboard and the `/pos` Shift tab; no `/shifts` route |
| **Customers** | Customer master, sales history, receivables readiness |
| **Events** | Event-based operations and fulfillment context |
| **Accounting** | Sole financial module: VAT, taxes, bank accounts, chart of accounts, journal posting, GL, Balance Sheet, P&L, Cash Flow, fixed assets, payroll integration, financial reports |
| **Reports** | Operational and financial reporting (projects from Accounting for money views) |
| **AI** | OCR, suggestions, forecasting — always acting through services, never bypassing domain rules |
| **Transactions** | Shared transaction contracts and future posting orchestration |

---

## AI Integration Strategy

AI is an acceleration layer, not a source of truth.

Allowed future capabilities:

- invoice OCR
- purchase line recognition
- inventory reorder suggestions
- demand forecasting
- anomaly detection in stock / margins

AI rules:

1. AI proposals must be reviewable before commit.
2. AI never writes directly to stock or accounting tables outside services.
3. AI outputs are validated against domain types and business rules.
4. Human-approved AI actions still create normal Transactions and movements.

---

## UI / UX Standard

Visual direction:

- Stripe
- Linear
- Notion
- Vercel Dashboard

Characteristics:

- minimal
- professional
- high information density without clutter
- consistent dashboard shell

Table requirements:

- search
- sorting
- pagination
- loading state
- empty state
- error state

Modal requirements:

- validation
- cancel
- save

Do not redesign working screens unless explicitly requested.

---

## Development Status Snapshot

**See [`src/constants/modules.ts`](src/constants/modules.ts) for current per-module status; this snapshot is a narrative summary and can drift out of date faster than the registry.**

### Completed

- Project foundation
- Authentication
- Dashboard layout
- Inventory list + CRUD
- Recipes, Purchases, Production Planning, Production Execution, Sales — full workflows, E2E-covered critical path
- Finished Goods — live as an Inventory tab (`modules.ts` `status: "live"`)
- Shifts — live on Dashboard and as a `/pos` tab (`modules.ts` `status: "live"`)
- Sales surfaces beyond the document workflow: Quick Sale (`/sales/quick`) with header discount; tablet POS (`/pos`)
- Reports (`/reports` workspace), BTW Report (`/reports/btw`), Sales by Product (`/reports/sales-by-product`)
- Accounting core (chart of accounts, journals, ledger, posting engine, VAT, business events) wired into Purchases/Production/Sales, plus live `/expenses` and `/fixed-assets`

### Current focus

- Products, Customers, Events, Suppliers UI — service layers/backends exist for some of these already; UI does not
- Users UI (`src/features/users`) — planned; live role checks already go through `profiles` (sql/097), not a Users screen

### Explicitly out of scope right now

- Implementing AI workflows
- Rewriting Inventory UI
- Destroying or replacing live inventory tables

---

## Architecture Freeze v1.0

The **ERP Core Architecture** is officially frozen as the project baseline.

**Canonical freeze document:** [`docs/ARCHITECTURE_FREEZE_V1.md`](docs/ARCHITECTURE_FREEZE_V1.md)

Supporting specs (must not contradict the freeze):

- [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md) — immutable Production Batches and Sale Batch Consumption
- [`docs/FINISHED_GOODS.md`](docs/FINISHED_GOODS.md) — read-only calculated Finished Goods view
- [`docs/SALES.md`](docs/SALES.md) — Sales FIFO, COGS, and returns

From Architecture Freeze v1.0 onward:

- New modules must follow the approved ERP Core.
- Core entities may not be redesigned without an Architecture Decision Record (ADR).
- Future work should focus on implementation instead of redesign.

---

## Success Criteria for Architecture

The architecture is correct when:

1. A new engineer or AI agent can open `AGENTS.md` and implement the next module correctly.
2. Inventory remains the quality benchmark.
3. Future modules can attach to `transactions` without redesigning Inventory.
4. Accounting can be introduced later without rewriting sales/purchases/production.
5. No feature queries Supabase from components.
6. No feature introduces a parallel financial or stock ledger.
7. There is exactly one financial module: Accounting.
8. Implementation respects Architecture Freeze v1.0 (`docs/ARCHITECTURE_FREEZE_V1.md`).
