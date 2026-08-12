# BLOCKERS

Items that cannot proceed without something this session cannot safely supply.
A blocker does not stop the program — it stops one item. Record it, state the
unblock condition, move to the next unblocked work.

**None of the work completed so far was blocked.** Everything below is work
identified as valuable and deliberately not attempted.

---

## B1 — Live-database verification of the two new tables

**What:** `evidence_claims` and `decision_snapshots` are verified by unit tests
against the pure kernel, by the schema→migration mirror gate, and by tsc. They
have **not** been exercised against a real Postgres.

**Why blocked:** `DATABASE_URL` is not set in this environment (the pre-commit
`check-agent-claims` hook reports the same and fails open).

**Unblock:** run `npm run db:push` (or apply `migrations/0227` + `0228`) against
a dev/staging database, then exercise
`POST /api/decisions` and `GET /api/properties/:id/evidence`.

**Risk if skipped:** low but real — the mirror gate proves a `CREATE TABLE`
exists in the deploy path, not that the DDL and the Drizzle types agree on every
column. This is exactly the "schema shipped with no migration would have 500'd
on deploy" class named in CLAUDE.md, one step further along.

---

## B2 — Production deploy of the two migrations

**What:** `migrations/0227_evidence_claims.sql` and
`migrations/0228_decision_snapshots.sql` are registered in `scripts/migrate.mjs`
(the Fly `release_command`) and are idempotent, so they apply on the next
deploy.

**Why blocked:** deploying to production is outside this session's authority.

**Unblock:** founder deploy. No data migration or backfill is required — both
tables start empty and both are purely additive.

---

## B3 — Which agent identities are customer-facing

**What:** BI101 wants ONE primary customer-facing Pax, with specialists as
internal capability bundles unless a separate identity demonstrably helps. The
repo has Pax, Solene, Atlas, Sophie, Beatrice, Iris and Soren surfaces plus ~30
`solene-*` schema modules.

**Why blocked:** most appear to be founder-plane, which BI25 explicitly permits.
Consolidating a *founder* agent because a *customer* rule says "one Pax" would
be a misapplication of the audit. Determining which are genuinely customer-facing
requires the reconnaissance report, and any consolidation is a founder product
decision, not a correctness fix.

**Unblock:** founder ruling on which named identities customers should ever see.

---

## B4 — Parcel / Property separation

**What:** `properties` conflates cadastral identity with economic state
(BI9). Separating them is the largest remaining Reality Graph delta.

**Why not attempted:** it touches `properties`, the single most-read table in
the repo, with ~150 write sites. V42 explicitly lists high-risk refactors to
avoid *even pre-customer*. Doing it safely needs a staged migration with a
compatibility projection, and it should follow — not precede — the Opportunity
and Relationship primitives that determine what the split needs to support.

**Mitigation already in place:** `evidence_claims.subjectType` accepts `parcel`
today and cadastral facts are already claimed against it, so the separation
becomes a `subject_id` backfill rather than a re-interpretation of recorded
history.

**Unblock:** not blocked by anything external — blocked by sequencing. Do
Opportunity + Relationship first.
