# Accounting Data Model Proposal

**Status:** Architecture proposal — not implemented  
**Version:** 1.0  
**Task:** DEV-086  
**Audience:** Engineers and AI agents preparing Accounting schema  
**Related:** `docs/ACCOUNTING.md` (canonical architecture), `PROJECT.md`, `src/types/accounting.ts`

This document proposes the **additive SQL objects** for Accounting.

It does **not** authorize running migrations or creating files under `sql/` until an Accounting implementation sprint starts.

---

## 1. Design Rules

1. Prefer additive tables; do not destroy operational tables.
2. UUIDs for primary keys.
3. Monetary columns use `numeric` with fixed scale (e.g. `numeric(18,6)` for rates, `numeric(18,2)` or company scale for amounts — finalize at implementation).
4. Posted financial rows are immutable; reversals insert new rows.
5. Operational modules have **no write grants** to accounting tables (RLS / privilege plan at implementation).
6. All accounting writes go through Accounting services / RPCs owned by Accounting.

---

## 2. Entity Relationship (Logical)

```
company_settings.base_currency
        │
        ├── fiscal_periods
        ├── currency_rates
        ├── accounts  (chart of accounts)
        ├── account_role_bindings  (role → account_id)
        ├── posting_rules / posting_rule_lines
        ├── accounting_business_events
        │         │
        │         ▼
        │   journal_entries ──┬── journal_lines ──► accounts
        │                     │
        │                     └── ledger_entries ──► accounts
        ├── tax_rates / tax_codes
        └── vat_periods
```

`transactions` (ERP spine) remains cross-domain; Accounting Business Events reference `transaction_id`.

---

## 3. Proposed Tables

### 3.1 `accounts` — Chart of Accounts

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `code` | text | Unique per company |
| `name` | text | |
| `account_type` | text | asset / liability / equity / revenue / expense / contra_* |
| `parent_account_id` | uuid null | FK accounts |
| `is_postable` | boolean | Leaf accounts only for lines |
| `is_active` | boolean | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Indexes: unique(`code`), index(`parent_account_id`), index(`account_type`).

---

### 3.2 `fiscal_periods`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g. 2026-Q3 |
| `start_date` | date | |
| `end_date` | date | |
| `status` | text | open / closed / locked |
| `closed_at` | timestamptz null | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Constraints: no overlapping open periods (enforced at implementation); `start_date <= end_date`.

---

### 3.3 `currency_rates`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `base_currency` | text | ISO 4217 |
| `quote_currency` | text | Transaction currency |
| `rate` | numeric | Multiply quote → base |
| `rate_date` | date | |
| `source` | text | manual / feed / system |
| `created_at` | timestamptz | |

Unique suggested: (`base_currency`, `quote_currency`, `rate_date`, `source`).

---

### 3.4 `account_role_bindings`

Maps posting roles to concrete accounts for a company.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `role` | text | e.g. revenue, cogs, vat_output |
| `account_id` | uuid FK accounts | |
| `effective_from` | date | |
| `effective_to` | date null | |
| `is_active` | boolean | |
| `created_at` | timestamptz | |

---

### 3.5 `posting_rules` / `posting_rule_lines`

| `posting_rules` | |
|---|---|
| `id` | uuid PK |
| `event_type` | text |
| `version` | int |
| `effective_from` | date |
| `effective_to` | date null |
| `is_active` | boolean |
| `created_at` | timestamptz |

| `posting_rule_lines` | |
|---|---|
| `id` | uuid PK |
| `posting_rule_id` | uuid FK |
| `line_no` | int |
| `account_role` | text |
| `side` | text | debit / credit |
| `amount_field` | text | e.g. net_amount, tax_amount, cogs_amount |
| `tax_code` | text null | optional |

---

### 3.6 `accounting_business_events`

Immutable intake.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `event_type` | text | |
| `transaction_id` | uuid null | FK transactions when live |
| `source_module` | text | opaque |
| `source_document_type` | text | opaque |
| `source_document_id` | uuid/text | opaque |
| `idempotency_key` | text | unique |
| `occurred_at` | timestamptz | |
| `transaction_currency` | text | |
| `base_currency` | text | |
| `exchange_rate` | numeric | |
| `rate_date` | date | |
| `amounts` | jsonb | typed money facts |
| `tax_lines` | jsonb | VAT-ready breakdown |
| `posting_status` | text | pending / posted / failed / skipped |
| `journal_entry_id` | uuid null | set when posted |
| `failure_reason` | text null | |
| `created_at` | timestamptz | |

Unique: `idempotency_key`.  
Index: (`posting_status`, `created_at`), (`event_type`, `occurred_at`).

---

### 3.7 `journal_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `business_event_id` | uuid null | unique when automatic |
| `transaction_id` | uuid null | spine link |
| `fiscal_period_id` | uuid FK | |
| `entry_date` | date | |
| `memo` | text null | |
| `status` | text | draft / posted / voided |
| `transaction_currency` | text | |
| `base_currency` | text | |
| `exchange_rate` | numeric | |
| `reversal_of_journal_entry_id` | uuid null | |
| `posted_at` | timestamptz null | |
| `created_at` | timestamptz | |

---

### 3.8 `journal_lines`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `journal_entry_id` | uuid FK | |
| `line_no` | int | |
| `account_id` | uuid FK | |
| `description` | text null | |
| `debit_transaction` | numeric | |
| `credit_transaction` | numeric | |
| `debit_base` | numeric | |
| `credit_base` | numeric | |
| `tax_code` | text null | |
| `created_at` | timestamptz | |

Constraints (implementation):

- Exactly one of debit/credit non-zero per currency pair (or allow both zero only if rejected)
- Per entry: `SUM(debit_base) = SUM(credit_base)`

---

### 3.9 `ledger_entries`

Append-only GL facts (materialized from posted journal lines).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `journal_entry_id` | uuid FK | |
| `journal_line_id` | uuid FK | unique |
| `fiscal_period_id` | uuid FK | |
| `account_id` | uuid FK | |
| `entry_date` | date | |
| `debit_base` | numeric | |
| `credit_base` | numeric | |
| `debit_transaction` | numeric | |
| `credit_transaction` | numeric | |
| `transaction_currency` | text | |
| `base_currency` | text | |
| `created_at` | timestamptz | |

Indexes: (`account_id`, `entry_date`), (`fiscal_period_id`, `account_id`).

---

### 3.10 VAT objects (extend existing planned tables)

Align with `PROJECT.md` planned accounting tables:

| Table | Role |
|---|---|
| `tax_rates` | Rate master (name, rate, tax_code, direction, active) |
| `vat_periods` | open / closed / filed windows |

Optional later: `vat_return_snapshots` for filed immutable copies.

---

### 3.11 Payments & bank (already planned)

| Table | Role |
|---|---|
| `bank_accounts` | Cash/bank master linked to COA account |
| `payments` | Settlement documents; emit payment business events |

---

## 4. SQL Object Plan (Future Scripts)

Do **not** create these files in DEV-086. Reserved numbering suggestion (adjust to next free `sql/` index at implementation time):

| Planned script | Objects |
|---|---|
| `sql/1xx_accounting_chart_of_accounts.sql` | `accounts` |
| `sql/1xx_accounting_fiscal_periods.sql` | `fiscal_periods` |
| `sql/1xx_accounting_currency_rates.sql` | `currency_rates` |
| `sql/1xx_accounting_posting_rules.sql` | `posting_rules`, `posting_rule_lines`, `account_role_bindings` |
| `sql/1xx_accounting_business_events.sql` | `accounting_business_events` |
| `sql/1xx_accounting_journals.sql` | `journal_entries`, `journal_lines` |
| `sql/1xx_accounting_ledger.sql` | `ledger_entries` |
| `sql/1xx_accounting_vat.sql` | extend `tax_rates`, `vat_periods` |
| `sql/1xx_accounting_post_event_rpc.sql` | `post_accounting_business_event(event_id)` SECURITY DEFINER |
| `sql/1xx_accounting_statements.sql` | read models / RPCs: trial balance, P&L, balance sheet |

### Planned RPCs (names only)

| RPC | Purpose |
|---|---|
| `enqueue` via service insert or `create_accounting_business_event` | Intake |
| `post_accounting_business_event(p_event_id)` | Posting Engine entry |
| `get_trial_balance(p_from, p_to)` | Statement |
| `get_profit_and_loss(p_from, p_to)` | Statement |
| `get_balance_sheet(p_as_of)` | Statement |
| `get_vat_return(p_vat_period_id)` | VAT projection |

### Planned views (optional)

| View | Purpose |
|---|---|
| `accounting_trial_balance` | Account sums for open inquiry |
| `accounting_gl_by_account` | GL lines by account |

---

## 5. Privilege Plan (Architecture)

| Role | Accounting tables |
|---|---|
| Operational module services (client) | **No direct write** |
| Accounting posting RPC | Insert event (or accept from trusted service), insert journals/ledger |
| Authenticated read | Select on statements / limited journal inquiry per RLS policy |

Exact RLS policies are an implementation concern; the invariant is: **only Accounting posting path writes journals/ledger**.

---

## 6. Mapping to Shared TypeScript Contracts

| SQL object | TS contract home |
|---|---|
| `accounts` | `Account` in `src/types/accounting.ts` |
| `journal_entries` / `journal_lines` | `JournalEntry`, `JournalLine` (+ multi-currency fields) |
| `ledger_entries` | `LedgerEntry` |
| `accounting_business_events` | `AccountingBusinessEvent` |
| `posting_rules` | `PostingRule` |
| `fiscal_periods` | `FiscalPeriod` |
| `currency_rates` | `CurrencyRate` |
| `tax_rates` / `vat_periods` | existing `TaxRate`, `VatPeriod` |

Feature re-exports live under `src/features/accounting/types/*`.

---

## 7. Out of Scope for This Proposal

- Actual `sql/*.sql` file creation
- Seed COA data
- Statement UI
- FX revaluation engine tables beyond reserved event type
- Fixed assets register physical schema (future sprint)
