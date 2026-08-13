# ADR 0001: Sales Consumes Recipes and Raw Materials via the Assembly/Component Model

## Status

Accepted (retroactively) — 13.08.2026.

Both changes described below were designed, implemented, verified live on dev and production Supabase projects, and merged to `cursor/erp-architecture-foundation` before this ADR was written. This document formalizes decisions already made and shipped, so `docs/ARCHITECTURE_FREEZE_V1.md`'s Architecture Change Policy has a written record to point to.

## Context

`AGENTS.md`'s "Production Batch and Finished Goods rules" originally stated, without exception:

- Sales never consume Recipes.
- Sales never consume Raw Materials.

These rules existed to protect a specific invariant: **Production Execution is the sole module allowed to deduct Raw Materials and create Production Batches** (see AGENTS.md's "Stock mutation authority" table). The rule prevented Sales from inventing a second stock ledger, bypassing the immutable Production Batch → Sale Batch Consumption pipeline, or mutating stock outside a single, auditable path — the same principle the project's Transaction-First Rule states generally ("Do not invent a second ledger for money or stock").

The rule was written under an implicit assumption: every sellable item is *fully pre-produced ahead of time* — Production Execution runs a batch, Sales later sells from that batch via FIFO, and nothing else ever touches Raw Materials except Production Execution.

That assumption did not match Crepe'n Roll's actual business: it is a food truck operating **made-to-order**. Payment happens before cooking, and the assembled dish sold to the customer (e.g. "Chicken Crepe") is itself never pre-produced as a whole — only some of its parts are (dough, fillings, sauces, cooked proteins). Two gaps followed from this mismatch, found and closed on different dates:

1. **Critical Finding #4 (07.08.2026, commit `c287df8`).** `confirm_sale` assumed every sold `product_id` was itself sitting in `production_batches` as a pre-produced Finished Good. That is only true for a directly-sold Component; it is false for the assembled dish, which is never produced ahead of time and therefore could never be sold under the old model (quoting `sql/085`'s own header comment on this).
2. **Plan item 10 (13.08.2026, commits `03961da` / `00919a9`).** Even after the Assembly model existed, every Assembly component still had to be a pre-produced Component recipe with a real `production_batch` — including raw, no-cook add-ins (sliced cucumber, lettuce) that never require a production cycle at all. The only workaround was faking a Component recipe and running it through a real Production Session just to get a batch to FIFO-allocate against — workable, but conceptually wrong and operationally awkward for something that isn't "production" in any real sense.

## Decision

Extend the frozen model with two additive, narrowly-scoped mechanisms, both fully inside `confirm_sale` and its supporting schema — no change to Production Execution, Production Batch immutability, or Finished Goods derivation:

**1. Assembly/Component `recipe_role` (07.08.2026, `sql/085`, commit `c287df8`).**
`recipes.recipe_role` (`'component' | 'assembly'`). A `component` recipe behaves exactly as Sales always did — sold directly, FIFO-allocated from its own `production_batches` via `allocate_finished_goods_fifo`. An `assembly` recipe is never itself pre-produced; `recipe_components` declares its bill-of-components (which Component recipes it needs, and how much of each). `confirm_sale`, for an `assembly` line, walks `recipe_components` and FIFO-allocates each component's own `production_batches` — one call per component, same underlying FIFO primitive, same `finished_goods_batch_consumptions` ledger.

**2. Direct raw-ingredient add-ins (13.08.2026, `sql/089` + `sql/090`, commits `03961da` / `00919a9`).**
`recipe_components` gained an optional second target, `ingredient_id`, mutually exclusive with `component_recipe_id` (enforced by a `CHECK` constraint and by `enforce_recipe_component_roles`, which now validates a Component-role recipe for one branch or ingredient existence for the other). For an `ingredient_id` row, `confirm_sale` calls `decrement_ingredient_stock` — the **same internal primitive `complete_production_session` already uses** for Production Execution's own raw-material deduction — and appends a `stock_movements` row (`movement_type='sale_out'`, `reference_type='sale'`). Cost comes from `ingredients.cost_per_unit`, the same static field Production Execution already reads; nothing new was invented for costing. `verify_sale_cost_and_profit` (`sql/090`) and the client-side COGS read path (`sale-cogs-service.ts`) were both extended to sum this second ledger alongside `finished_goods_batch_consumptions`, so the independent server-side money check still covers the full figure.

This is deliberately **not** a general license for Sales to touch Raw Materials. The only path in is an explicit `recipe_components.ingredient_id` row on an `assembly` recipe — a declared BOM entry, gated by the same triggers/constraints as a Component entry. Production Execution remains the exclusive authority for every raw material consumed by a *cooked* Component; nothing about that changed. No second stock ledger was invented — the ingredient branch reuses Production Execution's own decrement primitive and the project's one shared `stock_movements` table.

## Consequences

- The Assembly/Component `recipe_role` model (both `recipe_components` targets) is now the accepted, permanent architecture for how Sales fulfills a sale line — not a temporary deviation awaiting cleanup.
- A future extension that fits the same shape (an assembly component resolved from a still-different, equally narrow, explicitly-declared source) does not require a new ADR. **Replacing** this model — e.g. removing `recipe_role`, collapsing the two `recipe_components` targets back into one, or introducing a third consumption path outside `recipe_components` — does require one, per `docs/ARCHITECTURE_FREEZE_V1.md`'s Architecture Change Policy.
- `AGENTS.md` ("Sales never consume Recipes." / "Sales never consume Raw Materials.") and `ROADMAP.md` ("FIFO Sales Strategy") are updated by this same change to point here instead of contradicting shipped, approved behavior.
- Not yet closed for the end user: `recipe-editor-modal.tsx` has no UI for adding an `ingredient_id` component to an Assembly recipe — only `component_recipe_id` is selectable today. The only way to add a raw-ingredient add-in right now is a direct SQL insert. UI work is a separate, not-yet-started next step.
- `docs/ARCHITECTURE_FREEZE_V1.md` — the baseline authority document itself, not just `AGENTS.md`/`ROADMAP.md` — is also updated by this ADR: its "### Sales" section ("COGS comes only from Sale Batch Consumption") and Frozen Business Rule #8 ("COGS always comes from consumed batches") stated the same now-incomplete claim, for the same reason. Both now name the `ingredient_id` exception and link back here, so the baseline document and the two specs elaborating it (`AGENTS.md`, `ROADMAP.md`) are consistent with each other and with shipped behavior.
