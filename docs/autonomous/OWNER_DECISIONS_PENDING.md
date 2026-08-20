# OWNER DECISIONS PENDING

> **TWO DECISIONS ARE OPEN: OD-8 and OD-9, at the bottom. The other seven are taken.**
>
> OD-2, OD-3, OD-4 and OD-5 are DECIDED AND IMPLEMENTED. OD-1 is DECIDED (hold)
> and stays listed because the hold is the live state. OD-6 is DECIDED (accept
> the cascade) with nothing to build — the code already behaves that way; it is
> recorded so the choice is deliberate rather than inherited, and it is the one
> to revisit at Customer #1. OD-7 was opened and closed on 2026-08-19.
> **OD-8** (opened 2026-08-20) asks whether AcreOS assesses late fees or only
> advises on them. **OD-9** (same day) asks whether the tracking-number pool is
> shared across tenants; the conservative reading is already implemented, so it
> asks whether to reverse, not whether to act. Nothing is blocked on either.

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

## OD-4 — DECIDED AND IMPLEMENTED 2026-08-17: REPOINTED TO SYSTEM_ORG_ID

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

**DECISION: (a), taken without the query.** The owner chose to repoint rather
than wait, and the reasoning holds without a database: `organizations.id` is a
`serial`, so row 0 cannot exist unless someone inserted it deliberately, and org
1 is what four other sites and two live services already call the platform org.

**DONE.** `indexAnalyzer.ts` imports `SYSTEM_ORG_ID`; all six sites now agree.

**THE QUEUED NOTE UNDERSTATED THIS, and the correction is the interesting part.**
It described a READ that returns nothing. `saveReport` also INSERTs with that id
(:239), so the write failed its foreign key on EVERY weekly run — and the catch
logged it at INFO with the error object discarded:

    logger.info("[IndexAnalyzer] Could not persist report (org 0 may not exist)")

`getLastReport` then found nothing, so `GET /api/admin/index-analysis`
(founder-only, routes-admin.ts:2771) has been answering *"No analysis run yet"*
indefinitely while the job computed a report every Sunday and threw it away. A
wrong tenant id and a swallowed error are individually survivable; together they
are invisible. The catch is now a WARN carrying the real error.

`agentMemoryTenancy.test.ts` pinned the 0-vs-1 disagreement. That assertion was
REWRITTEN to the new truth rather than deleted — it now fails if any private
platform-org constant reappears, or if the shared import is dropped — and it is
scanned with comments stripped, because the first version matched the very
comment explaining what had been removed.

**Blocked:** nothing.

---

## OD-5 — DECIDED AND IMPLEMENTED 2026-08-17: DEMOTE THE PUBLIC CLAIM

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

**DECISION: (b), plus retire the unconsumed endpoint.** It stops the public
overclaim now without throwing away work that genuinely exists — the 13
verticals are real surfaces, not vapour, and `beta` in the registry would
understate the in-app experience a customer actually gets. (a) is the more
honest-looking option but it demotes the *product* to fix a *claim*. Under (b)
the fix lands where the problem is: on what strangers are told before they can
see for themselves.

**DONE.** `shared/business-types/publicClaims.ts` is now the ONE conservatism
channel — `PUBLIC_CLAIM_DEMOTIONS`, 13 entries, each carrying a written reason
and the date it was decided, each demoting to `beta` (not a hedge chosen by
feel: `beta` demands evidenced `surfaced`, and all 13 evidence exactly that, so
the public claim now equals the evidence). The landing renders 2 core chips and
12 Beta chips instead of 14 solid core — twelve, not thirteen, because
`hybrid` carries a demotion entry but is excluded from the chip list.

`GET /api/trust/verticals` is retired rather than wired. It had ZERO callers,
and its own comment claimed it existed "so the landing page can filter" — the
landing derives from the registry directly and never called it. Keeping a
second public claim surface alive to fix it would have preserved the drift risk
for no consumer.

**The enforcement is a HARD ZERO, not a ratchet**, and that distinction is the
point. (It also had to be made real: as first written this block only mapped
over the registry and never read a public surface, so an independent audit
reinstated the retired endpoint rendering raw `maturity` and the suite stayed
green. It now scans the landing, marketing and public route files for a direct
`.maturity` read, and both mutations fail it.) The registry ratchet stays at 13 because `maturity` still says `core` —
your deliberate choice. But `verticalReadiness.test.ts` now also asserts that no
PUBLIC tier outruns its evidence, with no tolerance, because after the
demotions there is no gap left to budget for. It reuses the same `overclaims`
law rather than re-deriving the ladder, and it fails in BOTH directions: drop a
demotion and an overclaim reappears; leave one in place after a vertical starts
recording decisions and it fails as stale, since a vertical that earns `core`
back must not be understated indefinitely. Mutation-tested 4/4.

**Consequence of getting it wrong:** a prospective customer is told fifteen
verticals are what AcreOS is for, discovers two, and correctly concludes the
rest of the product is oversold too. Reputational, not recoverable by a patch.

**Blocked:** nothing. The gap is counted and down-only whichever way you go.

---

## OD-6 — DECIDED 2026-08-17: ACCEPT THE CASCADE, REVISIT AT CUSTOMER #1

**Decision:** what happens to `earnest_money_events` when an organization is
deleted. Legal, therefore yours.

**Context, and it is not the same as the decision.** Until 2026-08-17,
`earnest_money_events` was made append-only by two rewrite RULES
(`ON UPDATE/DELETE … DO INSTEAD NOTHING`, migrations/0086). A rewrite rule
rewrites PostgreSQL's OWN foreign-key check queries, so
`DELETE FROM organizations` aborted with *"referential integrity query …
gave unexpected result"* — **measured for an organization with zero
earnest_money_events rows.** The rule did not need matching data; it broke the
check itself.

That statement is `server/services/orgDeletion.ts:122`, the GDPR erasure path.
**No organization could be deleted, ever.** The rules also made UPDATE a silent
no-op, so a tamperer got the same answer as a legitimate write.

**Already fixed, as engineering, because none of it was a choice anyone made:**
migration 0239 replaces the rules with a BEFORE UPDATE trigger. UPDATE is still
refused and now refuses loudly; DELETE cascades normally; org deletion works.
Verified against PostgreSQL 16 — UPDATE refused with the value unchanged, org
deletion cascading a real escrow event returning `DELETE 1`.

**What is left for you.** With DELETE unblocked, erasing a customer now also
erases their escrow event trail. Options:

- **(a) Accept it.** Erasure removes the rows. Retention, if required, lives in
  exported records outside the live database.
- **(b) Export before erase.** `deleteOrganization` writes escrow events to
  cold storage first, then deletes. More moving parts, and the export becomes
  the thing that must not be lost.
- **(c) Anonymise instead of delete** for this table — sever the org link, keep
  the financial record. Depends on whether the events are personal data once
  detached, which is a question for counsel.

**DECISION: (a), revisit at Customer #1.** Nothing has run through this table in
production yet, so there is no trail to lose today, and (b) and (c) both add
machinery to protect data that does not exist. What matters is that the choice
is made deliberately before the first real escrow event rather than discovered
afterwards.

**Nothing to build.** Migration 0239 already produces exactly this behaviour:
UPDATE refused, DELETE allowed, org deletion cascading normally. This entry
exists so that when the first escrow event lands, the retention posture is a
recorded decision rather than a side effect of how a foreign key was declared.

**The trigger to revisit is Customer #1 with real escrow activity** — at that
point (b) or (c) becomes a live question for counsel, and
`evidenceClaimsIntegrity.test.ts` will still be preventing anyone from
"solving" it by reinstating a rewrite RULE.

**Consequence of getting it wrong:** either an unerasable store of counterparty
personal data (the state we were in, unintentionally), or a financial audit
trail that vanishes with the customer who left.

**Blocked:** nothing. `evidenceClaimsIntegrity.test.ts` fails if any migration
reintroduces `DO INSTEAD NOTHING`, so the broken mechanism cannot return while
this is open.

---

## OD-7 — DECIDED 2026-08-19 (delegated back to the session): REMOVE IT

**Decision:** whether a customer may choose Pax's model at all, and if so
whether that choice may exceed the model tier their plan pays for.

**The defect that raised it (fix it either way).** The picker is broken end to
end and returns a **422**. `client/src/components/pax-copilot-rail.tsx:1294`
offers `fast | balanced | powerful | reasoning | claude` and posts the raw
string; `server/routes-ai.ts:419` accepts a `z.enum` of raw model ids
(`gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`,
`claude-3-5-sonnet-20241022`, `claude-3-haiku-20240307`,
`deepseek/deepseek-chat`). **The two sets do not intersect**, and the route
`safeParse`s, so any selection other than "Auto" fails validation — the customer
gets an error and no answer, on the primary AI surface, and the choice is
persisted to `localStorage` so it keeps failing until they set it back. Six of
the seven server-side ids are also names no provider in this system serves
(bare or dated), which is how it stayed invisible: nobody could reach the code
path that would have 404'd.

**Why this is not just a bug fix.** `server/ai/executive.ts:1522` resolves
`modelOverride || visionFallback || costRoutedCeiling || result.model` — the
override wins over `pickPaxModelForOrg`'s tier ceiling AND its monthly soft-cap
downgrade. Making the picker work as written would hand every free-tier org an
Opus selector that bypasses the margin guard this codebase deliberately built
(`campaignOptimizer.ts:186`). executive.ts's own comment says the override is
for "founder dashboard, eval harness" — the customer rail sending it looks like
drift, not design.

**Options.**
(a) **Clamp.** Server accepts the tier vocabulary the client already sends, maps
    it to `MODELS.*`, then clamps to the org's ceiling. The customer keeps a
    real choice, bounded by what they pay for; "powerful" on a free plan quietly
    resolves to the free ceiling rather than erroring.
(b) **Remove the picker from the customer rail.** Keep `modelOverride` for the
    founder dashboard and eval harness, as executive.ts describes. Auto already
    routes per turn — the tooltip literally says "Auto picks the right brain for
    each question" — and the constitution's "Pax stays ambient fabric" line
    argues against giving customers model dials at all.
(c) Leave it. Not viable: it is a live 422 either way.

**DECISION: (b) — removed, 2026-08-19.** Raised in the picker; the owner
returned it with "use your best and highest judgement and decide", so the call
is the session's and the reasoning is recorded here and in cross-pollination
ledger 37. Implemented in the same commit: the `Select` and its `localStorage`
preference are gone from the rail, `modelOverride` is gone from the stream
schema, from `ChatOptions`, and from both resolution chains in
`ai/executive.ts`. `paxTierCeilingIsTheCeiling.test.ts` pins the shape rather
than the identifier and is falsified against `HEAD~1`'s actual source.

One thing the options below understated, found while implementing: the two
defects were each other's camouflage. Six of the seven server-side enum ids were
names no provider serves, and the seventh (`deepseek/deepseek-chat`) is the
CHEAPEST model in the registry — so the only value that both validated and
existed made the org cheaper. The ceiling bypass was real and unreachable at the
same time, and would have become reachable the moment someone made the enum
match the picker. That is the obvious repair, and it is the wrong one.

**Original recommendation: (b), remove it.** The picker offers a choice the product
philosophy says Pax should be making, its labels do not map to anything the
customer can reason about, and (a) costs a model-ordering concept plus a clamp
that has to stay correct as tiers change — real machinery to preserve a control
nobody has been able to use. If the choice should exist, "Fast vs Thorough" as
an explicit latency/cost trade is a better product than a model list, and that
is a design task rather than a repair.

**Consequence of (b):** one component edit, one zod field narrowed to the
founder path. **Consequence of (a):** the same plus a tier ladder and its own
gate, because an override that silently exceeds a ceiling is a margin hole with
a UI.

**Blocked meanwhile:** nothing. Ledger 36 fixed the provider-side ids around it;
the picker itself is untouched pending this.

---

## OD-8 — OPEN 2026-08-20: does AcreOS ASSESS late fees, or only advise on them?

**The decision.** `server/services/lateFees/index.ts` is a complete, correct
12 C.F.R. §1026.36(c)(2) late-fee implementation — the anti-pyramiding rule, with
the pure predicate (`shouldAssessLateFee`), the DB writer (`assessLateFee`), a
unique index on `(loan_id, period_start)` making re-runs a no-op, and two test
files. **Nothing in production calls it.** It has been dead since it was written,
and it is the ORIGINAL worked example named in the reachability gate's own
description; the gate could not see it until 2026-08-20 because a comment
somewhere used the symbol's name.

The live path is `server/jobs/acquiredNoteAging.ts` — registered, daily,
delinquency + RESPA §1024.39 sweep. It computes a `lateFeeAdvisory` per note and
its header states plainly that it "touches no ledger, and moves nothing." So the
product today OBSERVES that a late fee would be assessable and never assesses one.

**Why this is not an engineering call.** Wiring the assessor writes fee rows
against a borrower's loan. That is money charged to a real counterparty by
software, on the customer's book, under a federal rule with a specific
prohibition attached. Whether AcreOS does that at all — versus surfacing the
advisory and letting the servicer act — is a product and liability posture, not a
missing import.

**Options.**
(a) **Stay advisory.** Delete `lateFees/index.ts`, keep the advisory in the aging
    job, and let the operator assess fees in their servicing system. Cheapest,
    and consistent with "be the rail, not the provider" — though note that rule is
    about MONEY MOVEMENT, and a fee assessment is a ledger entry, not a transfer,
    so it does not decide this on its own.
(b) **Wire it behind an explicit per-org opt-in** that defaults OFF, with the
    assessment visible in the ledger and reversible. The reg-compliant behaviour
    already exists; what is missing is the setting, the call site in the aging
    job, and a surface that shows what was assessed and why.
(c) **Wire it on by default.** Not recommended: it changes what the product does
    to borrowers of every existing org without anyone choosing it.

**Recommendation: (b).** The implementation is the expensive half and it is done
and tested. A default-OFF opt-in makes assessment a decision an operator takes
rather than a behaviour they discover, and the non-pyramiding guarantee — which
is the part that is easy to get wrong and easy to be sued over — is already
correct in code. (a) is defensible and cheaper; what argues against it is that
the advisory already tells the operator a fee is due, so the product is doing the
hard reasoning and stopping one step short of the useful part.

**Consequence of (b):** one org setting, one call site in a job that already
computes the inputs, one read surface. **Consequence of (a):** a deletion, and
the §1026.36(c)(2) logic is rebuilt from scratch if this is ever revisited.

**Blocked meanwhile:** nothing. The module is inert either way; it is held in
view by the `moduleOrphans` baseline rather than allowlisted, so it cannot be
forgotten.

---

## OD-9 — OPEN 2026-08-20: is the tracking-number pool shared across tenants, or per-org?

**Not blocking.** The conservative reading is already implemented; this asks
whether to reverse it.

**What was found.** `assignNumber` (`server/services/comms/tracking-pool.ts`)
recycles phone numbers from a pool. Its candidate scan carried **no organization
predicate**, so the pool was platform-wide while everything around it was
per-org. A request from org B could pick up org A's assignment — released, or
merely idle past the 60-day window while still ACTIVE — force-release it, and
re-insert the same number under org B.

Three consequences, none of them a query-shape nicety:

1. `attributeInbound` resolves purely on number + `releasedAt IS NULL`, so
   inbound SMS and calls to a number org A **printed on physical mail** would
   then file under org B.
2. Org A's still-active assignment is cancelled by a stranger's request.
3. Numbers are BYO — `twilio.rentNumber` resolves credentials per org — so a
   recycled number can sit on and bill to **org A's own carrier account**, which
   is the money-custody ruling's territory.

**What was done, and why without asking first.** The scan is now scoped to the
requesting org. The unknown resolves toward caution: this file's own header
describes recycling "across campaigns" and never across orgs, and nothing in
code or comment sanctions a shared pool. Leaving a live cross-tenant
number-recycling path open while a question sat in a queue was not the safer
choice.

**The decision.** Was the pool meant to be platform-shared?

(a) **No — per-org, as now implemented.** Nothing further to do. Cost: a number
    released by one org is never recycled by another, so the platform rents
    slightly more numbers than a shared pool would.
(b) **Yes — platform-shared.** Then the predicate comes out, and three things
    have to be built that do not exist: a hard exclusion of rows with
    `releasedAt IS NULL` from the idle branch (never force-release an active
    assignment); a documented rule for what happens to inbound traffic on a
    recycled number, since the current attribution would misfile it; and an
    answer to whose carrier account pays, since recycling a number provisioned
    on org A's BYO Twilio credentials to org B moves a cost onto a customer's
    own account.

**Recommendation: (a).** The saving in (b) is a few dollars of carrier rent; the
cost is a cross-tenant identity and billing surface that would need three new
guarantees to be safe. If number economics later matter, a *platform-owned* pool
kept separate from BYO numbers is the version of (b) worth building — the
problem in (b) is not sharing, it is sharing numbers that belong to a customer.

**Blocked meanwhile:** nothing.
