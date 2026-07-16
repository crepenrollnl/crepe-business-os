# ROADMAP

Crepe'n Roll OS development roadmap.

This roadmap is sequenced for a commercial ERP build:

1. stabilize operations foundation
2. unlock sellable catalog and costing
3. introduce money and stock flows
4. close the loop with finance, accounting, taxes
5. add intelligence last

Do not reorder phases without explicit product decision.

---

## Priority Order

1. Inventory
2. Products
3. Recipes
4. Sales
5. Purchases
6. Production
7. Suppliers
8. Customers
9. Finance
10. Accounting
11. Taxes
12. Reports
13. AI

---

## Phase 0 — Platform Foundation

**Status:** Complete

- Next.js app shell
- Supabase client
- authentication
- dashboard layout
- feature-based folder structure
- architecture documentation

---

## Phase 1 — Inventory (Reference Module)

**Status:** In progress / near-complete

### Sprint 1 — Project setup
Complete

### Sprint 2 — Authentication
Complete

### Sprint 3 — Inventory list
Complete

### Sprint 4 — Inventory CRUD
Current

Delivered:

- ingredient list
- search and category filters
- create / edit / delete
- category and supplier relations
- typed services, hooks, components

Remaining hardening (before leaving Inventory):

- sorting
- pagination
- stronger stock warning UX
- prepare for future stock movement posting without UI rewrite

Exit criteria:

- Inventory is the documented quality standard
- no Supabase access outside services
- CRUD is production-ready

---

## Phase 2 — Catalog & Costing

### Sprint 5 — Products
- product master data
- product types (sellable, production output)
- price fields
- active/inactive state
- product list with Inventory-grade table UX

### Sprint 6 — Recipes
- recipe headers linked to products
- recipe items linked to ingredients
- automatic recipe cost calculation
- allergen aggregation
- recipe CRUD

Exit criteria:

- a product can have a recipe
- recipe cost is derived from ingredient costs
- no manual duplicated costing logic in UI

---

## Phase 3 — Core Commercial Flow

### Sprint 7 — Sales
- customers-lite or guest sales support as needed
- sales headers and sale items
- stock decrease path designed for `stock_movements`
- sale Transaction contract integration
- basic sales list + detail

### Sprint 8 — Purchases
- purchase headers and purchase items
- supplier invoice reference
- stock increase path
- average/batch cost update strategy
- purchase Transaction contract integration

### Sprint 9 — Production
- production orders
- consume recipe ingredients
- produce finished goods / products
- production Transaction + stock movements design
- production list + execution flow

Exit criteria:

- buy → produce → sell loop is operationally coherent
- every stock change has a future-safe movement model
- every commercial operation maps to a Transaction type

---

## Phase 4 — Master Data Expansion

### Sprint 10 — Suppliers module
- dedicated suppliers feature UI
- contacts and notes readiness
- purchase history views
- move beyond inventory lookup-only usage

### Sprint 11 — Customers module
- customer master
- sales history
- receivables readiness
- event/catering customer links

### Sprint 12 — Events
- event records for catering/markets
- link sales and production to events
- event-level operational views

Exit criteria:

- supplier and customer data are first-class modules
- events can contextualize sales/production

---

## Phase 5 — Finance Core

### Sprint 13 — Finance
- payments
- payment methods
- cash/bank balances readiness
- link payments to sales, purchases, expenses

### Sprint 14 — Accounting foundation
- chart of accounts (`accounts`)
- journal entry model
- transaction → journal posting contracts
- double-entry invariants

### Sprint 15 — Accounting statements
- General Ledger views
- Trial Balance
- Profit & Loss
- Balance Sheet
- Cash Flow projections

### Sprint 16 — Taxes
- tax rates
- VAT periods
- VAT reports
- income tax readiness exports

Exit criteria:

- no operational money flow bypasses transactions
- accounting can explain balances from journal entries
- VAT can be reported from posted periods

---

## Phase 6 — Insight & Intelligence

### Sprint 17 — Reports
- inventory valuation
- product margin
- purchase and sales summaries
- production ranking
- finance overview reports

### Sprint 18 — Stock intelligence hardening
- `stock_movements` fully enforced
- `stock_batches` where needed
- waste / transfer / adjustment flows
- inventory history screens

### Sprint 19 — AI assistance
- invoice OCR proposals
- purchase recognition drafts
- reorder suggestions
- demand forecasting pilots

### Sprint 20 — AI Assistant
- conversational operational assistant
- grounded answers from ERP data
- action proposals through existing services only

Exit criteria:

- reports are reliable projections, not isolated calculations
- AI never becomes a second source of truth

---

## Cross-Cutting Work (Continuous)

These run alongside feature sprints when needed:

- shared UI primitives for tables/modals
- shared `ServiceResult` and error patterns
- transaction and accounting contract evolution
- additive database migrations
- auth/permission hardening
- performance and pagination discipline
- documentation updates in `PROJECT.md` / `AGENTS.md`

---

## Near-Term Execution Plan

### Now
Sprint 4 completion: Inventory reference hardening

### Next
Sprint 5: Products

### Then
Sprint 6: Recipes

### Do not start yet
- Accounting engines
- VAT filing
- AI OCR
- Payroll

---

## Dependency Rules

- Products before deep Sales catalog work
- Recipes before Production consumption logic
- Sales/Purchases before Finance payments maturity
- Finance before Accounting statement trust
- Accounting before Tax filing
- Stable operational data before AI

If a future request skips a dependency, implement only the minimum typed contracts required and keep unfinished business logic out of production paths.
