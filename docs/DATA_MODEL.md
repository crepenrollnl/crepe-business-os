# ERP Canonical Data Model

**Status:** Canonical — official entity relationship reference  
**Version:** 1.0  
**Audience:** Engineers and AI agents implementing any ERP module  
**Authority:** Aligns with [`docs/ARCHITECTURE_FREEZE_V1.md`](ARCHITECTURE_FREEZE_V1.md) (ERP Core Architecture Freeze v1.0)  
**Related:** [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md), [`docs/FINISHED_GOODS.md`](FINISHED_GOODS.md), [`docs/SALES.md`](SALES.md), `AGENTS.md`, `PROJECT.md`, `ROADMAP.md`

This document is the **single source of truth for business entity relationships** in Crepe'n Roll OS.

It defines **business entities only**. It does not define SQL, Prisma, Supabase schemas, database tables, or application code.

When implementation conflicts with this model or with Architecture Freeze v1.0, the freeze and this data model win until an Architecture Decision Record (ADR) changes them.

---

## Purpose

The ERP Core Architecture is frozen. This document defines the **canonical data model** that every future implementation must follow:

- What each business entity is
- Who owns it
- Whether it is mutable or immutable
- How entities relate
- Which module is the source of truth for key quantities and costs

Detailed operational rules for batches, Finished Goods, and Sales remain in their dedicated specs. This document owns **entity identity and relationships**.

---

## Scope Rules

| In scope | Out of scope |
|---|---|
| Business entities | SQL / migrations |
| Relationships | Prisma / ORM models |
| Ownership and mutation rules | Supabase table definitions |
| Lifecycle (business states) | Application code |
| Module dependency graph | UI layouts |

**Inventory Item** in this model means a **raw material** (ingredient). Inventory never stores Finished Goods.

**Finished Good** in this model is a **calculated aggregated view**, not an independent warehouse ledger.

---

## Entity Catalog

### 1. Authentication

| Attribute | Definition |
|---|---|
| **Purpose** | Establish and maintain trusted identity for access to the ERP. |
| **Responsibility** | Session creation, login / logout, credential verification, route protection boundary. |
| **Source of truth** | Authentication module (identity provider / session store). |
| **Owner module** | Authentication |
| **Immutable or mutable** | Session state is mutable for its lifetime; auth events are historically append-oriented. |
| **Lifecycle** | Unauthenticated → Authenticated session → Session expired / revoked / logged out. |
| **Relationships** | Authenticates **User**. Gates access according to **Role** and **Permission**. |

Authentication is the access domain, not a stock or money entity. It does not own inventory, production, or sales truth.

---

### 2. User

| Attribute | Definition |
|---|---|
| **Purpose** | Represent a person (or service actor) who can operate the ERP. |
| **Responsibility** | Identity profile linked to authentication; actor attribution on business actions. |
| **Source of truth** | Authentication / identity domain. |
| **Owner module** | Authentication |
| **Immutable or mutable** | Mutable (profile, status, role assignments). Identity key is stable. |
| **Lifecycle** | Invited / created → Active → Suspended → Archived (soft). Hard delete discouraged. |
| **Relationships** | Many **User** ↔ Many **Role** (via assignment). Indirectly many **Permission** through roles. Creates / updates operational documents in other modules subject to permissions. |

---

### 3. Role

| Attribute | Definition |
|---|---|
| **Purpose** | Group permissions into job-shaped access profiles (e.g. Operator, Manager, Admin). |
| **Responsibility** | Bundle **Permission** grants; assignable to **User**. |
| **Source of truth** | Authentication / authorization domain. |
| **Owner module** | Authentication |
| **Immutable or mutable** | Mutable (name, description, permission set). System roles may be protected. |
| **Lifecycle** | Created → Active → Archived. |
| **Relationships** | Many **Role** ↔ Many **Permission**. Many **Role** ↔ Many **User**. |

---

### 4. Permission

| Attribute | Definition |
|---|---|
| **Purpose** | Atomic authorization capability (e.g. complete sale, execute production, edit inventory). |
| **Responsibility** | Declare what an action requires; evaluated at module boundaries. |
| **Source of truth** | Authentication / authorization domain (permission registry). |
| **Owner module** | Authentication |
| **Immutable or mutable** | Registry entries are largely stable; granting via roles is mutable. Core permission codes should not be casually renamed. |
| **Lifecycle** | Defined → Active → Deprecated / retired (not silently deleted while referenced). |
| **Relationships** | Many **Permission** ↔ Many **Role**. |

---

### 5. Inventory Item

| Attribute | Definition |
|---|---|
| **Purpose** | Master record for a **raw material** (ingredient) held in Inventory. |
| **Responsibility** | Identity, unit, classification, minimum stock, supplier linkage, and read-optimized stock quantity for raw materials only. |
| **Source of truth** | **Inventory** for master data and current raw-material quantity (until stock movements become the ledger of record). |
| **Owner module** | Inventory |
| **Immutable or mutable** | Mutable master data. Quantity changes only through authorized stock mutation paths (Purchases increase; Production Execution deducts). |
| **Lifecycle** | Created → Active → Inactive / Archived. Soft-archive preferred over hard delete when history exists. |
| **Relationships** | Many **Inventory Item** → 0..1 **Supplier** (preferred / default). Referenced by many **Purchase Line**, many **Recipe Ingredient**, and by Production Execution consumption (via recipe / plan). **Never** linked as sellable Finished Goods stock. |

**Rules:**

- Inventory stores raw materials only.
- Inventory never stores Finished Goods.
- Recipes never modify Inventory Item quantity.
- Production Planning never modifies Inventory Item quantity.

---

### 6. Supplier

| Attribute | Definition |
|---|---|
| **Purpose** | Vendor master for parties that supply raw materials. |
| **Responsibility** | Supplier identity, contacts, and commercial reference data for purchasing. |
| **Source of truth** | Suppliers module (vendor master). |
| **Owner module** | Suppliers |
| **Immutable or mutable** | Mutable master data. |
| **Lifecycle** | Created → Active → Inactive / Archived. |
| **Relationships** | One **Supplier** → Many **Purchase**. One **Supplier** → Many **Inventory Item** (optional default linkage). |

---

### 7. Purchase

| Attribute | Definition |
|---|---|
| **Purpose** | Document that records receiving raw materials from a supplier (invoice / receipt header). |
| **Responsibility** | Header for purchase event: supplier, dates, status, totals; triggers raw-material stock increase when completed. |
| **Source of truth** | Purchases module. |
| **Owner module** | Purchases |
| **Immutable or mutable** | **Mutable until completed.** Locked after completion (corrections via controlled reversal / adjustment processes, not silent rewrite). |
| **Lifecycle** | Draft → Completed → (optional Cancelled / reversed via controlled process). |
| **Relationships** | Many **Purchase** → One **Supplier**. One **Purchase** → Many **Purchase Line**. |

**Rules:**

- Purchases increase **raw material** inventory only.
- Purchases never create Finished Goods or Production Batches.

---

### 8. Purchase Line

| Attribute | Definition |
|---|---|
| **Purpose** | Line on a purchase: which Inventory Item, quantity, and cost were received. |
| **Responsibility** | Detail that drives stock increase and cost update for a raw material on purchase completion. |
| **Source of truth** | Purchases module (child of Purchase). |
| **Owner module** | Purchases |
| **Immutable or mutable** | Mutable with parent while Draft; locked when parent Purchase is Completed. |
| **Lifecycle** | Follows parent Purchase (created with draft → locked on complete). |
| **Relationships** | Many **Purchase Line** → One **Purchase**. Many **Purchase Line** → One **Inventory Item**. |

---

### 9. Recipe

| Attribute | Definition |
|---|---|
| **Purpose** | Bill of materials / preparation definition for producing a sellable output. |
| **Responsibility** | Define required raw materials and yields for planning and execution costing inputs. Does **not** mutate stock. |
| **Source of truth** | Recipes module. |
| **Owner module** | Recipes |
| **Immutable or mutable** | Mutable while maintained as master data; versioning may be introduced later without changing ownership. |
| **Lifecycle** | Draft / Active → Inactive / Archived. |
| **Relationships** | One **Recipe** → Many **Recipe Ingredient**. Used by **Production Plan** / **Production Order** (execution references recipe). Linked conceptually to the sellable product / Finished Good identity it produces. |

**Rules:**

- Recipes never modify Inventory.
- Recipes never create Production Batches.
- Sales never consume Recipes.

---

### 10. Recipe Ingredient

| Attribute | Definition |
|---|---|
| **Purpose** | One raw-material requirement line inside a Recipe. |
| **Responsibility** | Quantity of an Inventory Item needed per recipe batch / yield. |
| **Source of truth** | Recipes module (child of Recipe). |
| **Owner module** | Recipes |
| **Immutable or mutable** | Mutable with recipe maintenance. |
| **Lifecycle** | Follows parent Recipe. |
| **Relationships** | Many **Recipe Ingredient** → One **Recipe**. Many **Recipe Ingredient** → One **Inventory Item**. |

---

### 11. Production Plan

| Attribute | Definition |
|---|---|
| **Purpose** | Optional planning document for intended production (requirements only). |
| **Responsibility** | Calculate / capture planned quantities and material needs. **Never** changes stock. **Never** creates accounting entries. **Never** creates Production Batches. |
| **Source of truth** | Production (Planning). |
| **Owner module** | Production |
| **Immutable or mutable** | Mutable while open / in planning; may be closed or cancelled without stock effect. |
| **Lifecycle** | Draft → Confirmed / Scheduled → Closed / Cancelled. Planning remains optional. |
| **Relationships** | One **Production Plan** → Many **Production Plan Line**. May precede one or more **Production Order** executions. References recipes / finished-good targets for planning only. |

---

### 12. Production Plan Line

| Attribute | Definition |
|---|---|
| **Purpose** | Planned output or material requirement line on a Production Plan. |
| **Responsibility** | Hold planned quantities for a finished-good target and/or derived raw-material needs. No stock mutation. |
| **Source of truth** | Production (Planning). |
| **Owner module** | Production |
| **Immutable or mutable** | Mutable with parent plan while planning is open. |
| **Lifecycle** | Follows parent Production Plan. |
| **Relationships** | Many **Production Plan Line** → One **Production Plan**. May reference Recipe and Finished Good identity for planning context. |

---

### 13. Production Order

| Attribute | Definition |
|---|---|
| **Purpose** | Executable production run (Production Execution document). |
| **Responsibility** | Authorize and record execution: deduct raw materials, create exactly one **Production Batch** on successful completion. |
| **Source of truth** | Production (Execution). |
| **Owner module** | Production |
| **Immutable or mutable** | Mutable until executed / completed. After successful execution, the order is historically locked; the created batch is immutable. |
| **Lifecycle** | Draft / Released → In Progress → Completed → (Cancelled before execution only, or controlled abort without batch). |
| **Relationships** | May originate from a **Production Plan**. One **Production Order** → Many **Production Batch** in the general model; **Architecture Freeze v1.0** requires **exactly one Production Batch per successful Production Execution**. References Recipe and Finished Good identity for what is produced. |

**Rules:**

- Production Execution is the **only** module allowed to deduct raw materials.
- Production Execution is the **only** module allowed to create Production Batches.
- One successful execution creates exactly one Production Batch.

---

### 14. Production Batch

| Attribute | Definition |
|---|---|
| **Purpose** | Immutable historical record of finished-goods quantity produced by one Production Execution. |
| **Responsibility** | Store produced quantity, unit cost at creation, produced timestamp, and traceability to the production order and finished-good identity. |
| **Source of truth** | **Production Batch** itself for produced quantity and unit cost. Owned by Production Execution at creation. |
| **Owner module** | Production (Execution) |
| **Immutable or mutable** | **Immutable** (append-only after creation). Sales never edits Production Batches. `remaining_quantity` is **never stored**. |
| **Lifecycle** | Created (Completed execution) → Active (calculated remaining > 0) → Depleted (calculated remaining = 0) → optionally Archived (soft, for history exclusion). Statuses are **derived**, not mutable stock fields. |
| **Relationships** | Many **Production Batch** → One **Production Order**. Many **Production Batch** → One Finished Good identity. One **Production Batch** → Many **Sale Batch Consumption**. |

**Canonical fields (business, not schema):**

- Production order identity
- Finished good identity
- Produced quantity
- Unit cost (frozen at creation)
- Produced at

**Calculated only:**

```
Remaining Quantity =
  Produced Quantity
  − SUM(Sale Batch Consumption quantities for this batch)
```

See [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md) and [`docs/ARCHITECTURE_FREEZE_V1.md`](ARCHITECTURE_FREEZE_V1.md).

---

### 15. Finished Good

| Attribute | Definition |
|---|---|
| **Purpose** | Operational representation of a **sellable product’s available stock** for display and sales validation. |
| **Responsibility** | Aggregate and present availability and cost derived from Production Batches and Sale Batch Consumptions. **Read-only.** |
| **Source of truth** | **Calculated view** — not an independent ledger. Produced truth = Production Batch; consumed truth = Sale Batch Consumption. |
| **Owner module** | Finished Goods (read model between Production and Sales) |
| **Immutable or mutable** | Not a writable stock entity. Displayed values are recalculated. Users never edit calculated stock. |
| **Lifecycle** | Exists as a product-centric view as long as the sellable product exists; availability appears/disappears with production and sales. |
| **Relationships** | One Finished Good identity → Many **Production Batch**. Consumed indirectly through **Sale** / **Sale Line** → **Sale Batch Consumption**. |

**Formulas (canonical):**

```
Available Quantity =
  SUM(Produced − Consumed)
  over eligible (non-archived, remaining > 0) batches
```

**Rules:**

- Finished Goods is **not** a warehouse table.
- Finished Goods is **not** a second source of truth.
- Never store product-level finished-goods quantity as writable inventory.
- Never store `remaining_quantity` on batches.

See [`docs/FINISHED_GOODS.md`](FINISHED_GOODS.md).

---

### 16. Sale

| Attribute | Definition |
|---|---|
| **Purpose** | Customer transaction document (revenue event header). |
| **Responsibility** | Record sale header, status, totals; on completion, drive FIFO allocation and creation of Sale Batch Consumptions. |
| **Source of truth** | Sales module for the sale document; COGS from Sale Batch Consumption only. |
| **Owner module** | Sales |
| **Immutable or mutable** | **Mutable until completed.** Completed sales are locked. |
| **Lifecycle** | Draft → Completed \| Cancelled. Refunded is a future controlled process (not free edit of completed sales). |
| **Relationships** | One **Sale** → Many **Sale Line**. |

**Rules:**

- Sales never modifies Inventory (raw materials).
- Sales never updates Production Batches.
- Sales never creates Finished Goods stock.
- Sales never consumes Recipes or raw materials.
- Draft creates **no** Sale Batch Consumptions.

See [`docs/SALES.md`](SALES.md).

---

### 17. Sale Line

| Attribute | Definition |
|---|---|
| **Purpose** | One sellable line on a Sale (finished good, quantity, price). |
| **Responsibility** | Revenue line detail; on sale completion, quantity is fully allocated across Sale Batch Consumption layers. |
| **Source of truth** | Sales module (child of Sale). Line COGS = sum of its consumption layers. |
| **Owner module** | Sales |
| **Immutable or mutable** | Mutable with parent while Draft; locked when Sale is Completed. |
| **Lifecycle** | Follows parent Sale. |
| **Relationships** | Many **Sale Line** → One **Sale**. Many **Sale Line** → One Finished Good identity. One **Sale Line** → Many **Sale Batch Consumption**. |

**Invariant (on completed sale):**

```
SUM(Sale Batch Consumption.quantity for line) = Sale Line.quantity
```

---

### 18. Sale Batch Consumption

| Attribute | Definition |
|---|---|
| **Purpose** | Immutable FIFO layer recording which Production Batch units were sold on a sale line. |
| **Responsibility** | Permanent audit of consumption quantity and layer cost; **sole source of posted COGS**. |
| **Source of truth** | **Sale Batch Consumption** for consumed quantity and COGS layers. Owned by Sales at completion time. |
| **Owner module** | Sales |
| **Immutable or mutable** | **Immutable** (append-only). Never edited. Never deleted. |
| **Lifecycle** | Created at sale completion only → permanent historical record. Returns / refunds append compensating future events; they do not rewrite consumptions. |
| **Relationships** | Many **Sale Batch Consumption** → One **Sale Line**. Many **Sale Batch Consumption** → One **Production Batch**. |

**Rules:**

- Users never create or edit these records manually.
- Users never choose batches; FIFO is automatic.
- Remaining on a batch is always calculated, never stored.

See [`docs/BATCH_CONSUMPTION.md`](BATCH_CONSUMPTION.md).

---

## Relationship Map

### Access control

```
Authentication
    ↓ authenticates
User
    ↓ assigned
Role
    ↓ grants
Permission
```

```
User  Many ←→ Many  Role
Role  Many ←→ Many  Permission
```

### Purchasing & raw materials

```
Supplier
  1
  ↓
  Many
Purchase
  1
  ↓
  Many
Purchase Line
  Many
  ↓
  1
Inventory Item
```

```
Supplier  1 ←→ Many  Inventory Item   (optional default supplier)
```

### Recipes

```
Recipe
  1
  ↓
  Many
Recipe Ingredient
  Many
  ↓
  1
Inventory Item
```

```
Recipe  →  Finished Good identity   (what the recipe produces)
```

### Production

```
Production Plan
  1
  ↓
  Many
Production Plan Line
```

```
Production Plan  (optional)
  ↓ may lead to
Production Order
  1
  ↓
  Many
Production Batch
```

Architecture Freeze constraint for execution:

```
Successful Production Execution
  1
  ↓ creates exactly
  1
Production Batch
```

```
Production Batch  Many → 1  Finished Good identity
Production Order  →  Recipe (execution input)
```

### Finished goods & sales

```
Finished Good   (calculated view: Produced − Consumed)
  ↑ derived from
Production Batch  +  Sale Batch Consumption
```

```
Sale
  1
  ↓
  Many
Sale Line
  1
  ↓
  Many
Sale Batch Consumption
  Many
  ↓
  1
Production Batch
```

```
Sale Line  Many → 1  Finished Good identity
```

### End-to-end operational chain

```
Supplier
    ↓
Purchase → Purchase Line → Inventory Item (raw materials ↑)
    ↓
Recipe → Recipe Ingredient → Inventory Item
    ↓
Production Plan → Production Plan Line   (optional; no stock change)
    ↓
Production Order (Execution)
    ↓ deducts Inventory Item
    ↓ creates
Production Batch          ← immutable
    ↓
Finished Good (view)      ← calculated Produced − Consumed
    ↓
Sale → Sale Line
    ↓ append
Sale Batch Consumption    ← immutable FIFO layers
```

---

## Ownership Matrix

For every entity: who creates, updates, reads, archives; whether deletion is allowed.

| Entity | Creates | Updates | Reads | Archives | Deletion allowed? |
|---|---|---|---|---|---|
| **Authentication** (session) | Auth system on login | Auth system (refresh / revoke) | Auth middleware / guards | Session end / revoke | Session destroy yes; not a business document |
| **User** | Auth / admin | Auth / admin (self limited) | Authorized modules | Auth / admin (soft) | Hard delete discouraged; soft-archive preferred |
| **Role** | Auth / admin | Auth / admin | Auth / admin; enforcement everywhere | Auth / admin | Only if unused; prefer archive |
| **Permission** | Platform registry / admin | Rare; platform-controlled | Auth enforcement | Deprecate | No casual delete of referenced permissions |
| **Inventory Item** | Inventory | Inventory (master); quantity via Purchases ↑ / Production Execution ↓ | Inventory, Purchases, Recipes, Production, Reports | Inventory | Soft-archive if history exists; hard delete only when unused |
| **Supplier** | Suppliers | Suppliers | Suppliers, Inventory, Purchases, Reports | Suppliers | Soft-archive if purchases exist |
| **Purchase** | Purchases | Purchases while Draft | Purchases, Inventory (effects), Accounting / Reports (future) | Purchases (soft) | Draft may delete; Completed: no hard delete — reverse / adjust |
| **Purchase Line** | Purchases (with header) | Purchases while Draft | Purchases, Inventory effects | With parent | Same as Purchase |
| **Recipe** | Recipes | Recipes | Recipes, Production, Reports | Recipes | Soft-archive if used in production history |
| **Recipe Ingredient** | Recipes | Recipes | Recipes, Production planning | With recipe | With recipe policy |
| **Production Plan** | Production (Planning) | Production while open | Production, Purchases (demand), Reports | Production | Cancel / archive; no stock impact |
| **Production Plan Line** | Production (Planning) | Production while open | Production | With plan | With plan |
| **Production Order** | Production (Execution) | Production until completed | Production, Finished Goods, Reports | Production | Cancel only before batch creation; after complete: no hard delete |
| **Production Batch** | Production Execution only | **Nobody** (immutable) | Finished Goods, Sales (FIFO read), Reports, Accounting | Production / ops soft-archive for eligibility | **Never delete** |
| **Finished Good** | N/A (derived view) | **Nobody** (recalculated) | Finished Goods, Sales, Reports | N/A (product archive is Products domain) | N/A — not a stored stock row |
| **Sale** | Sales | Sales while Draft | Sales, Reports, Accounting (future) | Sales | Draft may cancel/delete per policy; Completed: no hard delete |
| **Sale Line** | Sales | Sales while Draft | Sales, Reports | With sale | Same as Sale |
| **Sale Batch Consumption** | Sales (on Complete only) | **Nobody** (immutable) | Sales, Finished Goods calc, Reports, Accounting (COGS) | N/A | **Never delete** |

---

## Source of Truth Map

| Concern | Source of truth | Owner module |
|---|---|---|
| Session / identity | Authentication | Authentication |
| User profile | User | Authentication |
| Authorization grants | Role + Permission | Authentication |
| Raw material master | Inventory Item | Inventory |
| Raw material quantity | Inventory (read-optimized today; movements later) | Inventory / stock mutation owners |
| Vendor master | Supplier | Suppliers |
| Purchase document | Purchase + Purchase Line | Purchases |
| Recipe / BOM | Recipe + Recipe Ingredient | Recipes |
| Planned production | Production Plan + Production Plan Line | Production (Planning) |
| Execution document | Production Order | Production (Execution) |
| **Produced quantity** | **Production Batch** | Production (Execution) |
| **Batch unit cost** | **Production Batch** (frozen at creation) | Production (Execution) |
| **Consumed quantity** | **Sale Batch Consumption** | Sales |
| **Remaining quantity** | **Calculated** (`Produced − SUM(Consumptions)`) | Derived — never stored |
| **Finished Goods availability** | **Calculated view** | Finished Goods (read model) |
| Sale document / revenue | Sale + Sale Line | Sales |
| **COGS** | **Sale Batch Consumption** | Sales |
| Gross profit | Revenue (Sale) − COGS (consumptions) | Sales / Reports |

### Explicit non-sources

| Forbidden as source of truth for… | Do not use |
|---|---|
| Posted COGS | Production Batch alone, Finished Goods average alone, Recipe theoretical cost, Inventory cost, manual typed COGS |
| Finished Goods quantity | Writable product-level stock field, stored batch `remaining_quantity` |
| Raw material stock after sale | Sales (Sales never touches Inventory) |

---

## Mutation Rules

| Entity | Mutability | Rule |
|---|---|---|
| Authentication session | Mutable for lifetime | Create / expire / revoke only through auth flows |
| User | Mutable | Soft-archive preferred |
| Role | Mutable | Protect system roles |
| Permission | Mostly stable | Do not casually rename or delete live codes |
| Inventory Item | Mutable master; quantity via authorized paths | Only Purchases ↑ and Production Execution ↓ for stock |
| Supplier | Mutable | Soft-archive if historical purchases exist |
| Purchase | **Mutable until completed** | Locked after complete |
| Purchase Line | **Mutable until parent completed** | Locked with parent |
| Recipe | Mutable master data | Never mutates stock |
| Recipe Ingredient | Mutable with recipe | Never mutates stock |
| Production Plan | Mutable while open | Never mutates stock or accounting |
| Production Plan Line | Mutable while plan open | Never mutates stock |
| Production Order | Mutable until executed / completed | After success, historically locked |
| **Production Batch** | **Immutable** | Append-only; Sales never updates; never store remaining |
| **Finished Good** | **Not writable** | Recalculated view only |
| Sale | **Mutable until completed** | Draft editable; Completed locked |
| Sale Line | **Mutable until parent completed** | Locked with parent |
| **Sale Batch Consumption** | **Immutable** | Append-only; never edit; never delete |

### Stock mutation authority (frozen)

| Action | Allowed module | Mechanism |
|---|---|---|
| Increase raw material stock | Purchases | Complete purchase (lines → Inventory Items) |
| Deduct raw materials | Production Execution only | Execute Production Order |
| Create finished-goods availability | Production Execution only | Insert immutable Production Batch |
| Deduct finished goods | Sales only | Insert immutable Sale Batch Consumption (FIFO) |

---

## Module Dependency Graph

Canonical implementation / domain dependency order:

```
Authentication
    ↓
Inventory
    ↓
Purchases
    ↓
Production
    ↓
Finished Goods
    ↓
Sales
    ↓
Reporting
```

### Expanded dependency notes

```
Authentication
    ↓
Inventory ←———— Suppliers (vendor master; may land beside Inventory)
    ↓
Recipes (BOM; depends on Inventory Items)
    ↓
Purchases (depends on Suppliers + Inventory Items)
    ↓
Production
    ├── Planning (optional; Recipes + Inventory; no stock mutation)
    └── Execution (Recipes + Inventory ↓; creates Production Batch)
    ↓
Finished Goods (read model over Production Batch − Sale Batch Consumption)
    ↓
Sales (depends on Finished Goods availability; appends consumptions)
    ↓
Reporting
    ↓
Accounting (future; posts from Accounting Business Events only — see docs/ACCOUNTING.md)
```

Recipes sit **before** Production and inform Purchases/Production planning, but **Purchases** remain the path that increases raw materials. Finished Goods depends on Production Batches immediately and on Sale Batch Consumptions after sales exist.

Do not implement modules out of roadmap order unless explicitly instructed (`ROADMAP.md`, `AGENTS.md`).

---

## Canonical Flow (Architecture Freeze Alignment)

From [`docs/ARCHITECTURE_FREEZE_V1.md`](ARCHITECTURE_FREEZE_V1.md):

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

## Frozen Invariants (Must Hold in Every Implementation)

1. Inventory contains raw materials only.
2. Finished Goods are calculated, not stored as a warehouse ledger.
3. Production Batches are immutable.
4. Sale Batch Consumption is immutable.
5. FIFO is automatic; users never choose batches.
6. Users never edit calculated stock.
7. COGS always comes from Sale Batch Consumption.
8. Remaining quantity is calculated only — never stored on batches.
9. No duplicated finished-goods stock values at product level.
10. Core entity redesign requires an ADR — implementation alone must never redefine this model.

---

## Spec Map

| Concern | Canonical document |
|---|---|
| ERP Core freeze | `docs/ARCHITECTURE_FREEZE_V1.md` |
| **Entity relationships (this document)** | **`docs/DATA_MODEL.md`** |
| Immutable batches + FIFO consumption | `docs/BATCH_CONSUMPTION.md` |
| Finished Goods read model | `docs/FINISHED_GOODS.md` |
| Sales workflow, COGS, returns | `docs/SALES.md` |
| Accounting architecture & posting | `docs/ACCOUNTING.md` |
| Accounting tables / SQL plan | `docs/ACCOUNTING_DATA_MODEL.md` |
| Product vision | `PROJECT.md` |
| Sequencing | `ROADMAP.md` |
| Agent / engineer charter | `AGENTS.md` |

When documents disagree on **stock ownership, immutability, FIFO, or COGS**, Architecture Freeze v1.0 and `docs/BATCH_CONSUMPTION.md` win. When documents disagree on **Accounting posting boundaries or financial ledger ownership**, `docs/ACCOUNTING.md` wins. When documents disagree on **entity identity and relationships**, **this data model** wins, provided it does not contradict the freeze or Accounting architecture.

---

## Explicit Non-Goals

- No application code  
- No SQL, Prisma, or Supabase schema  
- No database tables or migrations  
- No UI  

---

## Summary

This document freezes the **business entity graph** for Crepe'n Roll OS:

- **Access:** Authentication → User → Role → Permission  
- **Supply:** Supplier → Purchase → Purchase Line → Inventory Item  
- **Make:** Recipe → Recipe Ingredient; Production Plan → Plan Line; Production Order → Production Batch  
- **Sell:** Finished Good (calculated) ← Production Batch − Sale Batch Consumption; Sale → Sale Line → Sale Batch Consumption → Production Batch  

Every future module must implement against these entities and relationships — not invent parallel ledgers or mutable remaining quantities.
