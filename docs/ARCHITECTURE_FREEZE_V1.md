# Architecture Freeze v1.0 — ERP Core

**Status:** Frozen — official project baseline  
**Version:** 1.0  
**Audience:** Engineers and AI agents implementing any ERP module  
**Related:** `PROJECT.md`, `ROADMAP.md`, `AGENTS.md`, `docs/BATCH_CONSUMPTION.md`, `docs/FINISHED_GOODS.md`, `docs/SALES.md`

This document officially freezes the **ERP Core Architecture**.

From this point onward:

- New modules must follow the approved architecture.
- Core entities may not be redesigned without an Architecture Decision Record (ADR).
- Future work should focus on **implementation**, not redesign.

Detailed consumption rules remain in [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md).  
Finished Goods display rules remain in [`docs/FINISHED_GOODS.md`](FINISHED_GOODS.md).  
Sales workflow rules remain in [`docs/SALES.md`](SALES.md).

This freeze document is the **baseline authority** for the ERP Core. Those specs elaborate it; they must not contradict it.

---

## Purpose

The ERP Core Architecture has been designed and approved.

Implementation alone must never redefine architecture.

Any change to frozen rules requires the Architecture Change Policy below.

---

## Core Architecture (Frozen)

### Raw Materials

- Inventory stores **Raw Materials** only.
- Inventory **never** stores Finished Goods.

### Production Planning

- Planning calculates requirements.
- Planning **never** changes stock.
- Planning **never** creates accounting entries.

### Purchases

- Purchases increase **Raw Material** inventory only.
- Purchases **never** create Finished Goods.

### Production Execution

- Production Execution consumes Raw Materials.
- Production Execution creates immutable **Production Batches**.

### Production Batch

Production Batches are **immutable**.

Approved stored fields:

| Field | Description |
|---|---|
| `production_order_id` | Traceability to Production Execution / order |
| `finished_good_id` | Produced sellable product |
| `produced_quantity` | Quantity created by this execution |
| `unit_cost` | Actual production unit cost at creation |
| `produced_at` | When the batch was produced |

Rules:

- Production Batches are **append-only**.
- They are **never edited by Sales**.
- `remaining_quantity` is **never stored**.

### Sale Batch Consumption

Sale Batch Consumption is **immutable**.

It permanently records FIFO consumption.

Remaining Quantity is **never stored**.

```
Remaining =
  Produced
  − SUM(Sale Batch Consumption)
```

### Finished Goods

- Finished Goods is an **aggregated calculated view**.
- It is **NOT** a warehouse table.
- It is **NOT** a source of truth.
- It displays calculated availability only.

### Sales

- Sales consume Finished Goods through **FIFO**.
- Sales **never** edit Production Batches.
- Sales create immutable **Sale Batch Consumption** records.
- **COGS** comes only from Sale Batch Consumption.

---

## Frozen Business Rules

The following rules are now frozen:

1. Inventory contains Raw Materials only.
2. Finished Goods are calculated.
3. Production Batches are immutable.
4. Sale Batch Consumption is immutable.
5. FIFO is automatic.
6. Users never choose batches manually.
7. Users never edit calculated stock.
8. COGS always comes from consumed batches.
9. Remaining Quantity is calculated only.
10. No duplicated stock values.

---

## Canonical Flow

```
Purchases
    ↓
Raw Materials (Inventory)
    ↓
Production Execution
    ↓
Production Batch          ← immutable
    ↓
Finished Goods (view)     ← calculated Produced − Consumed
    ↓
Sales
    ↓
Sale Batch Consumption    ← immutable FIFO layers
```

Production Planning sits beside this flow: it may calculate requirements but never mutates stock or accounting.

---

## Architecture Change Policy

Future architectural changes to the ERP Core require:

1. Written proposal.
2. Architectural discussion.
3. Approval.
4. Architecture Decision Record (ADR).
5. Documentation update (this freeze document and related specs).

**Implementation alone must never redefine architecture.**

If application code conflicts with this freeze, the freeze wins until an ADR changes it.

---

## Allowed Future Work

Allowed, provided they respect the frozen architecture:

- UI
- APIs
- Database implementation
- Performance improvements
- Reporting
- Permissions
- POS integration
- Accounting integration
- Mobile support

---

## Not Frozen

The following areas remain open for future design. They may evolve **without** changing the ERP Core:

- Reporting
- POS
- Accounting
- Notifications
- Forecasting
- Demand Planning
- Waste Management
- Inventory Counting
- Multi-location
- Multi-company
- Barcode support
- Label printing

These capabilities must still respect frozen stock ownership, immutability, FIFO, and COGS rules when they touch Raw Materials, Production Batches, Finished Goods, or Sales.

---

## Spec Map

| Concern | Canonical document |
|---|---|
| ERP Core freeze (this baseline) | `docs/ARCHITECTURE_FREEZE_V1.md` |
| Immutable batches + FIFO consumption | `docs/BATCH_CONSUMPTION.md` |
| Finished Goods read-only view | `docs/FINISHED_GOODS.md` |
| Sales workflow, COGS, returns | `docs/SALES.md` |
| Product vision and system design | `PROJECT.md` |
| Sequencing | `ROADMAP.md` |
| Agent / engineer charter | `AGENTS.md` |

---

## Enforcement

For every agent and engineer:

- Read this document before redesigning stock, production, or sales behavior.
- Do not invent parallel stock ledgers or mutable remaining quantities.
- Do not allow Sales to update Production Batches.
- Do not store Finished Goods quantities as a second source of truth.
- When unsure, protect this freeze and ask for explicit confirmation before destructive architectural changes.
