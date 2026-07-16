# AGENTS.md

# Crepe'n Roll OS — Agent Development Charter

This file is the operating manual for every AI agent and engineer working on Crepe'n Roll OS.

Read `PROJECT.md` for product vision and system design.
Read `ROADMAP.md` for sequencing.
Follow this file for implementation rules.

---

## Project Vision

Crepe'n Roll OS is a commercial ERP platform for small and medium food businesses.

Target customers:

- food trucks
- catering companies
- restaurants
- multi-location kitchens

It must eventually support:

- Inventory
- Products
- Recipes
- Sales
- Purchases
- Production
- Events
- Suppliers
- Customers
- Accounting
- Finance
- Taxes
- VAT
- Payroll
- Reports
- AI Assistant

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
  constants/                # Shared constants
  features/<module>/        # Domain modules
    components/
    hooks/
    services/
    types/
    page/
  hooks/                    # Shared hooks only
  lib/                      # Infrastructure utilities
  types/                    # Cross-domain contracts
```

### Feature ownership

Each feature owns its own:

- `components/` — presentational UI
- `hooks/` — UI state and orchestration
- `services/` — database access
- `types/` — feature interfaces
- `page/` — page composition used by `app/`

### Route rule

`src/app/**/page.tsx` must stay thin:

- import feature page
- wrap with auth guard when required
- no business logic
- no Supabase queries

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
| Inventory | Now / reference | Ingredient stock master and CRUD |
| Products | Next | Sellable catalog |
| Recipes | After Products | BOM, cost, allergens |
| Sales | After Recipes | Revenue events and stock outflow |
| Purchases | After Sales foundation | Receiving, cost, stock inflow |
| Production | After Purchases/Recipes readiness | Transform ingredients into products |
| Suppliers | Dedicated module after core ops | Vendor master beyond inventory lookups |
| Customers | After Sales needs deepen | Customer master and history |
| Finance | After money movement exists | Payments and cash views |
| Accounting | After Finance spine | GL and double-entry |
| Taxes | After Accounting foundations | VAT and tax periods |
| Reports | After enough domain data exists | Cross-module analytics |
| AI | After stable operational core | Assistive automation through services |

Do not implement modules out of roadmap order unless explicitly instructed.

---

## Accounting Preparation Rules

Prepare for:

- General Ledger
- Double-entry bookkeeping
- Balance Sheet
- Profit & Loss
- Cash Flow
- VAT reporting
- Income Tax

Do not implement accounting engines until the roadmap reaches Accounting.

When touching money or stock:

- keep amounts explicit
- keep timestamps explicit
- keep reference ids explicit
- keep reversal/refund as first-class future concepts

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

If a request conflicts with this charter, protect architecture and ask for explicit confirmation before destructive changes.
