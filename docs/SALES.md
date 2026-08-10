# Sales Architecture Freeze

**Status:** Architecture frozen — documentation only; not implemented  
**Audience:** Engineers and AI agents designing Sales  
**Related:** `docs/BATCH_CONSUMPTION.md`, `docs/FINISHED_GOODS.md`, `docs/ARCHITECTURE_FREEZE_V1.md`, `sql/010_finished_goods_batch_consumptions.sql`, `sql/011_allocate_finished_goods_fifo.sql`

This document freezes Sales architecture. **No code. No SQL. No UI.** Implementation alone must never redefine these rules. When consumption / remaining-quantity rules disagree, [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md) wins; this file owns Sales lifecycle, stock timing, and service boundaries.

---

## 1. Sales Lifecycle

```
Draft → Confirmed → Paid
  ↓         ↓
Cancelled  Cancelled  (Paid → Refunded is future; not free cancel)
```

| Status | Meaning | Editable | Stock | Money |
|---|---|---|---|---|
| **Draft** | Working sale; lines and prices may change | Yes | None | None |
| **Confirmed** | Commercial commitment accepted | No (locked) | Allocated | Revenue recognized (operational) |
| **Paid** | Settlement recorded | No | Unchanged | Payment / AR cleared |
| **Cancelled** | Terminal void | No | Restored if previously allocated | Contra events if needed |
| **Refunded** | Future controlled return/refund | No | Via compensating ledger `in` | Refund accounting |

### Transitions

| From → To | Allowed | Effect |
|---|---|---|
| → **Draft** | Create | Assign identity; no ledger writes |
| **Draft → Confirmed** | Yes, if validation + FIFO succeed atomically | Call `allocate_finished_goods_fifo` per line; lock document; snapshot COGS from ledger |
| **Draft → Cancelled** | Yes | No stock effect; read-only |
| **Confirmed → Paid** | Yes | Settlement only; **no** further FIFO; **no** ledger quantity change |
| **Confirmed → Cancelled** | Yes (controlled cancel) | Append compensating ledger `in` rows; never delete/edit prior `out` |
| **Paid → Cancelled** | No | Use future **Refunded** process (compensating events) |
| **Confirmed / Paid → Draft** | No | Irreversible commitment |
| **Cancelled / Refunded → *** | No | Terminal |

**Paid does not move inventory.** Confirmation is the stock and COGS boundary; payment is cash/AR only.

---

## 2. Inventory Ownership — When Stock Leaves

| Moment | Leaves Finished Goods? | Why |
|---|---|---|
| **Draft created / edited** | **No** | Draft is a proposal; availability checks are advisory |
| **Confirmed** | **Yes** | Customer commitment; FIFO outs appended to the Finished Goods ledger |
| **Paid** | **No** | Settlement; stock already committed at Confirm |
| **Delivered** | **No** (v1) | Delivery is logistics metadata, not a second stock event |

**Decision (frozen):** Finished Goods leaves inventory **only on Confirm**.

Justification:

1. Draft must remain editable without overselling races settled by soft holds alone.
2. Confirm is the irrevocable commercial act — matching append-only ledger discipline.
3. Paid can lag (catering invoice, delayed card settlement) without double-consuming stock.
4. Delivery must not invent a parallel stock mutation path.

Sales **never** mutates raw-material Inventory, Production Batches, or product-level stock fields. Remaining is always:

```
Remaining = produced_quantity − SUM(out) + SUM(in)
```

Never store `remaining_quantity`.

---

## 3. FIFO — Reuse `allocate_finished_goods_fifo()`

Sales **must not** implement FIFO in TypeScript.

On **Draft → Confirmed**, for each sale line the Sales service calls the existing RPC:

```
allocate_finished_goods_fifo(
  product_id,
  quantity,
  reason      = 'sale',
  source_type = 'sale_line',
  source_id   = sale_line.id,
  …
)
```

| Rule | Requirement |
|---|---|
| FIFO order | Owned solely by the SQL RPC (oldest `produced_at`, then batch `id`) |
| Ledger writes | RPC appends `finished_goods_batch_consumptions` with `direction = 'out'` |
| Production Batches | Never updated |
| Duplicate posting | RPC rejects re-allocation for the same `source_type` + `source_id` |
| Insufficient stock | Entire Confirm transaction fails; no partial commit |
| COGS | `SUM(total_cost)` of ledger rows for those sale lines — never recipe, never FG average alone, never manual |

Sales may **preview** availability via Finished Goods read models before Confirm. Preview is not allocation. Confirm-time RPC results are authoritative.

Do **not** create a second `sale_batch_consumptions` table that duplicates the Finished Goods ledger. The ledger row *is* the consumption / COGS layer; Sales references it via `source_type` / `source_id`.

---

## 4. Accounting Integration (Events Only)

Sales emits **business events**. Accounting posts journals later. Sales never posts double-entry itself.

| Event | When | Payload intent |
|---|---|---|
| `sale.confirmed` | Draft → Confirmed | Revenue total; COGS total (from ledger outs); sale / line ids; currency; optional customer |
| `sale.paid` | Confirmed → Paid | Payment amount / method; AR clearance vs cash/bank; link to sale |
| `sale.cancelled` | Draft or Confirmed → Cancelled | If Confirm had stock: compensating inventory restore signal; reverse unposted or post contra revenue/COGS per Accounting policy |
| `sale.refunded` | Future | Refund amounts + optional restock disposition |

Derived operational figures Sales may attach (not separate ledgers):

- **Revenue** = sale line selling totals  
- **COGS** = Σ ledger `total_cost` for `reason = 'sale'` outs of that sale’s lines  
- **Gross profit** = Revenue − COGS  

Forbidden: a parallel Sales finance engine, manual COGS, or Accounting bypass.

---

## 5. Immutable After Confirmation

After **Confirmed**, these are frozen:

- Sale header commercial fields (customer, sold_at, currency, notes policy as read-only)
- All sale lines (product, quantity, unit price, discounts)
- FIFO allocation layers (ledger `out` rows) — never edited, never deleted
- Snapshot COGS / gross profit on the sale document
- Idempotency of allocation per sale line

Allowed after Confirm without touching stock: transition to **Paid**; attach payment references; read-only display.

---

## 6. Cancellation — Restore via Ledger Only

| Case | Inventory restore |
|---|---|
| **Draft → Cancelled** | Nothing to restore |
| **Confirmed → Cancelled** | Append compensating `finished_goods_batch_consumptions` rows with `direction = 'in'` and `reason = 'return_restock'` (or dedicated cancel-restock reason when introduced), linked to the cancel/reversal source — **mirroring original out layers** |
| **Paid** | Not cancelled in-place; future Refund process uses the same append-only restore pattern |

Rules:

- **Never** `DELETE` or `UPDATE` prior ledger outs  
- **Never** mutate Production Batches  
- **Never** write mutable balances or `remaining_quantity`  
- Restore must reuse the Finished Goods ledger so availability recalculates as Produced − Out + In  

Exact cancel-restock RPC is future implementation; the architecture is fixed: **append compensating `in`**.

---

## 7. Read Models Required by Sales

| Read model | Purpose |
|---|---|
| **Sale list** | Search/sort/paginate sales by number, date, customer, status, revenue, COGS, profit |
| **Sale detail** | Header + lines + status + totals; for Confirmed/Paid, linked ledger layers (audit) |
| **Finished Goods availability** | Per-product available qty for draft warnings and Confirm validation (same calc as FG module) |
| **Product sellable catalog** | Active sellable products, unit, price defaults |
| **Customer lookup** (optional) | Guest allowed (`customer_id` null) |
| **Allocation / COGS audit** | Ledger rows for `source_type = 'sale_line'` of this sale (quantity, batch, unit_cost, total_cost) |
| **Payment status view** | Confirmed vs Paid settlement state (no stock fields) |

All quantity views derive from Production Batches + ledger. No Sales-owned stock cache.

---

## 8. Service Responsibilities

```
UI  →  Hooks  →  Services  →  SQL RPC  →  PostgreSQL
```

| Layer | Owns | Must not own |
|---|---|---|
| **UI** | Presentation, forms, confirm/pay/cancel actions | FIFO, stock math, COGS formulas, ledger writes |
| **Hooks** | Loading, errors, draft state, orchestration | Supabase queries, business invariants |
| **Services** | Auth-aware calls; map inputs; return `ServiceResult<T>`; start Confirm/Cancel/Pay transactions | Reimplement FIFO; compute remaining; invent stock |
| **SQL RPC** | FIFO, locking, ledger append, insufficient-stock, idempotent source checks | UI concerns |
| **PostgreSQL** | Tables, constraints, append-only ledger truth | — |

**Frozen:** No Sales business rules in TypeScript that allocate stock, calculate remaining, choose batches, or invent COGS. TypeScript orchestrates; PostgreSQL decides.

---

## 9. Constraints (Non-Negotiable)

- Architecture Freeze — change only via ADR  
- Immutable Production Batches  
- Append-only Finished Goods ledger  
- No stored `remaining_quantity`  
- No duplicated FIFO outside `allocate_finished_goods_fifo`  
- No duplicated accounting ledger in Sales  
- No Inventory (raw materials) mutation from Sales  
- No recipe consumption on sale  

### Explicit non-goals (this document)

No application code, migrations, UI, payment capture, POS client, or Accounting journal engine.

---

## 10. Summary

| Topic | Freeze |
|---|---|
| Lifecycle | Draft → Confirmed → Paid; Cancelled from Draft/Confirmed; Refunded future |
| Stock leaves | **On Confirm only** |
| FIFO | Only via `allocate_finished_goods_fifo` (`reason=sale`, `source_type=sale_line`) |
| COGS | Ledger `out` `total_cost` sums only |
| Cancel restore | Append ledger `in`; never mutate balances |
| Accounting | Emit events; Accounting posts later |
| Code split | UI → Hooks → Services → RPC → DB; **no stock business rules in TS** |
