# ADR 011: Polymorphic `note_table` Discriminator on `periodic_statement_skips`

**Status**: Accepted
**Date**: 2026-06-02
**Deciders**: Iris (CTO), Beatrice (CRO)

## Context

Reg Z §1026.41 requires a periodic statement to be delivered to consumer
mortgage borrowers each billing cycle, with narrow named exceptions (e.g.,
servicing transfers, fixed-rate small-servicer, charged-off accounts). An
examiner's first question when a statement is missing is *"why?"* — and
silent skips are examiner-readable negligence. Beatrice's 2026-06-02
§1026.41 servicer-scope ruling (`docs/legal/acquired-notes-1026-41-ruling.md`)
made the audit primitive explicit: **every skip must persist a row naming
the borrower, the cycle, the reason, and the regulatory subsection that
authorised it.**

Two note tables exist in production: the original `notes` flow
(originated loans, integer primary key) and the newer `acquired_notes`
flow (notes purchased from a third party, UUID primary key — see
commits `8202d23e` and `5d3391b9`). Both are servicer-scope candidates
under §1026.41(a) when the consumer-purpose, collateral-is-dwelling, and
servicing-arrangement predicates hold. The audit ledger must cover both
without forcing a vertical-per-table proliferation.

## Decision

A single `periodic_statement_skips` table with a **polymorphic
`note_table` discriminator** — `text NOT NULL` constrained by a
`CHECK (note_table IN ('notes', 'acquired_notes'))` — plus a `note_id text`
column that holds the FK value as text (the resolver casts back at read
time based on the discriminator).

The unique index is composite on `(org_id, note_table, note_id, cycle_start)`
so re-running the §1026.41 cron for the same (org × note × cycle) is a
DB-level no-op via `ON CONFLICT DO NOTHING`. Implementation lives at
`shared/schema/reg-z.ts:392-428` (Drizzle declaration) and
`scripts/migrate.mjs:4526-4540` (mirrored SQL with the CHECK constraint
applied via the standard `DO $$...$$` `pg_constraint` guard so re-runs of
the release_command are safe).

## Rationale

Two genuinely viable alternatives were on the table:

| Concern | Option A — Two tables (`notes_statement_skips` + `acquired_notes_statement_skips`) | Option B — Polymorphic discriminator (CHOSEN) |
|---------|--------------------------------------------------------|------------------------------------|
| **Read-path simplicity** | Two queries to answer "every skip this org logged this quarter" — risk of one being forgotten | One `WHERE org_id = ?` query, regardless of which note table the row points at |
| **Future note types** (rent-to-own, contract-for-deed) | Each new vertical requires a new ledger table + a new migration + a new audit query | Each new vertical extends the CHECK constraint and the resolver switch — no new table, no new audit query |
| **Examiner clarity** | An examiner reading two tables side-by-side must reconcile them mentally | An examiner reading one append-only ledger sees the full history at a single SQL statement |
| **FK strength** | Native FK constraint per table — DB-enforced referential integrity | FK enforcement moves to the writer (since SQL FKs can't be polymorphic) — a small loss of DB-level integrity |
| **Type safety in app code** | Each table has a typed `noteId: integer` or `noteId: string` — no resolver dance | `noteId: text` everywhere; the resolver dispatch on `noteTable` is a 6-line switch |
| **Migration cost when shipping the next vertical** | One full migration + audit-query update + Beatrice re-review | CHECK constraint extension + resolver case — Beatrice reviews the new vertical only, not the audit primitive |

For an audit primitive where the read-path question is "what skips
happened, and why," Option B wins on every dimension that matters to
the examiner-readability bar Beatrice enforces. The cost — losing
DB-level FK integrity — is mitigated by:

1. The writer always being the §1026.41 cron, which fully validates
   the note exists before inserting.
2. The audit pattern being append-only — no UPDATE / DELETE — so a
   stale `note_id` after a hypothetical cascade-delete on the source
   table is still examiner-correct as a historical record of "what we
   decided at cycle close."

The same convention was deliberately adopted by `respa_outreach_events`
(`shared/schema/reg-z.ts:449+`) for §1024.39 early-intervention, so a
future reg-watch surface can pull both ledgers with the same shape.

## Consequences

**Positive constraints:**

- Adding a third note vertical (e.g., a `seller_financed_notes` table)
  requires only: extend the CHECK constraint via an `ALTER TABLE`,
  extend the resolver switch, write the new persistence path. No new
  audit ledger.
- The audit query `SELECT * FROM periodic_statement_skips WHERE org_id = ? AND created_at >= ? ORDER BY created_at DESC` is the single canonical surface for both Beatrice's weekly compliance review and any future examiner export.
- The `citation text NOT NULL` requirement is enforced at insert time — the writer cannot persist a skip without naming the §-subsection that authorised it.

**Negative constraints (the cost named):**

- Polymorphic FKs are not enforced by Postgres. A future contributor
  who inserts a row with `note_table = 'notes'` and a `note_id` that
  doesn't exist in `notes` will succeed at the DB layer. The writer is
  the only safeguard. If a second writer ever lands (manual SQL fix, a
  one-off backfill script), it MUST validate the note exists before
  inserting — call out in code review.
- Joining the ledger to either source table requires a `WHERE note_table = '...'` filter plus a runtime cast — Drizzle's join helpers don't model this. Reads use raw SQL or two queries with app-layer assembly.
- If a fourth or fifth note type is added, the CHECK constraint and
  resolver switch will grow. At ~6 verticals or more, ADR-NNN supersedes
  this one with a single `note_id` + `note_resolver_key` lookup table.

## References

- Commit `8202d23e` — `reg z #201: acquired_notes schema columns + periodic_statement_skips ledger` (the original implementation)
- Commit `5d3391b9` — `reg z #201: predicate-gated generator extension to acquired_notes` (the writer that uses the ledger)
- Commit `4608f85b` — `reg z #201: §1026.36(c) piggyback on acquired-note payments + late fees` (sibling extension that re-uses the polymorphic pattern)
- Beatrice ruling: `docs/legal/acquired-notes-1026-41-ruling.md` §4 audit-primitive
- Regulation: 12 C.F.R. §1026.41 (periodic statement requirement) + §1026.41(e) (exceptions)
- Sibling ledger: `respa_outreach_events` (`shared/schema/reg-z.ts:449+`) — same convention applied to §1024.39
