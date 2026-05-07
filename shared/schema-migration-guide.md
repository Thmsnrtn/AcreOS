# Schema Migration Guide

**Last updated:** 2026-05-06
**Owner:** Thomas (founder) until otherwise delegated.

## Current state — two parallel migration mechanisms

AcreOS currently runs migrations through TWO parallel paths:

1. **`migrations/*.sql`** — 86 hand-written SQL files (numbered 0000–0073).
2. **`scripts/migrate.mjs`** — idempotent ALTER TABLE list applied as the Fly release command.

The Drizzle journal at `migrations/meta/_journal.json` stops at **0017**. Every migration since 2026-04 has been applied via `scripts/migrate.mjs`.

This works **because every statement in `migrate.mjs` is `IF NOT EXISTS` and re-runnable**. It is brittle for two reasons:

- A future engineer who trusts Drizzle and runs `drizzle-kit migrate` against prod will re-apply already-applied migrations from 0018-0017+ that aren't in the journal. (For pure CREATE/ALTER `IF NOT EXISTS` work this is a no-op; for non-idempotent migrations it would fail.)
- Adding a new migration means BOTH adding a `.sql` file AND adding the equivalent `IF NOT EXISTS` statements to `migrate.mjs`. Forgetting the latter means the migration ships in code but never runs in prod.

## Workstream B.4 — deferred until staging DB access

The directive (`Workstream B.4`) called for regenerating `_journal.json` against current production schema state and verifying with `drizzle-kit migrate` against staging — "should be a no-op."

This step requires:
1. A live staging DB connected via `DATABASE_URL`.
2. Confidence that `drizzle-kit introspect` against staging produces the canonical baseline.
3. A second engineer's review before flipping prod off `migrate.mjs`.

**As of 2026-05-04 in this autonomous run, none of those preconditions are met.** I am not going to regenerate `_journal.json` against an unverified state — the risk of corrupting the migration trail outweighs the inconvenience of running with two mechanisms in parallel.

## Recommended next step (founder-actionable, ~1 day)

When you are ready:

1. **Clone prod schema to staging**: `pg_dump` from prod (schema-only), restore to staging.
2. **Run `drizzle-kit introspect`** against staging — produces a fresh `_journal.json` reflecting current state.
3. **Diff** the new journal against the old. If the diff is sane (mostly new entries reflecting work since 0018), commit.
4. **Run `drizzle-kit migrate`** against staging. Expected: a no-op. If anything fires, it means the journal isn't aligned with reality — STOP and reconcile.
5. **If staging migrate is no-op**: cut over prod's release command to `drizzle-kit migrate` from `scripts/migrate.mjs`. Keep `migrate.mjs` in the tree for one release as a fallback.
6. **One release later**: delete `migrate.mjs`. Drizzle is now canonical.

## Today's policy

- `scripts/migrate.mjs` is the authoritative apply mechanism for prod.
- `migrations/*.sql` files are documentation + the future-Drizzle baseline.
- DO NOT trust `migrations/meta/_journal.json` for migration order.
- New migrations: add a `.sql` file AND add the equivalent `IF NOT EXISTS` statements to `migrate.mjs`.

## Drift catalog — migrations that disagree with `shared/schema.ts`

The schema-drift §3 sweep (2026-05-05) reconciled 87 items into prod. Of those, two tables had migration files that *declared a different shape* than the canonical `shared/schema.ts`. For these, the canonical `CREATE TABLE` lives in `scripts/migrate.mjs` (derived from schema.ts), not in the original migration file. The original SQL files are kept for history but are **stale** — running them against a fresh DB without `migrate.mjs` would produce wrong-shape tables and a downstream `CREATE INDEX` failure.

| Table | Stale source | Canonical now | Drift summary |
|---|---|---|---|
| `field_scout_visits` | `migrations/0003_robust_namora.sql:511-522` | `scripts/migrate.mjs:1290-1307` | 0003 has no `organization_id`, no `status`/`started_at`/`completed_at`/`updated_at`; declares `duration` + `checklist_results` columns that don't exist in schema.ts. Lat/long types differ (numeric vs real). |
| `field_scout_photos` | `migrations/0003_robust_namora.sql:498-509` + `migrations/0072_field_scout_photo_hash.sql` | `scripts/migrate.mjs:1309-1329` | 0003 has no `organization_id`/`url`/`caption`; declares `filename`/`mime_type`/`size_bytes`/`captured_at` columns that don't exist in schema.ts. 0072's `CREATE INDEX ... ON field_scout_photos (organization_id, image_hash)` would fail against the 0003-shape table because `organization_id` was never added by either file. |

**Why not edit 0003/0072 in place?** Drizzle's `_journal.json` records 0003 as applied (in the journal that *is* present, up through 0017). Mutating an already-applied migration risks (a) journal-hash mismatch errors when the journal is regenerated, (b) future ambiguity about what shape was actually applied to which prod-vs-fresh DB. Both files are annotated in-line with deprecation headers pointing to `migrate.mjs`; the bodies are otherwise frozen.

**When the Drizzle-canonical migration cutover happens** (per "Recommended next step" above): regenerate `_journal.json` from a fresh introspect of prod, then add a single new migration that captures the field_scout shape from `shared/schema.ts` and retire the stale 0003/0072 statements. Do NOT do this until the staging-test workflow is in place.

## Why this is OK to defer

The platform-state report flagged the journal drift as "first engineer who runs `drizzle-kit migrate` will break prod" — and that's correct. But the trigger for that break is *someone running drizzle-kit*. Until then, prod is stable.

The hard floor of pre-vertical stabilization is "the platform itself takes priority over expansion velocity." Regenerating the journal carries production risk for cosmetic gain unless paired with the proper staging-test workflow above. The workflow needs an engineer at a console; the autonomous run cannot do it alone.

**Vertical expansion is not blocked by this deferral.** Note Investor's foundation already shipped Wave 12 with a clean migration (0073 after the rename) and `migrate.mjs` is the deploy path that maintains it.
