# OWNER DECISIONS PENDING

> **Four decisions were taken on 2026-08-17.** OD-3 is IMPLEMENTED and closed
> below. OD-1 is DECIDED (hold) and stays listed because the hold is the live
> state. OD-2 is DECIDED and its build is in progress. OD-4 is DECIDED but
> waits on one query only the owner can run.

Genuine owner decisions only. Ordinary engineering — schemas, refactors, tests,
migration mechanics, deletion, dependency ordering — is not escalated here.

Each entry states: the exact decision, the options, a recommendation, the
consequence, and what is blocked. Work continues on other streams meanwhile.

Technical (non-owner) blockers stay in `docs/implementation/BLOCKERS.md`.

---

## OD-1 — DECIDED 2026-08-17: KEEP HOLDING

**Decision:** whether to drop 13 tables from the production database.

**State:** the migration file exists and is complete
(`migrations/0236_drop_experiment_residue_tables.sql`). It is **deliberately
unregistered** from `scripts/migrate.mjs`, which is Fly's `release_command` —
so a merge does not drop anything. The 13 `pgTable` definitions are already
removed from `shared/schema.ts`, so nothing reads or writes them.

**Options:** (a) leave unapplied — dead storage, costs a line in three
registers; (b) inspect the 13 tables, then paste the statements back into
`migrate.mjs` and deploy.

**DECISION: (a) keep holding.** 0236 stays unregistered, so no deploy can
drop anything. Reopen only after the row counts are inspected.

**Original recommendation:** (b), after looking at row counts. All 13 trace to modules
the deletion ledger already recorded as killed. But no session has had
`DATABASE_URL`, so nobody has actually looked inside them.

**Consequence of getting it wrong:** irreversible data loss.
**Blocked:** nothing. This is cleanup, not a dependency.

---

## OD-2 — DECIDED AND IMPLEMENTED 2026-08-17: KEEP REFUSING, ALERT PER ORG

**Decision:** accept the current refusal behaviour, or soften it.

**State:** five customer-visible send paths now refuse for any org with neither
BYO SES credentials nor a verified sending domain. Two are regulated
correspondence (Reg Z §1026.41 periodic statements; statutory disclosures).
This is the 2026-07-17 founder decision working as intended.

**What is missing:** the count of affected orgs. No session has had
`DATABASE_URL`. If a material number of orgs have no connected identity, this
is a silent delivery outage for regulated mail on the next deploy.

**DECISION:** the 2026-07-17 ruling stands unweakened; a founder alert is
raised per affected org so a silent regulated-mail outage becomes visible.

**Original recommendation:** run one query — orgs with neither `aws_ses` integration
credentials nor a verified sending identity — before the next deploy that
carries this. If the number is non-trivial, add a founder alert per affected
org rather than softening the rule.

**DONE.** `emailService.ts` raises a founder alert on the refusal:
`source: email_byo_identity`, `domain: compliance`, severity **warning** (a
customer mid-onboarding is a configuration gap, not an outage of ours — paging
at 3am teaches the founder to ignore the pager), deduped on
`byo-identity-missing:org:<id>` so it fires once per ORG rather than once per
dunning email. The detail names the Reg Z §1026.41 exposure explicitly so the
warning is not triaged as onboarding noise.

Fire-and-forget, and both halves matter: `void` so the refusal is not delayed by
the alert spine, `.catch` so a failing alert can never propagate into the send
path. Observability must not become the thing that changes the decision.

**THE ALERT IS THE MEASUREMENT.** The blocking question was "how many orgs are
affected", which needed a `DATABASE_URL` nobody has had. This answers it one org
at a time, as each is actually hit — no query required, and no org discovered
too late.

9 tests, mutation-checked: a non-per-org dedupeKey fails two of them.

**Blocked:** nothing. The optional query (orgs with neither `aws_ses` credentials
nor a verified identity) would now only tell you EARLIER what the alerts will
tell you anyway.

---

## OD-3 — DECIDED AND IMPLEMENTED 2026-08-17: FIX AND RE-SEED

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

**DECISION: (a), taken 2026-08-17.** The count rises because the gate got its
sight back, not because anything got worse.

**THE MEASUREMENT THE DECISION RESTED ON.**
`node scripts/check-org-scoped-fetch.mjs --blind-spot` reported:

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

**DONE.** `findBodyBrace` is wired into BOTH extractors. The gate reads every
declaration in the corpus and prints its own coverage on every run
(`declarations whose body could not be located: 0`). The four registers were
re-seeded ONCE with a hand-verified sample and are down-only again:

| register | was | now |
|---|---|---|
| entries (method shape) | 171 | 196 |
| rule 2 (method shape) | 59 | 69 |
| function rule 1 | 114 | 130 |
| function rule 2 | 67 | 84 |

The debt did not grow — the gate stopped being blind to it. 58 units became
visible; a sample was verified by hand and none was an artifact:
* **rule 1** (no org anywhere) — `trustEvolution.runTrustEvolution`,
  `platformOpsRepo.getApiUsageStats`: genuine platform ops that never declared
  themselves through `unscopedForPlatformOps(reason)`.
* **rule 2** (has an org, resolves by id anyway) — `campaignOptimizer
  .optimizeCampaign` UPDATEs `campaigns` by PRIMARY KEY ONLY while
  `campaign.organizationId` is on the same object and IS used for the other
  write in that method. A real tenancy weakness on a live write path.

**Follow-on, now unblocked:** those 58 are frozen debt, not fixed code. The
rule-2 entries are the ones to drive down first — each is a live path where a
caller-supplied id can reach another tenant's row.

**A defect was found INSIDE this blind spot, which is what the decision was
weighed against.** `agentKnowledgeGraph.ts:52/94` were both
in the `--blind-spot` sample, and both were wrong: `getAgentKnowledge` filtered
on `agent_type` alone over a table whose `organization_id` is NOT NULL,
returning every tenant's agent memory into what its own docstring calls "the
agent's context for AI calls". It was found by reading the corpus invariant
"the knowledge graph must never become a path around tenancy" and checking it by
hand — not by any gate. That is what 335 unread function bodies costs.

---

## OD-4 — DECIDED 2026-08-17: REPOINT TO 1, AFTER ONE QUERY (awaiting owner)

**Decision:** which organization row the index-analyzer job should act on.

**State:** `shared/tenancy/systemOrg.ts` now owns `SYSTEM_ORG_ID = 1`, and seven
call sites import it. `server/jobs/indexAnalyzer.ts:22` still declares its own
`const PLATFORM_ORG_ID = 0` and uses it for three reads of
`organization_integrations`.

`organizations.id` is a `serial`, which starts at 1, so a row with id 0 does not
exist unless someone inserted it deliberately. The job most likely reads nothing
at all — and because it READS rather than writes, it fails as an empty result
rather than an error, which is exactly how it went unnoticed.

**Options:** (a) repoint it at `SYSTEM_ORG_ID`; (b) leave it, if org 0 really
does exist and holds its integrations; (c) delete the job if the reads are dead.

**DECISION: (a) repoint to `SYSTEM_ORG_ID`, once the owner confirms.**
Run `SELECT id FROM organizations WHERE id IN (0, 1);` and paste the result —
the one-line change lands immediately after. Deliberately NOT done blind:
repointing a live job changes which tenant's rows it touches.

**THIS IS THE ONE ITEM STILL WAITING ON THE OWNER.**

**Blocked:** nothing. `agentMemoryTenancy.test.ts` pins the disagreement so it
cannot quietly disappear while it remains true.

---

## OD-5 — OPEN: thirteen verticals claim `core` on evidence that stops short

**Decision:** what the public should be told about the twelve-to-thirteen
verticals AcreOS advertises as `core` but cannot demonstrate.

**This is queued, not acted on, because it is a customer-facing claim.**
Relabelling is a product statement and therefore yours. The measurement is
mine, and it is now committed and ratcheted (`verticalReadiness.test.ts`).

**The measurement.** All 15 verticals declare `maturity: "core"`. Projecting
what the repository can actually show:

| evidenced | verticals |
|---|---|
| `decided` (records a decision snapshot) | **2** — `fix_and_flip`, `subdivider` |
| `surfaced` (has modules + real templates, closes nothing) | **13** |

Every vertical has a genuine surface — 4–7 spotlight modules, 2–5 workflow
templates, and every declared template id resolves to a real engine
definition. Not one dangling string. **The gap is the loop, not the surface**,
so no amount of UI work moves it; only wiring a vertical through
scenario → decision → outcome does.

**Where the claim is actually published — two public surfaces, and they can
already drift:**

1. **Landing page** (`Positioning.tsx`) renders 14 chips (all but `hybrid`),
   every one solid `core` with no qualifier — the strongest available claim.
   It has a sanctioned conservatism channel, `DEMOTE_ON_LANDING`, requiring a
   written reason and only ever moving a vertical DOWN. **That map is empty**,
   and its docstring gives the reason: *"the registry's maturity declarations
   are the audited truth."* That is the sentence this measurement contradicts.
2. **`GET /api/trust/verticals`** — unauthenticated, publishes raw
   `maturity` straight from the registry, and **respects no demotion at all**.
   So a demotion you approve for the landing would not reach it.

**Also found, and worth a separate line: that endpoint has zero callers.** Its
own docstring says it exists "so the landing page can filter" — the landing
does not call it; it derives from the registry directly. It is a publicly
reachable, uncached-by-any-consumer claim surface that nothing in this
repository reads.

**Options:**
- **(a) Demote in the registry** to what the evidence shows (`beta` for the 13).
  Honest immediately, and both public surfaces follow automatically — the
  landing already derives from the registry. Cost: the site advertises two core
  verticals instead of fifteen.
- **(b) Keep the registry, demote only the public claim** via
  `DEMOTE_ON_LANDING` with dated reasons, and make the trust endpoint respect
  the same map. In-app onboarding still reads `core`.
- **(c) Keep all fifteen at `core`** and close the gap by wiring verticals
  through the canonical loop. Truthful eventually; the claim stays ahead of the
  evidence until each one lands.
- **(d) Leave it.** The ratchet holds the gap at 13 and it can only shrink.

**RECOMMENDATION: (b), plus retire the unconsumed endpoint.** It stops the
public overclaim now without throwing away work that genuinely exists — the 13
verticals are real surfaces, not vapour, and `beta` in the registry would
understate the in-app experience a customer actually gets. (a) is the more
honest-looking option but it demotes the *product* to fix a *claim*. Under (b)
the fix lands where the problem is: on what strangers are told before they can
see it for themselves. Then (c) as engineering, per vertical, raising the
evidence rather than lowering the claim.

**What I would do on your word, none of it started:** move the demotion map
into `shared/` so one channel governs both public surfaces; populate it with 13
dated entries; either delete `/api/trust/verticals` or wire it through the same
map. The ratchet lowers in whichever commit earns it.

**Consequence of getting it wrong:** a prospective customer is told fifteen
verticals are what AcreOS is for, discovers two, and correctly concludes the
rest of the product is oversold too. Reputational, not recoverable by a patch.

**Blocked:** nothing. The gap is counted and down-only whichever way you go.
