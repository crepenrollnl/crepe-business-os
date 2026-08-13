# AGENTS.md

# Crepe'n Roll OS — Agent Development Charter

This file is the operating manual for every AI agent and engineer working on Crepe'n Roll OS.

Read `PROJECT.md` for product vision and system design.
Read `ROADMAP.md` for sequencing.
Read `docs/ARCHITECTURE_FREEZE_V1.md` for the frozen ERP Core Architecture baseline (v1.0).
Read `docs/MODULE_FOUNDATION.md` for module layout, shared primitives, error handling, and boundary rules.
Read `docs/BATCH_CONSUMPTION.md` for immutable Production Batch + Sale Batch Consumption architecture.
Read `docs/FINISHED_GOODS.md` before implementing Finished Goods.
Read `docs/SALES.md` before implementing Sales.
Read `docs/ACCOUNTING.md` before implementing Accounting (canonical financial architecture).
Read `docs/ACCOUNTING_DATA_MODEL.md` for the Accounting SQL object plan (proposal only until implementation sprint).
Follow this file for implementation rules.

**Architecture Freeze v1.0** is mandatory. Core entities may not be redesigned without an Architecture Decision Record (ADR). Implementation alone must never redefine architecture.

---

## Project Vision

Crepe'n Roll OS is a commercial ERP platform for small and medium food businesses.

Target customers:

- food trucks
- catering companies
- restaurants
- multi-location kitchens

It must eventually support:

- Dashboard
- Inventory
- Products
- Recipes
- Suppliers
- Purchases
- Production
- Sales
- Customers
- Events
- Accounting
- Reports
- AI Assistant

Accounting is the sole financial module. It will own VAT, taxes, bank accounts, general ledger, journal entries, financial statements, fixed assets, payroll integration, and financial reports.

Always design for a long-term ERP platform.
Never design for a disposable demo.

---

## Non-Negotiable Priorities

1. Scalability
2. Maintainability
3. Clean architecture
4. Developer experience
5. Excellent UI/UX

Never generate quick hacks.
Always choose long-term architecture.
Never break existing functionality.
Never remove existing features unless explicitly instructed.
Never change architecture casually.
Never rewrite working modules without explicit instruction.
Never change working UI unless the task explicitly requires it.

---

## Tech Stack

- Next.js 16 (App Router)
- TypeScript (strict)
- Tailwind CSS
- Supabase
- PostgreSQL
- React Server Components
- Server Actions when a clear server boundary is required

---

## Folder Architecture

```
src/
  app/                      # Route entrypoints only
  components/               # Shared UI + layout
  constants/                # Shared constants (modules, units, statuses, limits, config)
  features/<module>/        # Domain modules (ERP module root)
    components/
    hooks/
    services/
    types/
    utils/
    page/
  hooks/                    # Shared hooks only
  lib/                      # Infrastructure (Supabase, money, service errors, navigation)
  types/                    # Cross-domain contracts (erp, service, transactions, accounting)
```

Canonical module foundation: [`docs/MODULE_FOUNDATION.md`](docs/MODULE_FOUNDATION.md).

### Feature ownership

Each feature owns its own:

- `components/` — presentational UI
- `hooks/` — UI state and orchestration
- `services/` — database access
- `types/` — feature interfaces
- `utils/` — feature-local pure helpers
- `page/` — page composition used by `app/`

### Module boundary rule

Modules communicate through **services** (and shared `@/types` / `@/constants` / `@/lib`).

Do not import another module’s `components/`, `hooks/`, or `page/`.

### Route rule

`src/app/**/page.tsx` must stay thin:

- import feature page
- wrap with auth guard when required
- no business logic
- no Supabase queries

---

## Architecture Rules

These domain rules govern inventory ownership and stock mutation. They are documentation for future modules; do not implement unfinished production or finished-goods logic ahead of the roadmap.

**Frozen baseline:** [`docs/ARCHITECTURE_FREEZE_V1.md`](docs/ARCHITECTURE_FREEZE_V1.md) — ERP Core Architecture Freeze v1.0. Do not redesign core entities without an ADR.

### Inventory ownership

- **Inventory** stores **raw materials** only (ingredients such as flour, milk, chicken, cheese).
- **Finished Goods** presents **sellable products** only (for example Chicken Crepe, Apple Crepe, Nutella Banana Crepe).
- Raw materials and finished goods are different stock domains. Never treat them as one stock pool.

### Production Batch and Finished Goods rules

These rules govern future Production, Sales, and Reports. Document and design against them; do not implement unfinished batch logic ahead of the roadmap.

**Canonical consumption architecture:** [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md)

- **Production Batches are immutable** historical production events (append-only after creation).
- **Production Batches never store `remaining_quantity`.** Remaining is always calculated.
- **Sale Batch Consumption** is the append-only record of every FIFO consumption. Never edited. Never deleted.
- **Finished Goods are derived** from Production Batches minus Sale Batch Consumptions. They are an aggregated view, not an independent inventory ledger.
- Every Production Execution creates exactly one Production Batch.
- Finished Goods available quantity must always be calculated:

  ```
  Remaining Quantity (per batch) =
    Produced Quantity − SUM(Sale Batch Consumptions)

  Available Quantity =
    SUM(Remaining Quantity of active batches)
  ```

  Equivalent: `SUM(Produced − Consumed)` over eligible batches.

- **Never duplicate** finished-goods quantities at the product level as a second source of truth.
- **Sales never modifies Production Batch rows.** Sales only inserts Sale Batch Consumption records.
- **Sales consumes Recipes only through the Assembly `recipe_role` model** (`recipe_components.component_recipe_id`, FIFO-allocated from pre-produced Finished Goods) — see [ADR-0001](docs/decisions/0001-sales-consume-recipes-and-raw-materials-via-assembly-model.md). Sales never consumes a Recipe any other way.
- **Sales consumes Raw Materials only through that same model's `recipe_components.ingredient_id`** (raw, no-cook Assembly add-ins that never go through Production) — same ADR. Outside that narrow, explicitly-declared path, Production Execution remains the exclusive module allowed to deduct Raw Materials; this exception reuses Production Execution's own internal decrement primitive and the one shared `stock_movements` ledger — it does not invent a second stock ledger.
- **FIFO** (oldest available batch first) is the default allocation strategy.
- Batch selection is internal. Users do not manually choose which batch to sell from.
- Each batch stores its own immutable `unit_cost` at creation for later margin and profitability reporting.
- **COGS** comes from Sale Batch Consumption records only — never from Production Batch alone, Finished Goods average, or Recipe.

### Stock mutation authority

| Action | Allowed module(s) |
|---|---|
| Increase raw material stock | Purchases (always; manual purchases must remain possible) |
| Deduct raw materials | Production Execution only |
| Create finished goods stock (via immutable Production Batch) | Production Execution only |
| Deduct finished goods (via Sale Batch Consumption) | Sales only |

Rules:

- Recipes **never** modify inventory.
- Production Planning **never** modifies inventory.
- Production Execution is the **only** module allowed to deduct raw materials.
- Production Execution is the **only** module allowed to create Production Batches.
- Sales is the **only** module allowed to deduct finished goods, and it does so by appending Sale Batch Consumption records under automatic FIFO — **never** by updating Production Batches.
- Purchases always increase raw material inventory.
- Manual Purchases must always remain possible.
- Production Planning is optional.

### Future Production split

Production has two logical stages:

1. **Production Planning** — planning only; no inventory changes.
2. **Production Execution** — actual production: deduct raw materials, create exactly one immutable Production Batch, set that batch's `unit_cost`.

### Future Finished Goods module

Finished Goods will become a dedicated module between Production Execution and Sales. It aggregates produced − consumed availability; it does not own duplicated product quantities and never stores inventory.

```
Production Execution → Production Batch → Finished Goods (view) → Sales (Sale Batch Consumption)
```

Document and design for that separation. Do not implement the module until the roadmap reaches it.

**Canonical specifications:** [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md), [`docs/FINISHED_GOODS.md`](docs/FINISHED_GOODS.md)

That Finished Goods spec locks:

- list and batch-detail display fields
- automatic Production Status (`Available` / `Low Stock` / `Out of Stock`)
- available quantity and weighted-average cost formulas (from calculated remaining)
- field origin map
- allowed vs forbidden actions (read-only module)
- edge cases and future integrations

When implementing Finished Goods, follow those documents. Never introduce a product-level finished-goods stock ledger. Never store `remaining_quantity` on batches.

### Future Sales module

Sales records completed customer transactions. It is the **only** module allowed to deduct finished goods, and it does so by creating immutable **Sale Batch Consumption** records under automatic FIFO — never by mutating Production Batches.

**Canonical specifications:** [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md), [`docs/SALES.md`](docs/SALES.md)

That Sales spec locks:

- sales workflow (draft → validate → FIFO → complete → append Sale Batch Consumptions → Finished Goods recalculation by derivation)
- sale document and sale line fields
- FIFO algorithm and Sale Batch Consumption layers
- COGS from Sale Batch Consumption only (never Production Batch alone, Finished Goods average, recipe, or inventory)
- gross profit = revenue − COGS
- status transitions (Draft / Completed / Cancelled / Refunded future)
- validation, concurrency, and idempotency rules
- returns as a separate process (do not immediately restore batch quantities by editing a sale)
- permissions and integrations (Finished Goods, Production, Reports, Accounting, future POS)

When implementing Sales, follow those documents. Never allow manual batch selection, manual COGS, Inventory mutation, or Production Batch updates from Sales.

### Transaction and reuse discipline

- Every inventory modification must use database transactions.
- Business logic must not be duplicated across features.
- Prefer reusable UI components whenever the interaction is shared.

---

## Clean Architecture Rules

### Services

- Supabase queries belong **only** inside services.
- Never query Supabase inside components.
- Never query Supabase inside pages.
- Services return typed `ServiceResult<T>` from `@/types/service`.
- Services map and normalize errors into user-safe strings.
- Services may enrich rows with relations; components must not re-implement join logic.

### Hooks

- Hooks own loading, error, filters, modal state, and mutation orchestration.
- Hooks call services; they do not contain raw database access.
- Hooks expose a clean API to pages/components.

### Components

- Components remain presentational whenever possible.
- Components may hold local form field state.
- Components must not contain business rules that belong in hooks/services.
- Prefer reusable shared UI in `src/components` only when truly cross-feature.

### Types

- Prefer `interface` for object shapes.
- Never use `any`.
- Avoid unnecessary `unknown` casts.
- Feature-specific types stay in the feature.
- Cross-module contracts stay in `src/types`.

---

## Coding Standards

Always:

- use TypeScript
- use strict typing
- prefer interfaces
- keep files focused and small
- extract reusable hooks/components/services
- write production-ready code
- match existing naming and style
- explain created files after implementation

Never:

- duplicate logic
- duplicate UI
- hardcode environment values
- create huge files
- mix UI and database logic
- leave placeholder implementations
- invent parallel architectures for the same concern
- bypass the transaction model for stock or money movements
- create a separate Finance or Taxes module — those capabilities belong in Accounting

---

## Transaction-First Rule

The ERP is transaction-centric.

Every future operation of these types must eventually create a `Transaction`:

- Purchase
- Sale
- Production
- Waste
- Transfer
- Inventory Adjustment
- Salary
- Tax
- Expense
- Refund

Rules for agents:

1. Do not invent a second ledger for money or stock.
2. Do not permanently update stock in a way that cannot later emit `stock_movements`.
3. Do not implement accounting shortcuts that cannot become double-entry later.
4. Use shared contracts in `src/types/transactions.ts` and `src/types/accounting.ts`.
5. Until a module reaches its roadmap phase, define contracts only — do not fake unfinished business logic.

---

## Database Rules

Current live tables:

- `ingredients`
- `ingredient_categories`
- `suppliers`

Rules:

1. Do not destroy existing tables.
2. Prefer additive schema changes.
3. Database access only through services.
4. Plan for future tables listed in `PROJECT.md`.
5. Treat `stock_movements` and `transactions` as future sources of truth for quantity and business events.
6. Keep `ingredients.current_stock` as a read-optimized field until movement posting exists; do not scatter ad-hoc stock math across UI.

---

## Inventory Reference Standard

Inventory is the quality benchmark for every future module.

Required capabilities in Inventory:

- CRUD
- search
- filters
- stock warnings
- supplier linkage
- category linkage
- unit
- minimum stock
- typed interfaces
- service layer
- modal validation
- dashboard layout integration

When building a new module, copy Inventory's architectural pattern — not its domain names blindly.

Future Inventory evolution must preserve current UX unless redesign is explicitly requested.

---

## Module Implementation Checklist

Before marking a module ready:

1. Feature folder uses `components / hooks / services / types / page`
2. Route file is thin
3. No Supabase usage outside services
4. Strict TypeScript interfaces exist
5. Table UX includes search, sorting, pagination, loading, empty, error
6. Modals include validation, cancel, save
7. Mutations go through services and typed inputs
8. No duplicated shared logic
9. No broken existing features
10. Architecture remains transaction-ready

---

## ERP Module Responsibilities

| Module | Build when | Responsibility |
|---|---|---|
| Dashboard | Live | Cross-module operational overview |
| Inventory | Now / reference | Ingredient stock master and CRUD |
| Products | Next | Sellable catalog |
| Recipes | After Products | BOM, cost, allergens |
| Suppliers | After core ops | Vendor master beyond inventory lookups |
| Purchases | After Sales foundation | Receiving, cost, stock inflow |
| Production Planning | After Purchases/Recipes readiness | Planning only; no inventory mutation |
| Production Execution | After Production Planning readiness | Deduct raw materials; create immutable Production Batches |
| Finished Goods | After Production Execution | Read-only aggregated sellable availability from Produced − Consumed — see `docs/FINISHED_GOODS.md`, `docs/BATCH_CONSUMPTION.md` |
| Sales | After Recipes / Finished Goods readiness | Revenue events and append-only Sale Batch Consumption (FIFO) — see `docs/SALES.md`, `docs/BATCH_CONSUMPTION.md` |
| Customers | After Sales needs deepen | Customer master and history |
| Events | After master data expansion | Catering / market / service context |
| Accounting | After money movement exists | Sole financial module: VAT, taxes, bank accounts, GL, journal entries, Balance Sheet, P&L, Cash Flow, fixed assets, payroll integration, financial reports — see `docs/ACCOUNTING.md`, `docs/ACCOUNTING_DATA_MODEL.md` |
| Reports | After enough domain data exists | Cross-module analytics |
| AI | After stable operational core | Assistive automation through services |

Canonical registry: `src/constants/modules.ts`.
Module foundation: `docs/MODULE_FOUNDATION.md`.

Do not implement modules out of roadmap order unless explicitly instructed.
Do not reintroduce a separate Finance or Taxes module.

---

## Accounting Preparation Rules

Accounting is the sole financial home.

**Canonical specifications:** [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md), [`docs/ACCOUNTING_DATA_MODEL.md`](docs/ACCOUNTING_DATA_MODEL.md)

Required financial flow:

```
Business Event → Posting Engine → Journal Entry → Ledger → Financial Reports
```

Rules:

1. Operational modules (Inventory, Purchases, Production, Sales, Finished Goods) **never write** accounting tables.
2. Operational modules **only emit** Accounting Business Events with money facts.
3. Accounting owns Chart of Accounts, journals, ledger, posting rules, fiscal periods, currencies/FX, VAT, and statements.
4. Accounting knows accounts, journals, ledger entries, currencies, amounts, and posting rules — **not** Inventory, Recipes, Products, Production, or Sales UI.
5. Do not implement posting engines, Accounting SQL, RPCs, or UI until the roadmap reaches Accounting.
6. Do not create a separate Finance or Taxes module.

When touching money or stock:

- keep amounts explicit (transaction + base currency where relevant)
- keep timestamps explicit
- keep reference ids explicit
- keep reversal/refund as first-class future concepts
- design for event emission, not direct journal writes

---

## AI Integration Rules

AI is future capability, not current truth.

When AI work begins:

- AI may propose
- services commit
- users confirm risky actions
- transactions and stock movements remain mandatory
- OCR and forecasting never skip validation

---

## UI Rules

Design language:

- Stripe
- Linear
- Notion
- Vercel Dashboard

Style:

- minimal
- professional
- clean

Use Tailwind.
Do not introduce a second design system.
Preserve the existing dashboard shell and visual language unless explicitly asked to redesign.

### Tables

Every table supports:

- search
- sorting
- pagination
- loading
- empty state
- error state

### Modals

Every modal supports:

- validation
- cancel
- save

---

## Recipes / Purchases Domain Expectations

### Recipes

Must eventually calculate:

- cost
- allergens
- nutrition (future)

### Purchases

Must eventually:

- increase stock through movements
- update average or batch cost
- save invoice references
- create a purchase Transaction

---

## Quality Bar

Always write production-ready code.

Never generate placeholder business logic.

Never leave `TODO` stubs as fake completion.

Never ship a module that looks complete but bypasses services/types.

After implementation, explain:

- which files were created
- which files were changed
- how the feature fits the ERP architecture

---

## Decision Guide for Agents

If unsure:

1. Follow Inventory's structure.
2. Keep the change additive.
3. Put database code in services.
4. Put UI state in hooks.
5. Keep components presentational.
6. Prefer shared contracts over duplication.
7. Do not break auth, dashboard, or inventory.
8. Do not invent scope outside the current roadmap item.
9. Put all financial capabilities in Accounting — never spawn Finance/Taxes modules.
10. Respect Architecture Freeze v1.0 (`docs/ARCHITECTURE_FREEZE_V1.md`) — never redefine core architecture through implementation alone.

If a request conflicts with this charter or the Architecture Freeze, protect architecture and ask for explicit confirmation before destructive changes.
