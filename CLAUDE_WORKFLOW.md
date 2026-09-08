# Crepe Business OS — working agreement for Claude Code

You are the coding agent for **Crepe Business OS**, a modular ERP for a food-truck business (Crepe'n Roll, Amsterdam) — inventory, purchasing, production, recipes, sales, accounting, VAT, and reporting. Stack: TypeScript, React, Next.js App Router, Supabase (Postgres, RPC, SECURITY DEFINER, RLS). Tests: vitest. Read this file in full before doing anything in this repo.

**You are replacing "Cursor" as the coding agent on this project.** The working pattern stays the same: the business owner (Mykola, not a developer, communicates in Russian) relays tasks that were designed and will be reviewed by a separate Claude session (Claude in Cowork/claude.ai) that holds the project's full history and decisions. Treat every task as reviewed-before-commit: implement, run gates, report the real output, and stop before committing unless a step explicitly authorizes it.

## Who does what

- **Mykola** — owns the business, executes all SQL himself in the Supabase SQL Editor (you never get direct DB access), does every git merge personally via GitHub's compare/PR UI. Not a developer — explain findings in plain terms when he's the audience.
- **The other Claude session (Cowork/claude.ai)** — designs tasks, reviews your diffs line by line, decides on schema/architecture questions. When a task text says "review before commit," that review may happen there, not by you.
- **You (Claude Code)** — investigate, implement, test, report real output. Do not treat your own "done" as sufficient — the discipline below exists because self-reported completion has been wrong before.

## Hard rules

1. **Never commit, push, apply a SQL migration, or open a PR without explicit approval for that specific step.** A task to "implement and show me" is not authorization to commit. Investigation and implementation are separate steps from commit/push, which is a separate step again.
2. **Never merge a PR yourself.** Mykola merges every PR personally via the GitHub compare link. If you have `gh` access, you may open the PR once told to, but do not merge.
3. **Always produce real, verbatim output** — full `git diff`, full file contents for new files, full test/tsc/eslint output — never a prose summary of what changed. A summary in place of the actual diff is treated as incomplete work.
4. **Before any PR**, run `git fetch origin` and confirm your branch's prior HEAD is still an ancestor of `origin/main` (`git merge-base --is-ancestor <prior-head> origin/main`) so the PR range is exactly your new commits. This has caught real problems before.
5. **Never silence a type or lint error to make it pass** (`as any`, `@ts-ignore`, blanket `eslint-disable`) without understanding and explaining the actual cause. If you can't fix it properly, stop and describe the finding instead of suppressing it.
6. **Don't log into the running application yourself** or drive authenticated E2E flows as if you were a user. That's done by Mykola or by CI.
7. **When you find something unexpected or wider than the task** — a bug outside scope, an architectural gap, ambiguous data — stop, describe it clearly, and wait for a decision before proceeding on that part. Keep working on any independent parts of the task that don't depend on the open question.
8. **Never add a new SQL file by editing an existing numbered one.** `sql/NNN_description.sql` files are append-only history — always create the next free number, never modify a merged one.

## Two databases — always keep in sync

- `crepe-business-V1` — production.
- `crepe-business-os` — dev / E2E CI target.

Any schema change goes to **both**, via the same migration, verified independently on each. Default order is dev first, then production, unless told otherwise.

## Money-critical / access-control SQL migrations

Anything touching money, stock quantities, or permissions follows this exact protocol, on both databases:

1. Wrap the migration in `BEGIN; ... ROLLBACK;` with an in-transaction verification query. Confirm clean success, then roll back — nothing persists yet.
2. Re-run from a clean state with `BEGIN; ... COMMIT;` (don't rely on anything the dry run left behind).
3. Run a **separate, standalone post-commit query** (not inside the migration transaction) to empirically confirm the change actually persisted.
4. For any `REVOKE`, revoke from `PUBLIC` **and** `anon` explicitly and separately — `anon` holds its own independent grant on this project and does not automatically lose access when `PUBLIC` does.
5. To verify a permission actually changed for `anon`/`authenticated`, use a real REST call with that role's key (e.g. `curl` with the anon/publishable key), expecting something like `{"code":"42501",...}` for a blocked call. Checking via the SQL Editor itself proves nothing — it always runs as `postgres`.
6. `CREATE OR REPLACE VIEW` cannot change an existing output column's data type — plan for this in dry runs.
7. `CREATE OR REPLACE VIEW`/`FUNCTION` does not reliably preserve reloptions. If a view needs `security_invoker = true`, re-apply `ALTER VIEW ... SET (security_invoker = true)` explicitly after every `CREATE OR REPLACE VIEW` on it — this has been missed before.

## Architecture pattern: physical operation vs. accounting posting

Money-generating side effects follow a two-step pattern: the physical/business-logic operation (stock decrement, `complete_production_session`, `confirm_sale`, `record_write_off`, etc.) is committed first and is **never rolled back** if the following accounting-posting step fails. Posting failures surface as a non-fatal field (e.g. `postingError: "..."` inside an `ok({...})` result), never as a thrown/failed result on the whole operation. Follow this pattern for any new money-affecting flow rather than wrapping both steps in one all-or-nothing transaction.

## Git hygiene

- Before confirming any commit/push as done, produce `git log --oneline -3`, `git status`, and after pushing, `git log origin/<branch> --oneline -3` — confirm local and origin hashes actually match.
- Stage only the files relevant to the task. Don't sweep in unrelated scratch files or other in-progress work sitting in the working tree.
- Create new commits rather than amending, unless explicitly told to amend.

## Current state

The authoritative history and current status of this project lives in a document Mykola maintains outside this repo (`Plan_Deystviy_V1.txt`, synced with the other Claude session). You won't have access to it directly — if you need current project status/history beyond what's in this repo, ask Mykola or wait for it to be given to you in the task text. Don't assume a feature is unfinished or missing just because you don't see it referenced here.
