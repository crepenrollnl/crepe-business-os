# ROADMAP

Crepe'n Roll OS development roadmap.

This roadmap is sequenced for a commercial ERP build:

1. stabilize operations foundation
2. unlock sellable catalog and costing
3. introduce money and stock flows
4. close the loop with Accounting
5. add intelligence last

Do not reorder phases without explicit product decision.

**Actual module status is tracked in [`src/constants/modules.ts`](src/constants/modules.ts) — the machine-readable source of truth.** This roadmap describes sequencing and scope; where its phase/sprint status labels conflict with `modules.ts`, `modules.ts` wins. (Last reconciled 02.09.2026 — Finished Goods, Sales POS/Quick Sale/header discount, BTW Report, and Sales by Product were live in code but missing or stale in the near-term status notes.)

**Architecture Freeze v1.0** is the official ERP Core baseline. All implementation in this roadmap must respect [`docs/ARCHITECTURE_FREEZE_V1.md`](docs/ARCHITECTURE_FREEZE_V1.md). Core architecture redesign requires an ADR — do not redefine architecture through implementation alone.

---

## Priority Order

1. Dashboard
2. Inventory
3. Products
4. Recipes
5. Suppliers
6. Purchases
7. Production
8. Sales
9. Customers
10. Events
11. Accounting
12. Reports
13. AI

Accounting is the sole financial module. There is no separate Finance or Taxes module.

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

**Status:** Complete. (Substantially more of the roadmap below is also live now than this phase-by-phase framing suggests — see `src/constants/modules.ts`.)

### Sprint 1 — Project setup
Complete

### Sprint 2 — Authentication
Complete

### Sprint 3 — Inventory list
Complete

### Sprint 4 — Inventory CRUD
Complete

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
- implement per [`docs/SALES.md`](docs/SALES.md) and [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md) (architecture locked before coding)
- customers-lite or guest sales support as needed
- sales headers, sale items, and append-only FIFO `sale_batch_consumptions` layers
- stock decrease path designed for `stock_movements` via Sale Batch Consumption (never mutate Production Batch remaining)
- automatic FIFO allocation; no manual batch selection; COGS from Sale Batch Consumption only
- sale Transaction contract integration
- basic sales list + detail (Draft editable; Completed locked)
- Returns / Refunded are future — do not auto-restore batches by editing completed sales

### Sprint 8 — Purchases
- purchase headers and purchase items
- supplier invoice reference
- stock increase path
- average/batch cost update strategy
- purchase Transaction contract integration

### Sprint 9 — Production
- production orders
- consume recipe ingredients
- produce finished goods / products via Production Batches
- production Transaction + stock movements design
- production list + execution flow

### Sprint 9b — Finished Goods (after Production Execution)
- read-only aggregated availability view from Produced − Consumed
- product list + batch history per `docs/FINISHED_GOODS.md` and `docs/BATCH_CONSUMPTION.md`
- calculated remaining quantity (never stored), weighted average cost, and production status
- no independent finished-goods stock table
- no manual create / edit / delete of availability

Exit criteria:

- buy → produce → sell loop is operationally coherent
- finished-goods availability is always calculable as Produced − SUM(Sale Batch Consumptions)
- Sales appends Sale Batch Consumptions FIFO per `docs/SALES.md` / `docs/BATCH_CONSUMPTION.md` and never mutates Production Batches or raw-material Inventory
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

## Phase 5 — Accounting

Accounting is the sole financial module. All VAT, tax, bank, GL, and statement work lives here.

**Architecture locked (DEV-086):** [`docs/ACCOUNTING.md`](docs/ACCOUNTING.md), [`docs/ACCOUNTING_DATA_MODEL.md`](docs/ACCOUNTING_DATA_MODEL.md)

Flow: Business Event → Posting Engine → Journal Entry → Ledger → Financial Reports.  
Operational modules emit events only; they never write accounting tables.

### Sprint 13 — Payments & bank accounts
- payments
- payment methods
- bank accounts
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

### Sprint 16 — VAT, taxes & extended finance
- tax rates
- VAT periods
- VAT reports
- income tax readiness exports
- fixed assets readiness
- payroll integration contracts

Exit criteria:

- no operational money flow bypasses transactions
- accounting can explain balances from journal entries
- VAT can be reported from posted periods
- no parallel Finance or Taxes feature modules exist

---

## Phase 6 — Insight & Intelligence

### Sprint 17 — Reports
- inventory valuation
- product margin
- purchase and sales summaries
- production ranking
- accounting overview reports (projected from Accounting contracts)

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

**Stale as a literal "what's next" list — see [`src/constants/modules.ts`](src/constants/modules.ts) for current status.** Recipes, Purchases, Production Planning, Production Execution, Sales, Finished Goods, and Reports are live; Accounting's core (chart of accounts, journals, ledger, posting engine, VAT) is live and wired into those modules, alongside live `/expenses` and `/fixed-assets` routes. Sales also has Quick Sale (`/sales/quick`, header discount) and tablet POS (`/pos`, direct URL). Reports also has BTW (`/reports/btw`) and Sales by Product (`/reports/sales-by-product`). Phase/sprint labels below are retained for history until this section is rewritten.

### Now
Wire remaining UI-less modules: Products, Customers, Events, a dedicated Suppliers UI, and a Users UI (`src/features/users`). Finished Goods is already live as an Inventory tab — do not treat it as an unbuilt screen. Live role checks already use `profiles` (sql/097); connecting a Users admin UI to Auth is still planned.

### Do not start yet
- AI OCR
- Payroll

---

## Dependency Rules

- Products before deep Sales catalog work
- Recipes before Production consumption logic
- Production Execution before Finished Goods implementation — both are live (`modules.ts`)
- Finished Goods before Sales relies on batch-derived availability UX — both are live; FG UI is the Inventory tab
- Sales architecture is specified in [`docs/SALES.md`](docs/SALES.md) and [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md); stock-consuming Sales (including Quick Sale, header discount, and `/pos`) is live and requires Production Batches
- Sales/Purchases before Accounting payments maturity
- Accounting foundation before statement trust
- Accounting before VAT filing
- Stable operational data before AI

If a future request skips a dependency, implement only the minimum typed contracts required and keep unfinished business logic out of production paths.

---

## Core Business Flow

This section documents the intended ERP operational workflow. It does not change phase order or sprint scope.

```
Raw Materials
    ↓
Purchases
    ↓
Inventory
    ↓
Recipes
    ↓
Production Planning
    ↓
Production Execution
    ↓
Finished Goods
    ↓
Sales
    ↓
Reports
```

### Business Concepts

#### Raw Materials

Raw materials are ingredients purchased and stored for production. They are managed in **Inventory**.

Examples:

- Flour
- Milk
- Chicken
- Cheese

#### Finished Goods

Finished goods are sellable products created by production. They are **not** a second inventory with independently stored quantities.

Finished Goods is an aggregated view of all active Production Batches (remaining calculated, never stored):

```
Chicken Crepe — Available 92 pcs
  ├── Batch #001 — Remaining 32 pcs  (produced 50 − consumed 18)
  └── Batch #002 — Remaining 60 pcs  (produced 60 − consumed 0)
```

The user normally sees only the total available quantity. Batch details are available only when requested.

Raw materials and finished goods are different stock domains. Purchases and production consume or create stock on the correct side; they must never be treated as one interchangeable stock pool.

### Future Production Split

The Production module consists of two logical stages.

#### Production Planning

- Planning only
- Schedules what will be produced
- Does **not** modify inventory

#### Production Execution

- Actual production
- Deducts raw materials from Inventory
- Creates exactly one **immutable** Production Batch
- Sets that batch’s `unit_cost` at creation

Production Planning is optional. Operators may execute production without a prior plan when the business process allows it.

### Finished Goods Module (live)

Finished Goods is live between Production and Sales (`modules.ts` `status: "live"`). UI is a read-only tab on `/inventory`, not a sidebar item. It presents calculated availability (Produced − Consumed); it does not own a duplicated quantity ledger and never stores inventory.

**Full module specification:** [`docs/FINISHED_GOODS.md`](docs/FINISHED_GOODS.md)  
**Consumption architecture:** [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md)

That Finished Goods document defines display fields, production status rules, quantity and weighted-average cost formulas, field origins, allowed/forbidden actions, batch detail UX, edge cases, and future integrations with Production Execution, Sales, Reports, Inventory Valuation, and Purchase Planning.

**Sales module specification:** [`docs/SALES.md`](docs/SALES.md)

That document defines the sales workflow, sale/line fields, FIFO algorithm, COGS and profit formulas, status transitions, validation, returns architecture, permissions, and integrations. Sales is the only consumer of finished-goods stock and follows that spec and `docs/BATCH_CONSUMPTION.md`. Live Sales surfaces also include Quick Sale (`/sales/quick`, header discount on the whole ticket) and tablet POS (`/pos`).

Live workflow:

```
Production Execution
    ↓
Production Batch (immutable historical event)
    ↓
Finished Goods (aggregated view: Produced − Consumed)
    ↓
Sales (append Sale Batch Consumption — FIFO)
```

Finished Goods and stock-consuming Sales are implemented. Keep finished-goods stock separable from raw-material Inventory and always calculable from Production Batches minus Sale Batch Consumptions. Implementation must follow `docs/FINISHED_GOODS.md`, `docs/SALES.md`, and `docs/BATCH_CONSUMPTION.md`.

---

## Production Batch Architecture

This section locks the Finished Goods and Production Batch model before Production Execution is implemented. Changing it later would force redesign of Production, Sales, and Reports.

Documentation and architecture only. No schema or application implementation in this decision.

**Architecture Freeze:** [`docs/ARCHITECTURE_FREEZE_V1.md`](docs/ARCHITECTURE_FREEZE_V1.md)  
**Canonical detail:** [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md)

### Decision

Finished Goods will be **batch-based** with **immutable Production Batches** and **append-only Sale Batch Consumption**.

The ERP will **not** store only product-level quantities as the source of truth.

The ERP will **not** store mutable `remaining_quantity` on Production Batches.

Every production run creates its own immutable Production Batch. Sales never updates that batch. Consumption is recorded as Sale Batch Consumption rows.

### Production Batch Concept

Every Production Execution creates exactly one Production Batch.

Each batch is an **immutable** manufacturing event and stores:

- `id`
- `production_order_id`
- `finished_good_id`
- `produced_quantity`
- `unit_cost`
- `produced_at`

**Removed / forbidden as a stored field:** `remaining_quantity`.

Future optional fields may include:

- Expiration Date
- Notes
- Waste
- Operator
- Human-readable batch number

### Remaining Quantity (Calculated Only)

```
Remaining Quantity =
  Produced Quantity
  − SUM(Sale Batch Consumptions)
```

This is the single approved formula. Remaining is never persisted on the batch.

### Sale Batch Consumption Concept

Every FIFO allocation creates immutable consumption records:

- `id`
- `sale_line_id`
- `production_batch_id`
- `quantity`
- `unit_cost`
- `total_cost`
- `created_at`

Never editable. Never deleted. Append-only. COGS comes from these records only.

### Finished Goods Concept

Finished Goods is **not** a second inventory.

It is an aggregated view of active Production Batches for each product. Available quantity is always calculated:

```
Available Quantity = SUM(Produced − Consumed)
```

Never store Finished Goods quantities independently. Duplicated product-level stock would diverge from batches and break costing, FIFO, and reporting.

### Batch-Based Inventory

| Layer | Role |
|---|---|
| Production Batch | Immutable source of produced quantity and unit cost |
| Sale Batch Consumption | Append-only FIFO consumption and COGS layers |
| Finished Goods | Read/aggregated view of Produced − Consumed |
| Sales | Appends consumptions only (never recipes, raw materials, or batch updates) |

Example:

| Batch | Product | Produced | Consumed | Remaining (calc) | Unit cost |
|---|---|---|---:|---:|---|
| #001 | Chicken Crepe | 50 | 18 | 32 pcs | €2.35 |
| #002 | Chicken Crepe | 60 | 0 | 60 pcs | €2.61 |
| **Available** | Chicken Crepe | | | **92 pcs** | (derived) |

### FIFO Sales Strategy

Sales consumes Recipes and Raw Materials only through the Assembly/Component `recipe_role` model (`recipe_components.component_recipe_id` / `.ingredient_id`) — see [ADR-0001](docs/decisions/0001-sales-consume-recipes-and-raw-materials-via-assembly-model.md). Outside that model, Sales never consumes a Recipe or Raw Material directly.

Sales **never** updates Production Batch rows.

Sales **only** appends Sale Batch Consumption records against Production Batches — for the `component_recipe_id` branch. For the `ingredient_id` branch, Sales decrements `ingredients.current_stock` directly (the same primitive Production Execution itself uses) and appends a `stock_movements` row instead of a Sale Batch Consumption row — see ADR-0001 for why this narrow exception exists.

Default allocation strategy: **FIFO** — oldest available batch first (by calculated remaining > 0).

Example:

```
Batch A — Produced 100
Sale 40 → SaleBatchConsumption { Batch A, 40 }
Sale 15 → SaleBatchConsumption { Batch A, 15 }
Calculated remaining = 100 − 55 = 45
(Batch A row unchanged)
```

The ERP selects batches automatically. Users do not manually choose batches. Batch selection remains an internal allocation concern.

**Full Sales specification:** [`docs/SALES.md`](docs/SALES.md) — workflow, document/line fields, exact FIFO algorithm, COGS from Sale Batch Consumption, profit (Revenue − COGS), status transitions, validation, returns (separate process; no immediate batch restore), permissions, and integrations.

### Costing

Each Production Batch stores its own immutable `unit_cost`.

Finished Goods displays a **calculated-remaining-weighted average** across Active batches. Exact formula:

```
Average Production Cost =
  SUM( remaining_i × unit_cost_i )
  /
  SUM( remaining_i )
```

where `remaining_i = produced_quantity_i − SUM(consumptions for batch i)`.

Full derivation, worked example, and valuation identity live in [`docs/FINISHED_GOODS.md`](docs/FINISHED_GOODS.md).

Sales COGS must use the **Sale Batch Consumption** layer costs (`total_cost`), not the Finished Goods average alone, not recipe cost, not inventory cost, and not Production Batch alone. See [`docs/SALES.md`](docs/SALES.md) and [`docs/BATCH_CONSUMPTION.md`](docs/BATCH_CONSUMPTION.md).

### Benefits

- Full audit trail
- Immutable production history
- Accurate FIFO traceability
- Future returns without rewriting production
- Accounting transparency
- Easier debugging
- Event-based architecture
- Better reporting

### Future Compatibility

This architecture must support, without redesign:

- FIFO allocation via Sale Batch Consumption
- Batch history
- Waste tracking
- Returns
- Expiration dates
- Production cost analysis
- Event profitability
- Finished Goods read-only operational module (`docs/FINISHED_GOODS.md`) — live as an Inventory tab
- Sales FIFO consumption, COGS, and returns architecture (`docs/SALES.md`, `docs/BATCH_CONSUMPTION.md`) — live, including Quick Sale header discount and tablet POS