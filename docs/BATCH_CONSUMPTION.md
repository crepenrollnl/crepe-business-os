# Immutable Production Batch & Sale Batch Consumption Architecture

**Status:** Architecture locked — documentation only; not implemented  
**Audience:** Engineers and AI agents designing Production, Finished Goods, Sales, Reports, and Accounting  
**Related:** `docs/FINISHED_GOODS.md`, `docs/SALES.md`, `ROADMAP.md`, `AGENTS.md`, `PROJECT.md`

This document is the **single approved architecture** for finished-goods stock consumption.

It replaces any earlier model that stored mutable `remaining_quantity` on Production Batches and allowed Sales to update batch rows.

---

## 1. Principle

**Production Batches are immutable.**

After a Production Batch is created by Production Execution, it is **never modified by Sales**.

Production Batches represent historical production events. They are **append-only**.

A sale never mutates a Production Batch.

Instead, Sales creates immutable **Sale Batch Consumption** records.

---

## 2. Canonical Flow

```
Production Execution
        ↓
Production Batch          ← immutable historical event
        ↓
Sale Batch Consumption    ← immutable FIFO consumption record
        ↓
Sales                     ← revenue document; never edits batches
```

Finished Goods remains a **read-only aggregated view** derived from produced quantities minus consumptions. It never stores inventory.

```
Production Execution → Production Batch → Finished Goods (view) → Sales (append consumptions)
```

---

## 3. Production Batch (Immutable)

Owned by **Production Execution**. Created once; never updated by Sales.

### Stored fields

| Field | Description |
|---|---|
| `id` | Batch identity |
| `production_order_id` | Traceability to Production Execution / order |
| `finished_good_id` | Produced sellable product |
| `produced_quantity` | Quantity created by this execution |
| `unit_cost` | Actual production unit cost at creation |
| `produced_at` | When the batch was produced |

### Explicitly removed

| Field | Status |
|---|---|
| `remaining_quantity` | **Never stored.** Calculated only (see §5). |

### Immutability rules

- Production Batches are **append-only historical events**.
- After creation, Sales **must not** update any Production Batch field.
- Cost, produced quantity, and production timestamp are frozen at creation.
- Optional display metadata (e.g. human-readable batch number) may exist for UX, but must not include a mutable remaining quantity.

---

## 4. Sale Batch Consumption (Append-Only)

Owned by **Sales** at completion time. Internal audit entity. Users never create or edit these rows.

### Stored fields

| Field | Description |
|---|---|
| `id` | Consumption identity |
| `sale_line_id` | Parent sale line |
| `production_batch_id` | Consumed Production Batch |
| `quantity` | Quantity consumed from that batch |
| `unit_cost` | Snapshot of batch unit cost at consumption time |
| `total_cost` | `quantity × unit_cost` (layer COGS) |
| `created_at` | Audit timestamp |

### Purpose

Stores every FIFO consumption **permanently**.

| Rule | Requirement |
|---|---|
| Editable | Never |
| Deletable | Never |
| Model | Append-only |
| Role | Sole permanent record of which batch units were sold |

### Invariants

```
For each completed sale line:
  SUM(Sale Batch Consumption.quantity) = sale_line.quantity

For each Production Batch:
  SUM(Sale Batch Consumption.quantity for that batch)
    <= Production Batch.produced_quantity
```

---

## 5. Remaining Quantity (Calculated Only)

**Remaining Quantity is never stored.**

Single approved formula:

```
Remaining Quantity =
  Produced Quantity
  − SUM(Sale Batch Consumption.quantity for that batch)
```

Derived batch status (not stored as authoritative mutable stock):

| Status | Definition |
|---|---|
| **Active** | Not archived AND Remaining Quantity > 0 |
| **Depleted** | Not archived AND Remaining Quantity = 0 |
| **Archived** | Soft-archived / closed for history; excluded from availability |

Never allow Remaining Quantity below zero. Allocation that would oversell must fail atomically.

---

## 6. Finished Goods

Finished Goods **never stores inventory**.

Available quantity for a product:

```
Available Quantity =
  SUM(
    Produced Quantity
    − SUM(Sale Batch Consumptions for that batch)
  )
  for all non-archived Production Batches of that product
  where calculated Remaining Quantity > 0
```

Equivalent form:

```
Available Quantity =
  SUM(Produced) − SUM(Consumed)
  over eligible batches for that finished good
```

Weighted average cost uses **calculated** remaining weights × each batch’s immutable `unit_cost`. See `docs/FINISHED_GOODS.md`.

---

## 7. FIFO (No Batch Mutation)

Sales selects batches automatically (oldest first). Users never pick batches.

For every consumed quantity, create a **Sale Batch Consumption** record.

### Example

```
Batch A
  Produced 100
  (immutable)

Sale 1 — quantity 40
  ↓
  SaleBatchConsumption { batch A, quantity 40 }

Sale 2 — quantity 15
  ↓
  SaleBatchConsumption { batch A, quantity 15 }

Batch A remains unchanged:
  produced_quantity = 100
  unit_cost = (unchanged)

Calculated remaining after both sales:
  100 − (40 + 15) = 45
```

### Allocation sketch (per sale line)

```
remaining_to_allocate = line.quantity

for each eligible batch in FIFO order:
  batch_remaining = produced_quantity − SUM(existing consumptions) − SUM(consumptions in this transaction)
  take = MIN(batch_remaining, remaining_to_allocate)

  INSERT SaleBatchConsumption {
    sale_line_id,
    production_batch_id,
    quantity: take,
    unit_cost: batch.unit_cost,
    total_cost: take × batch.unit_cost
  }

  remaining_to_allocate -= take

if remaining_to_allocate > 0:
  FAIL — Insufficient stock (abort entire sale completion)
```

**No** `UPDATE production_batches SET remaining_quantity = …`.

---

## 8. Cost Calculation (COGS)

COGS **must** be calculated from **Sale Batch Consumption** records.

| Allowed | Forbidden |
|---|---|
| `SUM(Sale Batch Consumption.total_cost)` | Reading Production Batch alone as posted COGS |
| Snapshot `unit_cost` on each consumption | Finished Goods displayed average alone as posted COGS |
| | Recipe theoretical cost |
| | Inventory / ingredient costs |
| | Manually typed COGS |

```
Line COGS =
  SUM(Sale Batch Consumption.total_cost for that sale line)

Sale COGS Total =
  SUM(Line COGS)
```

Gross profit remains:

```
Gross Profit = Revenue − COGS
```

---

## 9. Stock Mutation Authority (Finished Goods Side)

| Action | Allowed module(s) | Mechanism |
|---|---|---|
| Create finished-goods stock | Production Execution only | Insert immutable Production Batch |
| Deduct finished goods | Sales only | Insert immutable Sale Batch Consumption (FIFO) |
| Edit batch produced qty / unit cost after create | Forbidden (except future controlled correction Transaction, never silent Sales edit) | — |
| Write product-level finished-goods stock | Forbidden | — |

Sales **never** modifies Production Batch rows.

---

## 10. Benefits

| Benefit | Why |
|---|---|
| **Full audit trail** | Every sold unit maps to an immutable consumption row |
| **Immutable production history** | Production events stay historically accurate |
| **Accurate FIFO traceability** | Allocation layers are permanent and queryable |
| **Future returns** | Returns can append compensating events without rewriting production |
| **Accounting transparency** | COGS posts from consumption layers, not mutable balances |
| **Easier debugging** | Reconstruct remaining from produced − sum(consumptions) |
| **Event-based architecture** | Aligns with Transaction / stock_movement append-only design |
| **Better reporting** | Batch utilization, aging, margin by layer without reconstructing edits |

---

## 11. Backward Compatibility

The previous mutable model (`remaining_quantity` stored on Production Batch; Sales decreases it) is **retired**.

| Old concept | New concept |
|---|---|
| Stored `remaining_quantity` | Calculated Remaining Quantity (§5) |
| Sales updates batch rows | Sales inserts Sale Batch Consumption only |
| COGS inferred from batch mutation | COGS from Sale Batch Consumption |
| Finished Goods from stored remainings | Finished Goods from Produced − Consumed |

There must be **only one approved architecture** after this decision: immutable Production Batches + append-only Sale Batch Consumption.

---

## 12. Document Ownership

| Topic | Canonical document |
|---|---|
| Immutable batch + consumption model | **This file** (`docs/BATCH_CONSUMPTION.md`) |
| Finished Goods read model / UX | `docs/FINISHED_GOODS.md` |
| Sales workflow / FIFO / returns | `docs/SALES.md` |
| Roadmap sequencing | `ROADMAP.md` |
| Agent rules | `AGENTS.md` |
| Platform overview | `PROJECT.md` |

When documents disagree, **this architecture** wins for consumption and remaining-quantity rules.

---

## 13. Explicit Non-Goals (This Document)

- No application code  
- No database tables or migrations  
- No UI  
- No FIFO engine implementation  

---

## 14. Summary

- **Production Batch:** immutable production event (`produced_quantity`, `unit_cost`, …)  
- **Sale Batch Consumption:** append-only FIFO consumption + COGS layer  
- **Remaining:** always `Produced − SUM(Consumptions)` — never stored  
- **Finished Goods:** calculated availability; never stores inventory  
- **Sales:** never mutates Production Batches  
