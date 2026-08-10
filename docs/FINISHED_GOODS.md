# Finished Goods Module Specification

**Status:** Specification only — not implemented  
**Audience:** Engineers and AI agents implementing Finished Goods  
**Related:** `docs/BATCH_CONSUMPTION.md` (canonical immutable consumption architecture), `ROADMAP.md` (Production Batch Architecture), `AGENTS.md` (stock mutation authority), `PROJECT.md` (module responsibilities), `docs/SALES.md`

This document is the complete operational specification for the Finished Goods module. It does not authorize schema creation, migrations, or application code until a roadmap sprint explicitly starts implementation.

**Consumption / remaining-quantity rules** are owned by [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md). When documents disagree, that architecture wins.

---

## 1. Purpose

Finished Goods represents **products available for sale**.

It is **not** a warehouse ledger and **not** a second inventory.

It is an **aggregated operational view** built from **immutable Production Batches** and **Sale Batch Consumptions** (Produced − Consumed).

| Principle | Rule |
|---|---|
| Source of produced qty / unit cost | Immutable Production Batches |
| Source of consumption | Append-only Sale Batch Consumptions |
| Display role | Read-only aggregated availability and cost |
| Quantity | Always calculated; never stored as a product-level total; never stored as batch `remaining_quantity` |
| Mutations | Forbidden in this module |
| Consumers | Sales (FIFO via consumptions), Reports, Purchase Planning, Inventory Valuation |

### What Finished Goods is

- A product-centric screen of sellable availability
- A drill-down into production batch history for each product
- A bridge between Production Execution and Sales

### What Finished Goods is not

- Not a stock table with editable quantities
- Not a place to create, merge, split, or reorder batches
- Not a raw-materials view (that is Inventory)
- Not a product catalog editor (that is Products)
- Not an owner of mutable remaining quantities

---

## 2. Position in the ERP Flow

```
Purchases
    ↓
Inventory (raw materials)
    ↓
Recipes
    ↓
Production Planning (optional, no stock change)
    ↓
Production Execution
    ↓
Production Batch  ← immutable historical event
    ↓
Finished Goods    ← aggregated read model (this module)
    ↓
Sales (append Sale Batch Consumption — FIFO)
    ↓
Reports / Accounting projections
```

Canonical chain:

```
Production Execution → Production Batch → Finished Goods (view) → Sales (Sale Batch Consumption)
```

---

## 3. Core Domain Rules

1. **Production Batches are immutable** after creation. Sales never updates them.
2. **Remaining Quantity is never stored.** It is always calculated (see §7.1 and `docs/BATCH_CONSUMPTION.md`).
3. **Finished Goods never owns an independent stock table** and never stores inventory.
4. Every displayed quantity for a product is:

   ```
   Remaining Quantity (batch) =
     Produced Quantity − SUM(Sale Batch Consumptions for that batch)

   Current Available Quantity =
     SUM(Remaining Quantity of all Active Production Batches for that product)
   ```

   Equivalent:

   ```
   Available Quantity = SUM(Produced − Consumed)
   ```

5. **Never duplicate** available quantity onto the product master as a writable second source of truth.
6. Users **never** choose which batch to sell from. FIFO allocation is internal to Sales.
7. Creating stock for finished goods happens **only** in Production Execution (one immutable batch per execution).
8. Deducting finished goods happens **only** in Sales (by appending Sale Batch Consumption records FIFO).
9. Recipes never modify finished-goods availability.
10. Production Planning never modifies finished-goods availability.

---

## 4. Data Model (Logical)

Documentation of logical entities only. No physical tables are created by this specification.

### 4.1 Product (master — owned by Products)

Fields Finished Goods reads:

| Field | Role in Finished Goods |
|---|---|
| `id` | Aggregation key (`finished_good_id` on batches) |
| `name` | Display |
| `sku` | Display / search |
| `category` | Display / filter (via product category when available) |
| `unit` | Display (sellable / yield unit) |
| `status` | Include only sellable/active products in the default list |
| `minimum_available` (future) | Threshold for Low Stock production status |

Products remain the catalog owner. Finished Goods does not edit product master data.

### 4.2 Production Batch (immutable — owned by Production Execution)

Each Production Execution creates exactly one Production Batch. After creation, Sales **never** modifies it.

| Field | Description |
|---|---|
| `id` | Batch identity |
| `production_order_id` | Traceability to Production Execution / order |
| `finished_good_id` | Produced product |
| `produced_quantity` | Original quantity created by execution |
| `unit_cost` | Actual production unit cost at creation (immutable) |
| `produced_at` | When the batch was produced |

Optional display / ops fields (still must not include stored remaining):

| Field | Description |
|---|---|
| `batch_number` | Human-readable batch number |
| archived flag | Soft-archive for history |
| `created_at` | Audit |

**Explicitly removed / forbidden as a stored field:** `remaining_quantity`.

Derived per batch:

```
Remaining Quantity =
  produced_quantity − SUM(Sale Batch Consumption.quantity for this batch)

Batch Status =
  Archived | Depleted (remaining = 0) | Active (remaining > 0)
```

`produced_quantity` must be > 0 for a valid batch.

### 4.3 Sale Batch Consumption (append-only — owned by Sales)

Finished Goods **reads** consumptions to calculate remaining. It never writes them.

Canonical fields: see `docs/BATCH_CONSUMPTION.md` (`id`, `sale_line_id`, `production_batch_id`, `quantity`, `unit_cost`, `total_cost`, `created_at`).

### 4.4 Finished Goods row (derived — never persisted as stock)

One logical row per product in the Finished Goods list:

| Display field | Origin |
|---|---|
| Product Name | Products.`name` |
| SKU | Products.`sku` |
| Category | Products category relation |
| Unit | Products.`unit` (or recipe yield unit if product unit is defined that way) |
| Current Available Quantity | Σ calculated Remaining Quantity of Active batches |
| Number of Active Production Batches | COUNT of Active batches for the product |
| Average Production Cost | Weighted average (§7) |
| Oldest Batch Date | MIN(`produced_at`) of Active batches |
| Newest Batch Date | MAX(`produced_at`) of Active batches |
| Production Status | Calculated (§5) |

There is **no** `finished_goods` stock table and **no** `products.current_stock` write path for this module.

---

## 5. Production Status (Product Level)

Production Status is calculated automatically. It is **never editable** in Finished Goods.

### 5.1 Status values

| Status | Meaning |
|---|---|
| **Available** | Enough calculated remaining relative to the product threshold |
| **Low Stock** | Some quantity remains, but at or below the product threshold |
| **Out of Stock** | No remaining quantity from Active batches |

### 5.2 Calculation rules

Let:

- `Q` = Current Available Quantity (sum of Active batch calculated remainings)
- `M` = Product minimum available quantity (`minimum_available`), when defined

Rules:

```
if Q <= 0:
  Production Status = Out of Stock
else if M is defined and Q <= M:
  Production Status = Low Stock
else:
  Production Status = Available
```

### 5.3 Threshold ownership

- `minimum_available` belongs to the **Products** master (future field), analogous to Inventory `minimum_stock`.
- Finished Goods only **reads** the threshold.
- If `minimum_available` is null/undefined:
  - `Q > 0` → **Available**
  - `Q <= 0` → **Out of Stock**
  - **Low Stock** is not assigned until a threshold exists

### 5.4 Non-rules

- Status is not stored on the product as authoritative state.
- Status is not manually overridden in Finished Goods.
- Depleted or archived batches do not keep a product “Available”.

---

## 6. Batch Status (Batch Level)

Used on the product detail / batch history view. Status is **derived** from calculated remaining — not from a mutable stored remaining field.

| Batch status | Definition | Included in Available Quantity? |
|---|---|---|
| **Active** | Not archived AND calculated Remaining Quantity > 0 | Yes |
| **Depleted** | Not archived AND calculated Remaining Quantity = 0 | No |
| **Archived** | Soft-archived / closed for history | No |

Notes:

- A batch appears Depleted when Sales has appended consumptions summing to `produced_quantity` (batch row itself is unchanged).
- Archived batches are historical only. They never contribute to availability or average cost.
- Fully consumed batches may remain visible in batch history as Depleted.

---

## 7. Quantity and Cost Formulas

### 7.1 Current Available Quantity

```
Remaining Quantity(batch) =
  batch.produced_quantity
  − SUM(Sale Batch Consumption.quantity where production_batch_id = batch.id)

Current Available Quantity(product) =
  SUM(Remaining Quantity(batch))
  for all batches where
    batch.finished_good_id = product.id
    AND batch is Active (not archived AND Remaining Quantity > 0)
```

Never store this sum as a writable product field. Never store Remaining Quantity on the batch.

### 7.2 Number of Active Production Batches

```
Active Batch Count(product) =
  COUNT(batches)
  where batch is Active for that product
```

### 7.3 Batch Unit Cost

```
Batch Unit Cost = Production Batch.unit_cost
```

(Immutable at creation. Historical COGS uses the snapshot on Sale Batch Consumption, not a later rewrite of the batch.)

### 7.4 Average Production Cost (weighted)

Average cost is the **calculated-remaining-weighted average** of Active batch unit costs.

```
Average Production Cost(product) =
  SUM( remaining_i × unit_cost_i )
  /
  SUM( remaining_i )
```

for all Active batches `i` of the product, where `remaining_i` is calculated per §7.1.

#### Worked example

| Batch | Produced | Consumed | Remaining (calc) | Unit cost |
|---|---:|---:|---:|---:|
| #001 | 50 | 18 | 32 | €2.35 |
| #002 | 60 | 0 | 60 | €2.61 |

```
Numerator = (32 × 2.35) + (60 × 2.61) = 75.20 + 156.60 = 231.80
Denominator = 32 + 60 = 92
Average Production Cost = 231.80 / 92 = €2.5196… (display rounded per currency rules)
```

#### Edge case: no Active batches

Average Production Cost is **null / not applicable** (display as "—" or equivalent). Do not invent zero cost.

### 7.5 Oldest / Newest Batch Date

```
Oldest Batch Date = MIN(produced_at) of Active batches
Newest Batch Date = MAX(produced_at) of Active batches
```

If there are no Active batches, both are null.

---

## 8. Field Origin Map

Every Finished Goods display field and its exact origin:

| Display field | Origin | Storage |
|---|---|---|
| Product Name | Products.`name` | Master data |
| SKU | Products.`sku` | Master data |
| Category | Products → category | Master data |
| Unit | Products.`unit` | Master data |
| Current Available Quantity | Σ calculated Remaining (Produced − Consumed), Active | Calculated |
| Number of Active Production Batches | COUNT Active Production Batches | Calculated |
| Average Production Cost | Weighted formula §7.4 from batch `unit_cost` × calculated remaining | Calculated |
| Oldest Batch Date | MIN Production Batch.`produced_at` (Active) | Calculated |
| Newest Batch Date | MAX Production Batch.`produced_at` (Active) | Calculated |
| Production Status | Rules in §5 from quantity + threshold | Calculated |
| Batch Number (detail) | Production Batch.`batch_number` (optional) | Batch row |
| Production Date (detail) | Production Batch.`produced_at` | Batch row |
| Produced Quantity (detail) | Production Batch.`produced_quantity` | Batch row |
| Remaining Quantity (detail) | Produced − SUM(consumptions) | **Calculated only** |
| Unit Cost (detail) | Production Batch.`unit_cost` | Batch row |
| Batch Status (detail) | Derived from calculated remaining + archive (§6) | Derived |

---

## 9. Screens and UX

Match Inventory-grade table UX (search, sort, pagination, loading, empty, error). Visual language follows the existing dashboard shell.

### 9.1 Finished Goods list

Columns:

1. Product Name
2. SKU
3. Category
4. Unit
5. Current Available Quantity
6. Number of Active Production Batches
7. Average Production Cost
8. Oldest Batch Date
9. Newest Batch Date
10. Production Status

Capabilities:

- View products
- Search (name, SKU)
- Filter (category, production status, optionally “has active batches”)
- Sort (name, quantity, average cost, oldest/newest batch date, status)
- Pagination
- Open product detail / batch history

Empty states:

- No products in catalog → guide to Products
- Products exist but none produced yet → guide to Production Execution
- Filters match nothing → clear filters

### 9.2 Product detail / batch history

Read-only. Opening a product shows its Production Batches.

Batch columns:

| Column | Notes |
|---|---|
| Batch Number | Display |
| Production Date | Display; default sort oldest → newest for FIFO clarity |
| Produced Quantity | Original batch size (immutable) |
| Remaining Quantity | **Calculated** Produced − Consumed |
| Unit Cost | Immutable batch unit cost |
| Status | Active / Depleted / Archived (derived) |

Rules:

- Entirely **read-only**
- No edit, delete, merge, split, or reorder controls
- Optionally show depleted/archived batches in a secondary section or filter, defaulting Active-first
- Link to Production Execution / production order reference when available (navigation only)

### 9.3 No create / edit modals for stock

Finished Goods has **no** “Add stock”, “Adjust quantity”, or “Edit cost” modals. Those actions do not belong here.

---

## 10. Allowed Actions

Users may:

- View Finished Goods list
- Search products
- Filter products
- Sort products
- Paginate results
- Open a product
- View batch history for a product
- Navigate to related Production Execution records (read-only links)

---

## 11. Forbidden Actions

Users cannot, from Finished Goods:

| Forbidden action | Correct owner |
|---|---|
| Create Finished Goods manually | Production Execution only |
| Edit available quantity | Not allowed anywhere as a direct edit; Sales appends consumptions; Production creates batches |
| Edit average or batch cost | Production Execution (`unit_cost` at creation); later accounting/cost adjustments if ever needed via controlled Transaction |
| Delete stock / delete availability | Not a user action; depletion via Sales consumptions / waste flows |
| Merge batches | Not supported |
| Split batches | Not supported |
| Change FIFO order | Not supported; FIFO is fixed policy |
| Create or edit Production Batches | Production Execution only (create); never edit remaining |
| Consume stock for a sale | Sales only (Sale Batch Consumption) |
| Store `remaining_quantity` on batches | Forbidden — calculated only |

Any UI control that implies the above must not be built.

---

## 12. Service and Feature Architecture (When Implemented)

Follow Inventory’s feature shape. Documentation of intended structure only:

```
src/features/finished-goods/
  components/     # list table, status badge, batch history table
  hooks/          # filters, sorting, pagination, detail selection
  services/       # read-only aggregation queries (batches + consumptions)
  types/          # FinishedGoodsRow, FinishedGoodsBatchRow, filters
  page/           # list + detail composition
```

Thin route:

```
src/app/.../finished-goods/page.tsx
```

### Service rules

- Supabase / DB access only inside services
- Services return `ServiceResult<T>`
- Services are **read-only** for this module
- Aggregation may be SQL views, RPCs, or service-side grouping — but must always compute from batches **and** consumptions
- Hooks own loading, error, filters, sort, pagination
- Components stay presentational

### Intended types (contracts only until implementation)

```
FinishedGoodsRow {
  product_id
  product_name
  sku
  category_name
  unit
  available_quantity          // calculated
  active_batch_count          // calculated
  average_production_cost     // calculated | null
  oldest_batch_date           // calculated | null
  newest_batch_date           // calculated | null
  production_status           // calculated: available | low_stock | out_of_stock
}

FinishedGoodsBatchRow {
  batch_id
  batch_number
  produced_at
  produced_quantity
  remaining_quantity          // CALCULATED — never a stored batch column
  unit_cost
  status                      // active | depleted | archived (derived)
  production_order_id
}
```

Do not implement these types ahead of the roadmap sprint unless a later task explicitly asks for contracts only.

---

## 13. Module Registry Note

When Finished Goods is implemented, add it to:

- `src/constants/modules.ts`
- Dashboard navigation
- `PROJECT.md` / `AGENTS.md` module tables

Suggested placement in the operational flow: **after Production, before Sales**.

It must not displace Inventory or Products. It is a distinct read module for sellable availability.

---

## 14. Future Integration

Documented for design continuity. Nothing in this section is implemented by this specification.

### 14.1 Production Execution

- Each successful execution creates exactly one **immutable** Production Batch.
- That batch immediately increases Finished Goods available quantity for the product (via calculated remaining = produced − 0 consumptions).
- `unit_cost` is captured at execution time and becomes the batch cost layer.
- Finished Goods refreshes from batches + consumptions; it does not receive a separate “stock create” API.

### 14.2 Sales

Full specification: [`docs/SALES.md`](SALES.md). Architecture: [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md).

- Sales appends Sale Batch Consumption records only (never recipes, never raw materials, never batch UPDATEs).
- Default allocation: **FIFO** — oldest Active batch by `produced_at` (then batch number / id as tie-breaker).
- Users never pick batches in the sale UI.
- Each sale line creates one or more consumption rows; Production Batch rows stay unchanged.
- Finished Goods available quantity and average cost update automatically because they are recalculated from Produced − Consumed.
- Sale COGS for margin reporting must use **Sale Batch Consumption** `total_cost` layers, not only the displayed average.
- Returns must not silently restock via sale edits; see Sales returns architecture.

### 14.3 Reporting

Reports may use Finished Goods aggregations for:

- Available sellable quantity by product
- Aged finished goods (oldest batch date)
- Production cost exposure (weighted average × available quantity)
- Batch utilization (consumed vs produced)

Reports must not invent a second stock total.

### 14.4 Inventory Valuation

Finished-goods valuation for operational / accounting prep:

```
Finished Goods Valuation(product) =
  SUM( remaining_i × unit_cost_i )
  for Active batches i
```

This equals:

```
Average Production Cost × Current Available Quantity
```

when the average is the weighted average defined in §7.4.

Raw-material Inventory valuation remains separate (ingredients / purchase layers). Never mix the two pools.

### 14.5 Purchase Planning

Finished Goods availability informs what still needs to be produced, which may drive:

- Production Planning quantities
- Ingredient shopping lists
- Purchase drafts for missing raw materials

Finished Goods does not create purchases. It only provides availability signals.

### 14.6 Accounting

Accounting remains the sole financial module. Finished Goods supplies operational quantity/cost layers that later COGS and valuation postings can explain. No parallel finance ledger is created here. Posted sale COGS comes from Sale Batch Consumption, not from this view alone.

---

## 15. Edge Cases

| Case | Expected behavior |
|---|---|
| **No production batches** | Available quantity = 0. Active batch count = 0. Average cost = null. Oldest/newest dates = null. Status = Out of Stock. Batch history empty with guidance to produce. |
| **All batches depleted** | Same as no Active batches for availability metrics. Depleted batches remain visible in history with calculated remaining 0. Status = Out of Stock. |
| **Single Active batch** | Available quantity = that batch’s calculated remaining. Average cost = that batch’s unit cost. Oldest date = newest date = that batch’s produced_at. Active count = 1. |
| **Multiple Active batches** | Sum calculated remainings; weighted average cost; oldest/newest from Active set; Active count = N. FIFO order is not user-editable. |
| **Negative stock attempt** | Forbidden. Sales must refuse allocation that would make calculated Remaining < 0. Finished Goods never displays negative availability; if data corruption appears, surface an error and block sales until corrected. |
| **Batch with zero remaining** | Status = Depleted. Excluded from available quantity, active count, average cost, and oldest/newest Active dates. Still listed in history. Batch row unchanged. |
| **Archived batch** | Excluded from all availability and cost aggregations. Visible only in historical views when history filter includes archived. Cannot be sold from. |
| **Returned products (future)** | Returns are a **separate business process** owned with Sales/Refunds — see [`docs/SALES.md`](SALES.md) §12. Returned goods must **not** immediately restore availability by editing a completed sale or mutating Production Batches. If a future restock disposition is approved, it appends compensating events under an explicit policy; Finished Goods then reflects updated calculated remainings. Do not create a separate “returned stock” pool that bypasses batches/consumptions. |
| **Product inactive/archived** | Default list may hide inactive products; detail may remain reachable from history links. Availability still calculated if batches exist, but sales eligibility is owned by Sales/Products rules. |
| **Consumed exceeds produced** | Integrity error. `SUM(consumptions) <= produced_quantity` must always hold. |
| **Cost missing** | Treat as data error for that batch; do not silently assume zero cost in valuation-critical views. |

---

## 16. Implementation Checklist (Future Sprint)

Do not mark Finished Goods complete until:

1. Feature folder uses `components / hooks / services / types / page`
2. Route file is thin
3. No Supabase usage outside services
4. Strict TypeScript interfaces exist
5. List UX includes search, sorting, pagination, loading, empty, error
6. Detail batch history is read-only
7. All quantities and costs are calculated from Production Batches **and** Sale Batch Consumptions
8. No stored `remaining_quantity` on batches
9. No create/edit/delete stock mutations exist in the module
10. Production Status is calculated, never editable
11. Existing Inventory, Products, Production, and Sales behaviors remain intact
12. Module is registered in navigation / `modules.ts` when shipped
13. Architecture remains transaction-ready (Sales appends consumptions; Production Execution creates batches)

---

## 17. Explicit Non-Goals (This Specification)

- No application code
- No database tables or migrations
- No UI implementation
- No Sales FIFO engine implementation
- No Production Execution implementation
- No Accounting posting
- No AI suggestions

---

## 18. Summary for Implementers

Finished Goods is a **read-only operational view**.

- **Truth (produced):** Immutable Production Batches  
- **Truth (consumed):** Append-only Sale Batch Consumptions  
- **Quantity:** `SUM(Produced − Consumed)` for Active batches  
- **Cost:** Calculated-remaining-weighted average of batch `unit_cost`  
- **Status:** Automatic Available / Low Stock / Out of Stock  
- **Detail:** Read-only batch history (remaining calculated)  
- **Mutations:** None — Production Execution creates batches; Sales appends consumptions  

If a proposed change stores product-level finished-goods stock independently, or stores mutable `remaining_quantity` on batches, reject it.
