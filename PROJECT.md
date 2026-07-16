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

It is a long-term operating system for food businesses, covering operations, inventory, sales, purchasing, production, finance, accounting, taxes, reporting, and AI-assisted workflows.

---

## Product Principles

1. **Scalability first** — every module must support growth in data volume, locations, and feature depth.
2. **Transaction-first** — every financial and stock-affecting operation eventually creates a Transaction.
3. **Clean architecture** — UI, hooks, services, and types remain strictly separated.
4. **Inventory as the quality standard** — new modules must match Inventory quality before they ship.
5. **No temporary hacks** — prefer durable design over short-term shortcuts.
6. **Preserve working software** — never break existing functionality while evolving the platform.

---

## Current Platform Status

| Area | Status |
|---|---|
| Authentication | Live |
| Dashboard shell | Live |
| Inventory CRUD | Live (reference module) |
| Supabase integration | Live |
| Products | Planned |
| Recipes | Planned |
| Sales | Planned |
| Purchases | Planned |
| Production | Planned |
| Suppliers (module UI) | Planned (table exists) |
| Customers | Planned |
| Finance | Planned |
| Accounting | Planned |
| Taxes / VAT | Planned |
| Reports | Planned |
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
  page/                 # Feature page composition
```

### Responsibility boundaries

| Layer | Owns | Must not own |
|---|---|---|
| `app/` routes | Routing, auth guards, page mounting | Business logic, Supabase queries |
| Components | Rendering, local form UI state | Database access, domain rules |
| Hooks | Loading state, filters, modal flow, calling services | Raw SQL / Supabase client usage |
| Services | All database access, data mapping, error normalization | JSX, UI state |
| Types | Contracts and input/output shapes | Runtime side effects |

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
| `customers` | Customer master data |
| `events` | Catering / market / service events |
| `production_orders` | Production runs |
| `production_items` | Produced output and consumption links |

### Planned finance and accounting tables

| Table | Purpose |
|---|---|
| `transactions` | Universal business event spine |
| `accounts` | Chart of accounts |
| `journal_entries` | Double-entry postings |
| `payments` | Cash / bank / card settlements |
| `tax_rates` | VAT and other tax definitions |
| `vat_periods` | VAT reporting periods and filing state |

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

The platform must support:

- General Ledger
- Double-entry bookkeeping
- Balance Sheet
- Profit & Loss
- Cash Flow
- VAT reporting
- Income tax readiness

### Design intent

1. Every posted `Transaction` can generate one or more `journal_entries`.
2. Every journal entry balances debits and credits.
3. Operational modules emit business events; accounting posts from those events.
4. Tax modules read from transactions / journal entries / VAT periods; they do not invent a second financial truth.
5. Reports are projections over accounting and operational data, not isolated spreadsheets.

Accounting UI and posting engines are future work. Domain contracts already define the intended shape.

---

## Module Responsibilities

| Module | Responsibility |
|---|---|
| **Auth** | Session, login/logout, route guards |
| **Dashboard** | Cross-module operational overview |
| **Inventory** | Ingredient stock master, stock warnings, category/supplier links, CRUD |
| **Products** | Sellable catalog, pricing, product-recipe links |
| **Recipes** | BOM, cost rollup, allergens, future nutrition |
| **Sales** | Orders/tickets, customer linkage, stock impact, revenue transactions |
| **Purchases** | Supplier receiving, invoice capture, stock increase, cost updates |
| **Production** | Convert ingredients into finished goods via recipes |
| **Suppliers** | Vendor master, contacts, purchase history |
| **Customers** | Customer master, sales history, receivables readiness |
| **Events** | Event-based operations and fulfillment context |
| **Finance** | Payments, cash position, working-capital views |
| **Accounting** | Chart of accounts, journal posting, GL, statements |
| **Taxes** | VAT rates, VAT periods, tax settlements |
| **Reports** | Operational and financial reporting |
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

### Completed

- Project foundation
- Authentication
- Dashboard layout
- Inventory list + CRUD
- Supabase-backed inventory services

### Current focus

- Stabilize Inventory as the reference ERP module
- Harden shared architecture contracts
- Prepare Products next

### Explicitly out of scope right now

- Implementing accounting posting
- Implementing AI workflows
- Rewriting Inventory UI
- Destroying or replacing live inventory tables

---

## Success Criteria for Architecture

The architecture is correct when:

1. A new engineer or AI agent can open `AGENTS.md` and implement the next module correctly.
2. Inventory remains the quality benchmark.
3. Future modules can attach to `transactions` without redesigning Inventory.
4. Accounting can be introduced later without rewriting sales/purchases/production.
5. No feature queries Supabase from components.
6. No feature introduces a parallel financial or stock ledger.
