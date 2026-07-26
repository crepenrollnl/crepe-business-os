# Accounting Architecture

**Status:** Architecture freeze — specification only, not implemented  
**Version:** 1.0  
**Task:** DEV-086  
**Audience:** Engineers and AI agents implementing Accounting and any money-touching module  
**Related:** `PROJECT.md`, `ROADMAP.md`, `AGENTS.md`, `docs/ARCHITECTURE_FREEZE_V1.md`, `docs/MODULE_FOUNDATION.md`, `docs/ACCOUNTING_DATA_MODEL.md`, `src/types/accounting.ts`, `src/types/transactions.ts`

This document is the **immutable Accounting model** for Crepe'n Roll OS.

It does **not** authorize schema creation, migrations, services, RPCs, or UI until a roadmap sprint explicitly starts Accounting implementation.

When documents disagree on Accounting boundaries, **this document wins**.

---

## 1. Purpose

Accounting is the **sole financial module** of the ERP.

It owns:

- Chart of Accounts
- Journal Entries
- General Ledger
- Posting Engine and Posting Rules
- Business Event intake for financial posting
- Fiscal Periods
- Currencies and exchange rates
- VAT-ready tax structures
- Future Financial Statements (Trial Balance, Balance Sheet, P&L, Cash Flow, VAT Return)

It does **not** own operational stock, recipes, products, production batches, or sales UI.

---

## 2. Non-Negotiable Invariants

1. **Accounting is the only writer** of accounting tables (accounts, journals, ledger facts, posting artifacts, VAT accounting tables).
2. **Operational modules NEVER write** journal entries, ledger lines, or chart-of-accounts rows.
3. **Operational modules ONLY emit business events** (via the transaction / event spine). Accounting posts from those events.
4. **Every posted journal entry balances** — total debits = total credits in company base currency.
5. **Posted journals are immutable.** Corrections use reversal / adjusting entries, never silent edits.
6. **Financial reports are projections** over journal / ledger facts — never a second money ledger.
7. **No parallel Finance or Taxes module.** VAT and taxes live inside Accounting.
8. **Accounting knows only financial concepts** — accounts, journals, ledger entries, currencies, amounts, posting rules. It does not know Inventory, Recipes, Products, Crepes, Production, or Sales UI.
9. **Multi-currency is first-class** — company base currency, transaction currency, exchange rate, base amounts, transaction amounts.
10. **Redesign of this model requires an ADR.** Implementation alone must never redefine it.

---

## 3. Canonical Financial Flow

```
Business Event
    → Posting Engine
    → Journal Entry
    → Ledger
    → Financial Reports
```

Expanded:

```
Operational completion
  (Purchases / Production / Sales / Finished Goods effects /
   Inventory adjustments / Waste / Payments / Expenses / …)
        ↓
Business Transaction (ERP spine — already contracted)
        ↓
Accounting Business Event (immutable financial intake)
        ↓
Posting Engine  (applies Posting Rules; only Accounting writer)
        ↓
Journal Entry + Journal Lines  (balanced, double-entry)
        ↓
Ledger Entries  (append-only GL facts)
        ↓
Financial Reports  (Trial Balance, P&L, Balance Sheet, Cash Flow, VAT)
```

### Forbidden flow

```
Sales / Purchases / Production  ──X──►  journal_entries / ledger_entries
```

Operational modules must never insert into accounting tables.

---

## 4. Boundary Rules

### What Accounting knows

| Concept | Ownership |
|---|---|
| Accounts (Chart of Accounts) | Accounting |
| Journal Entries / Lines | Accounting |
| Ledger Entries | Accounting |
| Posting Engine / Posting Rules | Accounting |
| Accounting Business Events (intake) | Accounting |
| Fiscal Periods | Accounting |
| Base Currency / Transaction Currency / FX | Accounting (+ company settings for base) |
| VAT codes / rates / periods / return projections | Accounting |
| Financial Statements | Accounting (Reports may display projections) |

### What Accounting must never know

| Domain | Rule |
|---|---|
| Inventory quantities / ingredients | Forbidden |
| Recipes / BOM / allergens | Forbidden |
| Products / crepe catalog | Forbidden |
| Production planning or execution UI | Forbidden |
| Sales draft UI / FIFO batch selection UI | Forbidden |
| Finished Goods availability screens | Forbidden |

Accounting may receive **opaque source references** (`source_module`, `source_document_type`, `source_document_id`, `transaction_id`) for audit traceability. It must not import operational feature components, hooks, pages, or domain calculation logic.

### What operational modules must do

| Module | Emits (future) | Must never do |
|---|---|---|
| Purchases | purchase / payment-related business events | Write journals / GL |
| Sales | sale / refund / COGS-related business events | Write journals / GL |
| Production Execution | production cost / WIP / FG capitalization events | Write journals / GL |
| Finished Goods | none (read model) | Write journals / GL |
| Inventory | adjustment / waste / transfer events | Write journals / GL |
| Reports | read accounting projections | Own a second ledger |

COGS amounts used in sale events must already be facts from Sale Batch Consumption — Accounting does not recalculate FIFO.

---

## 5. Chart of Accounts

### Purpose

Hierarchical catalog of financial accounts used by journal lines.

### Account types

| Type | Normal balance | Examples (illustrative) |
|---|---|---|
| `asset` | Debit | Cash, Bank, Inventory Asset, AR |
| `contra_asset` | Credit | Accumulated depreciation |
| `liability` | Credit | AP, VAT Payable, Loans |
| `contra_liability` | Debit | (rare contra liability) |
| `equity` | Credit | Owner equity, Retained earnings |
| `revenue` | Credit | Sales revenue |
| `expense` | Debit | COGS, Rent, Waste |

### Rules

1. Every journal line posts to exactly one account.
2. Accounts may nest via `parent_account_id` (tree).
3. Only **postable** leaf accounts accept journal lines (non-postable headers for grouping).
4. Accounts are soft-deactivated (`is_active = false`); never hard-deleted once used in a posted journal.
5. Account codes are stable business identifiers within a company.

### Out of scope for v1 implementation (architecture ready)

- Multi-company COA sets
- Segment / dimension coding beyond optional future analytic tags

---

## 6. Journal Entries

### Purpose

The double-entry document that records one balanced posting produced by the Posting Engine.

### Structure

- **Journal Entry (header)** — date, memo, period, status, source event link, currencies summary
- **Journal Lines** — account, debit/credit in transaction and base currency, optional tax code, description

### Rules

1. Debits = Credits in **company base currency** for posted entries.
2. A journal entry is created only by the Posting Engine (or explicit Accounting manual journal UI later).
3. **Draft** journals (if used) are Accounting-internal only; operational modules never create them.
4. **Posted** journals are immutable.
5. **Void / Reverse** creates a reversing journal linked to the original; original remains for audit.
6. Every automatic journal links to exactly one Accounting Business Event (idempotency key).
7. Manual journals (future) still require fiscal-period openness and balance checks.

---

## 7. General Ledger

### Purpose

The append-only fact store of posted financial movement used by statements.

### Model

- Ledger is **not** a place operational modules write.
- Preferred shape: **`ledger_entries`** derived 1:1 (or 1:N) from posted journal lines.
- Trial Balance / GL inquiry = projections over ledger entries (or equivalent posted journal lines).

### Rules

1. Ledger entries are append-only after post.
2. No update of amounts on posted ledger rows.
3. Reversal = new ledger rows with opposite signs / opposite debit-credit, not deletion.
4. GL balances are always calculable: `SUM(debit_base) - SUM(credit_base)` per account (sign by account type for presentation).

---

## 8. Posting Engine

### Purpose

The **only** component allowed to turn Accounting Business Events into Journal Entries and Ledger Entries.

### Responsibilities

1. Accept an Accounting Business Event (idempotent).
2. Validate fiscal period is open for the event date.
3. Resolve Posting Rules for the event type (+ optional variants).
4. Build balanced journal lines in transaction and base currency.
5. Persist Journal Entry + Lines in one database transaction.
6. Materialize Ledger Entries.
7. Mark event posting status `posted` (or `failed` with reason).
8. Never call Inventory / Sales / Production services to recalculate money facts.

### Non-responsibilities

- FIFO / batch selection
- Recipe costing
- UI workflows
- Editing operational documents

### Idempotency

Posting Engine must be safe to retry:

- Unique constraint on `business_event_id` → journal entry
- Re-post of an already-posted event returns the existing journal (no duplicate)

### Concurrency

- Period close and posting are serialized per company/period strategy (implementation detail later)
- Event intake is append-only; engine processes each event once to success

---

## 9. Posting Rules

### Purpose

Declarative mapping from **business event type** → **account roles / formulas**.

### Rule content (architecture)

| Field | Meaning |
|---|---|
| `event_type` | e.g. `sale_completed`, `purchase_received`, `cogs_recognized` |
| `version` | Rule version for audit |
| `lines[]` | Account role, debit/credit side, amount source field, optional tax flag |
| `effective_from` / `effective_to` | Temporal validity |
| `is_active` | Enable/disable |

### Amount sources (financial facts on the event)

Examples: `gross_amount`, `net_amount`, `tax_amount`, `cogs_amount`, `discount_amount`, `shipping_amount`.

Rules reference **event money fields**, never operational tables.

### Account roles (illustrative)

| Role | Typical account type |
|---|---|
| `accounts_receivable` | asset |
| `accounts_payable` | liability |
| `revenue` | revenue |
| `cogs` | expense |
| `inventory_asset` | asset |
| `vat_output` | liability |
| `vat_input` | asset / receivable |
| `cash` / `bank` | asset |
| `waste_expense` | expense |

Company-specific account bindings live in Accounting configuration (account id per role), not in Sales/Purchases code.

---

## 10. Business Events

### Purpose

Immutable **financial intake** messages that Accounting understands.

### Principles

1. Emitted when an operational document reaches a financially meaningful state (e.g. sale completed, purchase received).
2. Payload contains **money facts + references only**.
3. Payload does **not** contain recipe trees, stock matrices, or UI state.
4. Events are append-only; never edited. Corrections emit compensating events.
5. Each event has a stable idempotency key (typically `transaction_id` + `event_type` or source document + type).

### Minimal event envelope

| Field | Description |
|---|---|
| `id` | Event UUID |
| `event_type` | Accounting event type enum |
| `transaction_id` | Link to ERP Transaction spine |
| `source_module` | Opaque module key (`sales`, `purchases`, …) |
| `source_document_type` | Opaque document type |
| `source_document_id` | Opaque document id |
| `occurred_at` | Business datetime |
| `transaction_currency` | ISO currency of the document |
| `base_currency` | Company base currency at posting time |
| `exchange_rate` | Rate used to convert to base |
| `amounts` | Typed money facts (net, tax, gross, cogs, …) |
| `tax_lines` | Optional VAT-ready breakdown |
| `posting_status` | `pending` / `posted` / `failed` / `skipped` |
| `created_at` | Intake timestamp |

### Example event types (architecture catalog)

| Event type | Typical emitter |
|---|---|
| `purchase_received` | Purchases |
| `purchase_paid` | Purchases / Payments |
| `sale_completed` | Sales |
| `sale_refunded` | Sales (future returns process) |
| `cogs_recognized` | Sales (from consumption facts) |
| `production_completed` | Production Execution |
| `inventory_adjusted` | Inventory |
| `waste_recognized` | Inventory / Production |
| `expense_recognized` | Expenses (future) |
| `payment_received` / `payment_sent` | Payments |
| `fx_revaluation` | Accounting (period-end) |

Emitters supply facts; Accounting maps facts through Posting Rules.

---

## 11. Fiscal Periods

### Purpose

Control when posting is allowed and support period-end reporting.

### Statuses

| Status | Meaning |
|---|---|
| `open` | Posting allowed |
| `closed` | No new operational posting; Accounting adjustments policy may still apply |
| `locked` | No posting of any kind without formal unlock (audit event) |

### Rules

1. Every journal entry belongs to exactly one fiscal period (by entry date / period map).
2. Posting Engine rejects events whose date falls in a non-open period (policy may allow Accounting-only adjustment types in `closed`).
3. Period close is an Accounting operation, never an operational module action.
4. VAT periods may align with or nest inside fiscal periods (see §14).

---

## 12. Posting Status

### On Accounting Business Event

| Status | Meaning |
|---|---|
| `pending` | Accepted, not yet successfully posted |
| `posted` | Journal + ledger created |
| `failed` | Engine attempted; error recorded; safe to retry after fix |
| `skipped` | Intentionally not posted (policy / zero amount) |

### On Journal Entry

| Status | Meaning |
|---|---|
| `draft` | Accounting-internal unfinished manual entry (future) |
| `posted` | Immutable; included in GL |
| `voided` | Superseded by reversal linkage; retained for audit |

### On ERP Transaction (existing spine)

`draft` / `posted` / `voided` remain operational status. Accounting posting status is tracked on the Accounting Business Event / journal side so operational and financial posting can be reasoned about separately when needed.

---

## 13. Base Currency

### Purpose

Company-level functional currency for GL and statements.

### Rules

1. Exactly one **company base currency** (from Company Settings when implemented).
2. All posted journals store balanced amounts in base currency.
3. Changing base currency after go-live requires a formal migration / ADR — not a casual setting flip.
4. Financial statements present in base currency by default.

---

## 14. Transaction Currency

### Purpose

Currency of the operational document / business event.

### Rules

1. Every money event carries `transaction_currency`.
2. Journal lines store both transaction-currency amounts and base-currency amounts.
3. Operational modules must not convert using ad-hoc rates outside the shared FX rate used on the event.

---

## 15. Exchange Rates

### Purpose

Convert transaction currency amounts into base currency for posting.

### Architecture fields

| Field | Meaning |
|---|---|
| `base_currency` | Company functional currency |
| `transaction_currency` | Document currency |
| `exchange_rate` | Multiply transaction amount → base amount |
| `rate_date` | Date the rate applies |
| `rate_source` | Manual / feed / system (future) |

### Amount pairs on lines / events

| Amount | Currency |
|---|---|
| `debit_transaction` / `credit_transaction` | Transaction currency |
| `debit_base` / `credit_base` | Base currency |

### Future FX (architecture reserved)

- Unrealized FX gains/losses on open AR/AP at period end (`fx_revaluation` events)
- Realized FX gains/losses on settlement when rate differs from original
- No implementation in this foundation task

---

## 16. VAT-Ready Design

### Purpose

Support VAT without a separate Taxes module.

### Building blocks (architecture)

| Object | Role |
|---|---|
| `tax_rates` / tax codes | Rate definitions (e.g. standard, reduced, zero, exempt) |
| Tax direction | `output` (sales) / `input` (purchases) |
| Event `tax_lines[]` | net, rate, tax amount, tax code per line |
| Posting Rules | Map tax to VAT Output / VAT Input accounts |
| `vat_periods` | Open / closed / filed reporting windows |
| VAT Return projection | From posted tax lines in a VAT period |

### Rules

1. VAT amounts are facts on the business event (or derived once in emitter from document totals) — Posting Engine does not invent tax from product catalogs.
2. VAT Return reads posted journals / tax line facts inside Accounting.
3. Filing status lives on `vat_periods` (`open` / `closed` / `filed`).
4. No parallel tax ledger outside Accounting.

---

## 17. Future Financial Statements

Statements are **read models / projections** over posted ledger (or posted journal lines). They do not store a second balance truth.

| Statement | Source |
|---|---|
| Trial Balance | Sum of ledger entries by account for a period/range |
| Profit & Loss | Revenue and expense accounts for a period |
| Balance Sheet | Asset, liability, equity balances as-of date |
| Cash Flow | Cash/bank ledger movements (indirect/direct method later) |
| VAT Return | Tax line facts in a VAT period |

Reports module may **display** these projections but must not redefine them.

---

## 18. Posting Engine Flow

```
1. Receive Accounting Business Event (pending)
2. Begin DB transaction
3. Lock / claim event for posting (idempotent)
4. If already posted → return existing journal; commit
5. Validate envelope (amounts, currencies, rate, date)
6. Resolve fiscal period; reject if not open (policy)
7. Load active Posting Rules for event_type + date
8. Resolve account roles → account ids (company config)
9. Build journal lines (transaction + base amounts)
10. Assert SUM(debit_base) = SUM(credit_base)
11. Insert journal_entries + journal_lines (status = posted)
12. Insert ledger_entries
13. Set event posting_status = posted; link journal_entry_id
14. Commit
15. On failure → mark failed with reason; no partial journal
```

### Failure handling

- No orphan journal without ledger (same DB transaction)
- Failed events remain retryable
- Poison events escalate to Accounting ops tools (future)

---

## 19. Business Event Flow

```
1. Operational module completes a money-relevant action
2. Operational module creates / posts ERP Transaction (spine)
3. Operational module (or shared emitter service inside that module)
   builds Accounting Business Event with financial facts only
4. Event is inserted as posting_status = pending
   (same DB transaction as operational completion when possible)
5. Posting Engine runs synchronously or asynchronously (implementation choice later)
6. Accounting owns all journal / ledger writes
7. Operational UI never waits on statement recalculation
```

### Emitter rules

1. Emitters live at the operational boundary (services), not in React components.
2. Emitters must not import Accounting Posting Engine internals beyond a thin shared intake contract / service API owned by Accounting.
3. Preferred future API: `accountingPostingService.enqueueBusinessEvent(...)` implemented **inside Accounting**, called by operational services.
4. Operational services pass facts; they do not choose debit/credit accounts.

---

## 20. Module Structure (Planned)

Feature root: `src/features/accounting/`

```
src/features/accounting/
  components/          # future UI (not in this task)
  hooks/               # future orchestration (not in this task)
  services/            # future posting + reads (not in this task)
  page/                # future route composition (not in this task)
  utils/               # future pure helpers (not in this task)
  types/
    chart-of-accounts.ts
    journal.ts
    ledger.ts
    posting.ts
    business-event.ts
    fiscal-period.ts
    currency.ts
    vat.ts
    statements.ts
    index.ts
```

Shared cross-module contracts: `src/types/accounting.ts`  
Transaction spine: `src/types/transactions.ts`  
Data model / SQL plan: `docs/ACCOUNTING_DATA_MODEL.md`

### Route (future)

- Thin `src/app/accounting/page.tsx` when UI sprint starts
- Auth guard + feature page only

---

## 21. Implementation Roadmap

Architecture-only now. Implementation order (aligns with `ROADMAP.md` Phase 5, refined):

| Phase | Scope | Notes |
|---|---|---|
| **A0 — Architecture (this task)** | Docs, contracts, module type layout, SQL plan | No SQL/services/UI |
| **A1 — Foundation schema** | COA, fiscal periods, currencies/FX tables, journal + ledger tables, business events, posting rules | Additive SQL only |
| **A2 — Posting Engine v1** | Intake API, rule resolution, balanced post, idempotency | No operational emitters yet (manual/test events) |
| **A3 — Operational emitters** | Sales / Purchases / Production / Inventory emit events with money facts | Still no direct journal writes |
| **A4 — Payments & bank** | Payments, bank accounts, cash postings | ROADMAP Sprint 13 overlap |
| **A5 — Statements** | Trial Balance, P&L, Balance Sheet, Cash Flow projections | ROADMAP Sprint 15 |
| **A6 — VAT** | Tax codes on events, VAT periods, VAT return projection | ROADMAP Sprint 16 |
| **A7 — FX advanced** | Revaluation, realized/unrealized gains/losses | After multi-currency postings stable |
| **A8 — Fixed assets & payroll contracts** | Register + integration contracts | ROADMAP Sprint 16 extended |

### Explicitly out of scope until later phases

- Working Posting Engine code
- SQL migrations applied in this task
- Accounting UI
- Live emitters from Sales/Purchases
- Parallel Finance/Taxes modules (never)

---

## 22. Relationship to Existing Contracts

| Existing | Role under this architecture |
|---|---|
| `Transaction` | ERP business spine; financially relevant completions should yield Accounting Business Events |
| `Account` / `JournalEntry` / `JournalLine` | Retained and extended for multi-currency, period, posting links |
| `Payment` / `BankAccount` | Remain Accounting-owned future objects |
| `TaxRate` / `VatPeriod` | VAT-ready anchors |
| `FinancialStatementType` | Statement projection catalog |
| Reports module | Displays operational + accounting projections; does not post |

---

## 23. Spec Map

| Concern | Canonical document |
|---|---|
| Accounting architecture & flows | `docs/ACCOUNTING.md` (this file) |
| Tables / SQL object plan | `docs/ACCOUNTING_DATA_MODEL.md` |
| Shared TS contracts | `src/types/accounting.ts` |
| Transaction spine | `src/types/transactions.ts` |
| Module layout rules | `docs/MODULE_FOUNDATION.md` |
| Build sequence | `ROADMAP.md` Phase 5 |

---

## 24. Agent Rules

1. Do not implement posting engines, SQL, RPCs, or Accounting UI until the roadmap sprint says so.
2. Do not let Sales, Purchases, Production, Inventory, or Finished Goods insert into accounting tables.
3. Do not create a Finance or Taxes feature module.
4. Do not put Inventory/Recipe/Product domain types into Accounting services.
5. When adding money to an operational module, design for **event emission**, not journal writing.
6. Any change to invariants in §2 requires an ADR.
