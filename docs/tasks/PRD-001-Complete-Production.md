# PRD-001 — Complete Production

## Priority

Critical

---

# Goal

Implement the complete Production Finish workflow.

This is the first business transaction that changes the real state of the system.

When a Production Session is finished, the system must:

1. Validate Production Session
2. Validate Inventory Availability
3. Consume Raw Materials
4. Create Inventory Transactions
5. Calculate Actual Production Cost
6. Create Production Batch
7. Register Finished Goods
8. Mark Session as Completed

Everything must execute inside a single database transaction.

---

# Business Rules

## BR-001

Only Production Sessions with status `IN_PROGRESS` may be completed.

---

## BR-002

Completed Sessions are immutable.

---

## BR-003

Inventory must never become negative.

---

## BR-004

Only Actual Produced Quantity is used.

Never Planned Quantity.

---

## BR-005

Production Batch is created only after successful inventory consumption.

---

## BR-006

If any operation fails:

Rollback entire transaction.

No partial updates.

---

# Workflow

Finish Production

↓

Load Production Session

↓

Validate Status

↓

Load Recipe

↓

Calculate Actual Ingredient Consumption

↓

Validate Inventory

↓

BEGIN TRANSACTION

↓

Create Inventory Consumption Transactions

↓

Create Production Batch

↓

Calculate Batch Cost

↓

Register Finished Goods

↓

Update Production Session

↓

COMMIT

---

# Database Transaction

Everything below must be inside one DB transaction:

- inventory movements
- production batch
- finished goods
- costing
- session status

No exceptions.

---

# Production Batch

Batch must include:

- Batch Number
- Product
- Actual Quantity
- Unit
- Production Date
- Production Session ID
- Total Cost
- Unit Cost
- Status

---

# Inventory

Create immutable Inventory Transactions.

Never modify balances directly.

Inventory balance must be derived from transactions.

---

# Cost Calculation

Total Cost =

Sum(actual consumed ingredients)

Unit Cost =

Total Cost / Actual Produced Quantity

---

# Session Update

Status

COMPLETED

CompletedAt

Current timestamp

CompletedBy

Current User

---

# Validation

Reject completion when:

- session not found
- wrong status
- recipe missing
- insufficient inventory
- actual quantity <= 0

---

# Error Handling

Return meaningful domain errors.

Never expose database errors to UI.

---

# Logging

Log:

ProductionCompleted

with

- Session ID
- Batch ID
- Product ID
- Produced Quantity
- Total Cost

---

# Acceptance Criteria

## Happy Path

Given

Session IN_PROGRESS

Enough inventory

When

Finish Production

Then

Inventory consumed

Batch created

Finished Goods registered

Session completed

Transaction committed

---

## Inventory Failure

Given

Not enough ingredients

Then

No Inventory Transactions

No Batch

No Finished Goods

Session remains IN_PROGRESS

---

## Database Failure

Force exception during Batch creation.

Expected:

Everything rolled back.

Inventory unchanged.

---

## Double Finish

Second Finish request

Must return domain error.

No changes.

---

# Code Requirements

Use existing architecture.

Do not move business logic into controllers.

Do not duplicate inventory logic.

Keep services cohesive.

Follow Repository + Service pattern.

---

# Testing

Required:

- Unit Tests
- Integration Tests

Cover:

✓ Happy Path

✓ Rollback

✓ Validation

✓ Inventory shortage

✓ Double completion

---

# Deliverables

Implementation

Migration (if needed)

Tests

Build passes

Lint passes

No TypeScript errors
