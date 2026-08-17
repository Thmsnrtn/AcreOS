# OWNER DECISIONS PENDING

Genuine owner decisions only. Ordinary engineering — schemas, refactors, tests,
migration mechanics, deletion, dependency ordering — is not escalated here.

Each entry states: the exact decision, the options, a recommendation, the
consequence, and what is blocked. Work continues on other streams meanwhile.

Technical (non-owner) blockers stay in `docs/implementation/BLOCKERS.md`.

---

## OD-1 — Apply migration 0236? (13 experiment-residue tables)

**Decision:** whether to drop 13 tables from the production database.

**State:** the migration file exists and is complete
(`migrations/0236_drop_experiment_residue_tables.sql`). It is **deliberately
unregistered** from `scripts/migrate.mjs`, which is Fly's `release_command` —
so a merge does not drop anything. The 13 `pgTable` definitions are already
removed from `shared/schema.ts`, so nothing reads or writes them.

**Options:** (a) leave unapplied — dead storage, costs a line in three
registers; (b) inspect the 13 tables, then paste the statements back into
`migrate.mjs` and deploy.

**Recommendation:** (b), after looking at row counts. All 13 trace to modules
the deletion ledger already recorded as killed. But no session has had
`DATABASE_URL`, so nobody has actually looked inside them.

**Consequence of getting it wrong:** irreversible data loss.
**Blocked:** nothing. This is cleanup, not a dependency.

---

## OD-2 — BYO send-rail rollout blast radius is unmeasured

**Decision:** accept the current refusal behaviour, or soften it.

**State:** five customer-visible send paths now refuse for any org with neither
BYO SES credentials nor a verified sending domain. Two are regulated
correspondence (Reg Z §1026.41 periodic statements; statutory disclosures).
This is the 2026-07-17 founder decision working as intended.

**What is missing:** the count of affected orgs. No session has had
`DATABASE_URL`. If a material number of orgs have no connected identity, this
is a silent delivery outage for regulated mail on the next deploy.

**Recommendation:** run one query — orgs with neither `aws_ses` integration
credentials nor a verified sending identity — before the next deploy that
carries this. If the number is non-trivial, add a founder alert per affected
org rather than softening the rule.

**Blocked:** nothing in code. This is an operational verification.

---

## OD-3 — Tenancy gate re-seed raises a baseline

**Decision:** approve a one-time upward re-seed of the tenancy register.

**State:** `scripts/check-org-scoped-fetch.mjs` finds a function body with
`indexOf("{", parenClose)`, which lands on the brace of an inline
`): Promise<{ … }> {` return type. Measured: **348** `async function`
declarations in `server/` carry that shape, and the flaw is at TWO sites, so
both the method and function extractors are affected. Those bodies are never
scanned — they are silently exempt from a tenant-isolation gate.

**Options:** (a) fix the finder, re-seed the register upward with a
hand-verified sample, keep it down-only from there — the same move that
produced the original 122 and the prompt-envelope re-seed; (b) fix and drive
the new offenders to zero immediately; (c) leave it recorded.

**Recommendation:** (a). The count rises because the gate got its sight back,
not because anything got worse — but it IS a baseline raise, and this repo
requires sign-off for that.

**MEASURED 2026-08-17, so the decision is no longer abstract.**
`node scripts/check-org-scoped-fetch.mjs --blind-spot` now reports the real
number without touching the verdict:

  909 files scanned
  335 async functions whose BODY the current extractor never reads
    0 declarations the correct finder also cannot resolve

That second number was **1** when first measured, and the one was the finder's
own bug, not an exotic construct: it bailed on the `=` of `=>`, so any function
returning a FUNCTION TYPE was unreadable
(`operator.ts:198`, `Promise<((prompt: string) => Promise<string>) | null>`).
Fixed and mutation-tested. It is at 0 over the whole corpus now, and
`orgScopedFetchCoverage.test.ts` fails if it ever leaves 0 — a shape the finder
refuses is a shape the FIXED gate would skip, which is coverage loss worth
catching before the re-seed rather than after.

The correct body-finder (`findBodyBrace`) is already written and tested in the
gate; it walks the return-type annotation tracking `<>`, `()` and `[]` depth and
skipping strings and comments, and returns -1 rather than guessing. It is
DELIBERATELY NOT WIRED into the verdict, because doing so would re-baseline the
frozen registers as a side effect of a bug fix. Wiring it is one line in
`main()`.

**What approving (a) costs:** one line to wire, then a re-measure, then a
hand-verified sample before freezing — the same discipline used for the
function-shape widening (0 → 122) and the prompt-envelope re-seed (0 → 15).

**Blocked:** honest measurement of tenancy coverage. The gate's current number
understates the debt by up to 335 function bodies.
