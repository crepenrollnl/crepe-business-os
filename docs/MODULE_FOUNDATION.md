# ERP Module Foundation

**Status:** Canonical — shared application foundation  
**Version:** 1.0  
**Task:** DEV-001  
**Audience:** Engineers and AI agents adding or extending ERP modules  
**Related:** `AGENTS.md`, `PROJECT.md`, `docs/ARCHITECTURE_FREEZE_V1.md`

This document defines the **module layout**, **shared primitives**, **error handling**, and **boundary rules** used by every ERP feature.

It does **not** redefine domain architecture. Frozen stock and batch rules remain in Architecture Freeze v1.0.

---

## Module root

ERP domain modules live under:

```
src/features/<module-id>/
```

Do **not** create a parallel `src/modules/` tree. The task-level name “modules” maps to `src/features/` in this codebase.

Canonical registry: [`src/constants/modules.ts`](../src/constants/modules.ts).

---

## Standard module layout

Every module should expose this predictable structure:

```
src/features/<module>/
  components/     # Presentational UI
  hooks/          # UI state and orchestration
  services/       # Database access only
  types/          # Feature-owned interfaces
  utils/          # Feature-local pure helpers (optional until needed)
  page/           # Page composition mounted by src/app
```

### Layer responsibilities

| Layer | Owns | Must not own |
|---|---|---|
| `app/` routes | Routing, auth guards, mounting feature pages | Business logic, Supabase queries |
| `components/` | Rendering, local form field state | Supabase, cross-module domain rules |
| `hooks/` | Loading, filters, modals, calling services | Raw database access |
| `services/` | Queries/mutations, mapping, error normalization | JSX, UI state |
| `types/` | Feature contracts | Runtime side effects |
| `utils/` | Pure helpers local to the feature | Database clients, React components |
| `page/` | Compose hooks + components for a route | Direct Supabase usage |

Inventory is the reference implementation for quality and structure.

---

## Planned vs live modules

| Module id | Folder | Status |
|---|---|---|
| `dashboard` | `src/features/dashboard` | Live |
| `inventory` | `src/features/inventory` | Live |
| `auth` | `src/features/auth` | Live (access domain) |
| `recipes` | `src/features/recipes` | Live |
| `purchases` | `src/features/purchases` | Live |
| `production` | `src/features/production` | Live (Production Planning UI / persistence) |
| `production-planning` | `src/features/production-planning` | Live domain package (pure pipeline; not a nav module) |
| `products` | `src/features/products` | Planned |
| `suppliers` | `src/features/suppliers` | Planned |
| `production-execution` | `src/features/production-execution` | Live (sessions + atomic completion) |
| `finished-goods` | `src/features/finished-goods` | Planned (scaffold only) |
| `sales` | `src/features/sales` | Planned |
| `customers` | `src/features/customers` | Planned |
| `events` | `src/features/events` | Planned |
| `accounting` | `src/features/accounting` | Planned (architecture + contracts only — see `docs/ACCOUNTING.md`) |
| `reports` | `src/features/reporting-workspace` | Live (Reports nav host at `/reports`) |
| `ai` | `src/features/ai` | Planned |

Scaffolds for planned modules may contain types stubs and empty folders only. **No business logic** until the roadmap reaches that module.

### Reporting packages

Reports is a layered read-only stack. The registered nav module host is `reporting-workspace`; supporting packages are not separate nav modules:

| Package | Folder | Role |
|---|---|---|
| Reporting Workspace | `src/features/reporting-workspace` | Live `/reports` host; `get_reporting_workspace` |
| Reporting Dashboard | `src/features/reporting-dashboard` | Presentational composition / widgets |
| Reporting API | `src/features/reporting-api` | `get_reporting_overview` / `get_reporting_section` |
| Reporting Home | `src/features/reporting-home` | `get_reporting_home` |
| Reports (summary views) | `src/features/reports` | Legacy `report_*_summary` view reads (DEV-041) |

SQL composition: `reporting_workspace` aggregates `reporting_home`, `dashboard_navigation`, and `reporting_api`. UI reads the workspace RPC only.

### Production Planning domain package

`src/features/production-planning/` is the pure domain pipeline for Production Planning (Architecture Freeze: calculate only — never mutate inventory, purchases, or production batches):

```
Production Plan
  → Calculation Engine (`calculateProductionPlan`)
  → Shopping List (`generateShoppingList`)
  → Procurement Recommendation (`generateProcurementRecommendation`)
  → Purchase Draft Builder (`generatePurchaseDrafts`)
```

It is **not** registered in `src/constants/modules.ts` (no nav route). Live UI and persistence remain in `src/features/production`. Downstream persistence of purchase drafts belongs to Purchases — the domain builder returns value objects only.

Public API: `@/features/production-planning` (see package `index.ts`).

---

## Shared primitives

### Types — `src/types/erp.ts`

| Alias | Meaning |
|---|---|
| `EntityId` | Primary key (UUID string) |
| `DateTime` | ISO-8601 timestamp |
| `CalendarDate` | `YYYY-MM-DD` |
| `Quantity` | Non-monetary amount |
| `Money` | Major currency units |
| `CurrencyCode` | ISO 4217 code |
| `SortDirection` | `asc` \| `desc` |
| `DocumentLifecycleStatus` | Generic draft/posted/cancelled/voided |
| `ActivationStatus` | active/inactive/archived |
| `StockAvailabilityStatus` | ok/low/out |

Prefer these aliases in **new** contracts. Do not mass-rename live interfaces.

Other shared contracts:

- `src/types/service.ts` — `ServiceResult`, `ok`, `fail`
- `src/types/transactions.ts` — transaction / stock movement contracts
- `src/types/accounting.ts` — accounting contracts
- `src/types/database.ts` — live / planned table registry

### Constants — `src/constants/`

| File | Purpose |
|---|---|
| `modules.ts` | Module registry and build order |
| `units.ts` | Inventory + yield unit catalogs |
| `statuses.ts` | Shared status catalogs and labels |
| `limits.ts` | Page size, lookup limits, field length caps |
| `config.ts` | Default currency, locale, money precision |

Avoid magic strings for statuses, units, and default limits.

### Money helpers — `src/lib/money.ts`

- `roundMoney`
- `calculateMoneyLineTotal`

---

## Error handling

All feature services normalize failures with:

```ts
import { toUserError } from "@/lib/service-errors";
```

Rules:

1. Return `ServiceResult<T>` from every service method.
2. Map unknown errors through `toUserError(error, fallback)`.
3. Domain-specific messages use the optional `map` callback (see Inventory / Recipes).
4. Never expose SQL, stack traces, or internal codes to the UI.
5. Prefer `ok(data)` / `fail(message)` helpers from `@/types/service` in new code.

Network failures always surface as:

> Network error. Please check your connection and try again.

---

## Module boundaries

### Allowed

| From | To | Example |
|---|---|---|
| `app/` | Any feature `page/` + auth guards | Route mounting |
| Feature A `services/` | Feature B `services/` | Production → Purchases service |
| Feature A `services/` | Domain package | Production → `production-planning` pure pipeline |
| Feature A | `@/types/*`, `@/constants/*`, `@/lib/*` | Shared contracts |
| Feature A | Feature B `types/` | Read-only contract reuse when unavoidable |
| Compatibility aliases | Owning feature types | `ingredients` → `inventory` types |

### Forbidden

| Pattern | Why |
|---|---|
| Feature A imports Feature B `components/` | UI coupling |
| Feature A imports Feature B `hooks/` | State coupling |
| Feature A imports Feature B `page/` | Route coupling |
| Components / pages query Supabase | Bypass service boundary |
| Duplicate money / error / unit catalogs per feature | Drift |

**Communicate across modules through services.** Cross-module UI imports are not allowed.

Reference pattern (allowed):

```ts
// src/features/production/services/production-service.ts
import { purchaseService } from "@/features/purchases/services/purchase-service";
```

---

## Adding a new module

1. Register it in `src/constants/modules.ts` (`status: "planned"` until live).
2. Create the standard folder layout under `src/features/<id>/`.
3. Add feature types first (contracts only if the roadmap phase is not started).
4. Implement `services/` → `hooks/` → `components/` → `page/`.
5. Add a thin `src/app/<route>/page.tsx` when the UI ships.
6. Follow Architecture Freeze for stock / batch / money ownership.
7. Reuse shared error, money, unit, and limit helpers.

---

## What this foundation does not include

- Production Execution business logic
- Finished Goods calculations
- Sales FIFO / Sale Batch Consumption
- Database migrations
- New routes for planned modules

Those arrive in later roadmap tasks on top of this foundation.
