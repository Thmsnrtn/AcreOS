# EXECUTION LEDGER

One entry per completed, verified work unit. Append-only in spirit: correct an
entry if it was wrong, never delete one because the work was superseded.

Branch: `claude/acreos-canonical-implementation-1asgvc`
Base: `016c619` (Wave 5 — all 15 verticals at honest core)

---

## Unit 1 — Canonical architecture registry · `9034306`

**Audit requirement:** BL6 program P12 "Constitution"; BK102 (Audit 100)
"extract 10–15 non-negotiable laws, put them in CLAUDE.md/ADR index, make PRs
declare affected laws"; BI164 "Claude Implementation Constitution".

**Premise verified first:** the repo already had two registry+ratchet pairs for
governance (`shared/governance/constitution.ts` for founder decisions,
`shared/governance/statuteRegister.ts` for legal obligations) but nothing for
*architecture*. No duplicate was created — the same pattern was extended.

**Files:** `shared/architecture/canon.ts` (new),
`tests/unit/canonicalArchitecture.test.ts` (new).

**Tests:** 18 pass. Verifies every claimed table exists among the 752 declared in
the Drizzle schema; every enforcement ref resolves on disk; a "canonical" object
carries no gap and a non-canonical one must state its gap in >40 chars; an
unenforced fitness function names no refs and an enforced one names at least one.
Two down-only ratchets plus a staleness check that fails if a count drops without
the baseline being lowered in the same commit.

**Architectural decision:** architecture law is registered *separately from*
founder business decisions. Both bind; they govern different things. Pax and
Founder OS are registered as explicit NON-layers with their prohibitions, so a
future change that gives either its own truth store fails a test rather than a
code review.

**Headline finding:** only **4 of 18** canonical objects had a canonical home
(organization, user, deal, workflow-run). The repo's breadth — 752 tables — had
been built on a Reality Graph that was never made canonical.

**Drift discovered:** the audit's factual claims about ActionReceipt, evidence
provenance and the kernel/pack seam are all obsolete at HEAD. Recorded as
corrections in the commit message and in `NEXT_UP.md` §6.

**Gates:** tsc clean · lint:boundaries PASS · lint:browser-safe-shared PASS ·
lint:ratchets PASS.

---

## Unit 2 — Evidence Fabric · `7b80e76`

**Audit requirement:** BI13 (EvidenceClaim is the atomic truth primitive), BI14
(canonical resolved value is a projection), BI138–140 (unknown / conflict /
confidence rules), BK13 (Audit 011 "Evidence Fabric Implementation"), BL5
workstream 3.

**Premise verified first — and it materially changed the design.** The audit
says evidence has no provenance. False at HEAD: `LookupResult`
(`server/services/providers/types.ts`) already carries provider, source,
confidence, `DataClassification`, `fetchedAt`, `sourceAsOf` and `stale`;
`DATA_LICENSE_REGISTER` already carries per-source licence and redistribution
posture; the broker already computes a per-category `provenance` map naming the
authoritative source. The gap was one line:
`propertyEnrichment.savePropertyEnrichment()` collapsed the whole run into a
single `properties.enrichmentData` JSONB blob and overwrote the previous one.
**Provenance survived the fetch and died at the write.** So the unit built the
*persistence and resolution* half only — no second acquisition architecture.

**Files:** `shared/evidence/claim.ts`, `shared/schema/evidence.ts`,
`migrations/0227_evidence_claims.sql`, `scripts/migrate.mjs` (mirror),
`server/services/evidence/evidenceStore.ts`,
`server/services/evidence/enrichmentToClaims.ts`,
`server/services/propertyEnrichment.ts` (wiring),
`server/routes-property-enrichment.ts` (lineage API),
`shared/schema.ts` (barrel), `scripts/ratchets/table-count.json` (756→757).

**Tests:** 37 pass (23 resolution + 14 adapter/wiring). The resolution suite is
the falsifiable form of laws 2 and 3: absent boolean never becomes `false`,
absent number never becomes `0`, "never asked" reads differently from "asked, no
answer", two equally authoritative sources disagreeing produces `conflict` with
both values retained, an authoritative source beating a model does *not*, stale
downgrades without deleting, and resolution is deterministic and as-of.

**Architectural decisions:**
- **One table, not five.** Source registry stays code (`data-licenses.ts`),
  predicate vocabulary stays a typed registry, resolved value stays a pure
  recomputable projection. Law 11 — infrastructure must be earned.
- **Append-only with no `updatedAt` column.** A row that can be updated is a row
  whose history can be rewritten.
- **`subject_id` carries no FK** so `parcel` claims can be recorded today even
  though Parcel has no table, making the eventual Parcel/Property split a
  backfill rather than a re-interpretation of history.
- **No source, no claim.** An enrichment that attributed nothing yields zero
  claims. **Raw facts only** — `floodRisk`, `overallRiskScore` and `accessScore`
  are AcreOS's own arithmetic and must never become evidence (BI177).

**Newly discovered drift:** `lint:reachability` flagged +5 unwired exports *in
this unit's own code*. Fixed the occurrence: the read path became a real route,
one reader became module-private, and the speculative batch reader was **deleted**
rather than kept for a consumer that does not exist.

**Remaining risk (named, not hidden):** only the property-enrichment write path
emits claims. Bulk import, manual edit, due-diligence, residential comps and the
AVM/ARV surfaces still write unattributed values straight onto canonical rows.
`evidence-traceability` therefore stays `partial` with that gap written into the
registry.

**Gates:** `npm run check` PASS (tsc + 21 lints) · all ratchets at baseline.

---

## Unit 3 — Decision Memory · `c863bf1`

**Audit requirement:** BI20 (DecisionSnapshot is the durable boundary), BI91
(a decision records its Strategy Pack version), BK28 (Audit 026 "Decision
Snapshot Fidelity"), BL2 conclusion 4 (DecisionSnapshots are a first-class moat),
BL5 workstream 6.

**Premise verified first:** the repo has **fourteen** decision-shaped tables —
`board_decisions`, `ceo_decision_replays`, `decisions_inbox_items`,
`decision_patterns`, `solene_decisions`, `solene_decision_traces`,
`solene_pre_call_decisions` and more. Every one is founder/autopilot
control-plane state. None records a *customer's* investment decision or freezes
its inputs. Reusing one would have made Founder OS the owner of customer
investment truth (BI5 forbids).

**Files:** `shared/decisions/snapshot.ts`,
`shared/schema/decision-snapshots.ts`,
`migrations/0228_decision_snapshots.sql`, `scripts/migrate.mjs` (mirror),
`server/services/decisions/decisionStore.ts`, `server/routes-decisions.ts`,
`server/routes.ts` (mount), `server/routeManifest.ts` (+ snapshot),
`shared/schema.ts` (barrel), `scripts/ratchets/table-count.json` (757→758).

**Tests:** 18 pass. The central test writes a snapshot, then mutates the
evidence underneath it — a new claim arrives, a source changes its mind, an
unknown becomes known — and asserts the snapshot still reports what was believed
then. Immutability is pinned three ways: no `updatedAt` column, no
UPDATE/DELETE in the store, no PUT/PATCH/DELETE endpoint.

**Architectural decisions:**
- **`unknowns` is derived, not supplied.** The honest half of a decision record
  is exactly what a hurried caller omits, so the freeze function reads it out of
  the resolved evidence itself. A known-but-stale fact becomes a recorded caveat
  too.
- **`assumptions` keep their origin** (`user` vs `strategy-pack-default` vs
  `derived` vs `platform-default`). Conflating them is how a platform default
  silently becomes "what the customer believed".
- **Not a column on `deals`.** A `pass` — the most under-recorded and most
  valuable decision an investor makes — happens when no deal exists and never
  will.
- **`subject_id` carries no FK** so a snapshot survives its subject; an investor
  who passed on a property and deleted it still needs the record of why.

**Dependency note:** this could not have been built before Unit 2. A
DecisionSnapshot has nothing stable to freeze a reference to until evidence is
versioned — which is exactly why the canonical chain puts evidence at layer 3
and decisions at layer 5.

**Newly discovered drift:** `res-status-raw` flagged a new `res.status(201)`
(172 are already frozen in its baseline) — the route returns 200 with the
created id instead. The `routeManifest` snapshot flagged the new route file; its
own description says additions must be intentional, so it was updated
deliberately.

**Also hardened:** the canon test's lookup-helper assertion had pinned
`evidence-claim: absent`, which Unit 2 made false. Re-pinning it to the next
still-absent object would move the same staleness one commit down the road, so
it now asserts the helper *agrees with the registry* while the statuses stay
pinned by the ratchets designed to move.

**Gates:** `npm run check` PASS · tsc clean · 84/84 across the five affected
suites · reachability at baseline 654.

---

## Cumulative effect

| Metric | Before | After |
|---|---|---|
| Canonical objects with a canonical home | 4 / 18 | **6 / 18** |
| Fully unenforced fitness functions | 2 | **1** |
| Tables | 756 | 758 (both bumps justified in the ratchet note) |
| New tests | — | **73** |

---

## Unit 4 — Infrastructure restraint gate · this commit

**Audit requirement:** BI56 (the non-canonical primitive list), BI152 (the New
Database Test), BI57/BI61 (vector infrastructure and the one primary relational
database), BL7 ("What Not to Build Merely Because These Audits Mention It"),
canonical law 11.

**Premise verified first:** the repo *passes* BI56 today — 165 dependencies,
zero graph DBs, vector services, streaming buses, warehouses, k8s clients,
service meshes or search clusters. So this is a **preventative** gate, not a
remediation one, and the exception list is legitimately empty.

**Files:** `scripts/check-infrastructure-restraint.mjs` (new),
`tests/unit/infrastructureRestraint.test.ts` (new), `package.json` (wired into
`npm run check`), `shared/architecture/canon.ts`,
`tests/unit/canonicalArchitecture.test.ts` (baseline 1 → 0).

**Tests:** 12 pass. They run the **real script** against synthetic repos in a
temp directory, because a check that only ever passes is indistinguishable from
one that cannot fail — the most likely way for a green gate to be silently
broken.

**They caught two genuine bugs in the gate itself:**

1. A `\b` word-boundary anchor before `@` meant `@kubernetes/client-node` and
   `@elastic/elasticsearch` could never match — the two scoped-package rules
   were dead on arrival.
2. A dependency-only scan missed `image: elasticsearch:8` in a compose file.
   Infrastructure arrives through **config** at least as often as through npm.

Fixed by splitting each rule into `dep` (package names) and `infra` (service and
image names), so a bare word can be matched in config without false-positiving
on prose.

**Deliberate non-overreach:** pgvector is **not** banned. A Postgres extension
runs inside the one primary relational database, so it is a derived index rather
than an alternate system of record — permitted by BI57 and required by BI61. A
gate that banned it would be wrong and would be disabled within a week. A
standalone vector *service* remains banned, and a test pins both halves.

**Effect:** `unenforced-fitness` ratchet **1 → 0**. Every one of the audit's
twelve fitness functions now has at least partial automated enforcement, and the
baseline stays at 0 — a new fitness function may only be registered *with*
enforcement.

**Gates:** `npm run check` PASS (now 22 lints).

---

## Unit 5 — Governed side effects: action-boundary idempotency · this commit

**Audit requirement:** canonical law 8, BI74 (idempotency at the action/provider
boundary), BI75 (receipts), BK36 (Audit 034 "Idempotency & Side-Effect Safety"),
AU28 (ambiguous outcome), BI148 SLO "no duplicate consequential action after
retry".

**Premise verified first — and it is a concrete money-losing defect, not a
theoretical one.** `server/middleware/idempotency.ts` is HTTP-request-scoped: an
`Idempotency-Key` header, 24h TTL, in-memory fallback. It protects a *client*
retrying a POST. It does nothing for the case that costs money — a background
**job** retrying after a partial success, which never passes through an HTTP
request. `directMailService.sendLetter()` deducts credits, posts the Lob piece
cost to the ledger, then calls Lob; a crash between Lob accepting the letter and
the result being recorded makes the retry deduct credits again, post cost again,
and **print a second physical letter to a real seller**. `preMailDedupe.ts` does
not catch it — that is an audience policy, not retry safety.

**Files:** `shared/schema/outward-actions.ts`,
`migrations/0229_outward_actions.sql`, `scripts/migrate.mjs` (mirror),
`server/services/actions/outwardAction.ts`,
`server/services/directMailService.ts` (wiring),
`shared/schema.ts` (barrel), `scripts/ratchets/table-count.json` (758→759),
`shared/architecture/canon.ts`.

**Tests:** 22 pass (18 semantics + 4 coverage).

**Architectural decisions:**
- **The classifier is pure.** `classifyExisting(existing, hash)` is the entire
  safety property, and a property that can only be tested against a live
  database is one that will not be tested. The branches that matter most — a
  concurrent in-flight claim, an unknown outcome, a key reused with different
  content — are one-liners in the test.
- **`ambiguous` is terminal and refuses.** AU28: a timeout *after* the request
  left is neither success nor failure. Most implementations treat it as failure
  and retry, which is exactly how a double-send happens.
- **An unclassified throw records `ambiguous`, not `failed`.** The conservative
  reading of "we don't know what happened" is the one that does not double-send.
- **Payload-hash mismatch is checked before status.** A reused key is a caller
  bug in every status; replaying a stale success for new content would silently
  *suppress* a send the caller wanted.
- **This table is deliberately MUTABLE**, unlike `evidence_claims` and
  `decision_snapshots`. It is operational state, not history. BI76: claims,
  receipts, decisions and outcomes are different things and must not collapse
  into one log. The immutable proof remains a receipt.
- **Replay throws rather than fabricating a `SendResult`.** The original
  expected-delivery date is unknown at replay time, and inventing one is exactly
  what `check-no-fabrication.mjs` exists to prevent.

**Remaining risk, stated as a number rather than a caveat:** the primitive is
available and **adopted at zero call sites**.
`tests/unit/outwardActionCoverage.test.ts` holds `UNPROTECTED_SEND_SITES_BASELINE
= 4` down-only — routes-campaigns (×2), apiQueue (a *retry queue* calling an
unprotected send, the exact defect shape), and communications. Email, SMS and
e-sign are not covered by the ratchet at all, and the test says so in its own
header rather than implying coverage it does not have.

**Correction made during the unit:** the first baseline said 5 and named
`mail/providers/lob.ts`. Running the scanner showed 4, and that file calls
`directMail.ts`, a different module. Baseline and comment corrected to the
verified truth.

**Gates:** `npm run check` PASS (22 lints) · reachability at baseline 654 · all
ratchets at baseline · 22/22 new tests.

---

## Unit 6 — The ratchet was measuring the wrong module · this commit

**Not a planned unit.** Found while starting the adoption work unit 5 pointed
to, and worth its own entry because the failure class is the one CLAUDE.md warns
about hardest.

**What happened:** `directMailService` is exported by **two different modules**
— `server/services/directMailService.ts` (a function module) and
`server/services/directMail.ts` (a class instance). Both call Lob directly. The
symbol is identical at every call site, so a name-only scan cannot tell them
apart.

Unit 5 added the `idempotencyKey` option to the **function module**. The
coverage ratchet counted four sites — and three of them call the **class**.
Passing a key at those sites would have **lowered the number while protecting
nothing**: the worst possible outcome for a governance gate, and precisely the
"built but unwired" defect this repo names as its most common.

**Fix — the occurrence, not the baseline:**

1. `directMail.ts` now accepts `idempotencyKey` on both `PostcardOptions` and
   `LetterOptions` and routes through the same boundary via a private
   `guardedSend`, throwing `MailAlreadySentError` on replay rather than
   fabricating a delivery date.
2. The ratchet's own header now documents the two-module trap, and a test
   asserts **both** transports accept a key — so the count cannot become a lie
   again.
3. The duplication is recorded in `ARCHITECTURE_DELTA.md` as a real BI67
   violation with disposition **MERGE**. Collapsing two live mail paths is its
   own unit of work, not a side effect of this one.

**Why this is in the ledger rather than folded silently into unit 5:** a gate
that can be satisfied without improving anything is worse than no gate. The
near-miss is the useful record.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline ·
22/22 outward-action tests.

---

## Unit 7 — Security: the admin MFA gate protected 2 of 7 surfaces · this commit

**Source:** surfaced by the adversarial verifier on the identity/tenancy layer
of the reconnaissance workflow, then **re-verified independently** before acting
(a green agent report is a hypothesis — CLAUDE.md).

**The defect:** Express evaluates middleware in registration order.
`app.use("/api/admin", isAuthenticated, requireClerkMFA)` sat at
`server/routes.ts:2459`, ~700 lines *below* five of the seven `/api/admin`
surfaces. Those handlers were reached and returned first, so the gate never ran:

    /api/admin/finance                          (1756)
    /api/admin/support/saved-replies            (1803)
    /api/admin/support/customer-context         (1809)
    /api/admin/feature-flags[/:key]             (1821, 1831)
    /api/admin/audit-log/verify[-all]           (2180, registrar)
    /api/admin/deployments, /api/admin/dr-drills (2187, registrar)

Only `registerAdminRoutes` and `registerAdminRecoveryRoutes` — registered
immediately below the gate — were covered. The comment beside them said the
middleware "also covers them", which was true of those two and quietly implied a
generality the ordering did not provide.

**Severity, stated honestly:** every affected route was still behind
`isAuthenticated` + `requireFounder`. This was a **missing second factor on
founder-only surfaces, not an open door**. It still matters:
`/api/admin/support/customer-context` reads any org's MRR and audit trail, which
is precisely the blast radius a second factor exists to bound.

**Fix:** the gate moved above every `/api/admin` registration, and *out of* the
scoping block it initially landed in during the edit. Verified safe before
moving: `requireClerkMFA`'s high-trust prefixes are `/api/admin/recovery`,
`/api/admin/users/`, `/api/admin/orgs/` — none in the newly-covered set — so no
user without 2FA is newly locked out. The change strictly tightens: users who
*have* 2FA must now have verified it this session on those five surfaces.

**Regression gate:** `tests/unit/adminMfaOrdering.test.ts` (5 tests). It checks
source order, because the defect *is* a source-order property — no request-level
test would have caught it without already knowing which routes to probe. It
covers literal registrations *and* the four registrars that mount `/api/admin`
paths internally, asserts each listed registrar still touches `/api/admin` (so
the list cannot rot into vacuity), and carries a vacuity guard requiring the
scanner to find ≥6 registrations.

The existing `lint:route-order` gate does not catch this class — it looks for
swallowed literal routes, not middleware that sorts below what it guards.

**Gates:** `npm run check` PASS · 45/45 across the five affected suites.

---

## Unit 8 — Adoption: the bulk-mail path is now protected · this commit

**Audit requirement:** the same as unit 5 — BI148's SLO "no duplicate
consequential action after retry". A boundary nothing calls satisfies nothing.

**The unblock was the key, and it turned out not to need a founder decision.**
Unit 5 recorded adoption as blocked because the idempotency key semantics looked
like a product call: a `lead:{id}` key blocks a deliberate second mailing months
later, and a content-hash key blocks re-sending an identical letter. Both
silently suppress mail a customer meant to send — a worse failure than the one
being fixed.

Re-reading the flow dissolved it. `mailingOrder` is created **above** the send
loop and `lead.id` is a stable row, so `mailing-order:{orderId}:lead:{leadId}`
is available *before* the send and scopes correctly: retrying **this batch** is
suppressed, while a later deliberate mailing creates a **new** mailing order and
therefore a new key. The concern was real; the answer was in the code.

**Files:** `server/routes-campaigns.ts`, `shared/architecture/canon.ts`,
`tests/unit/outwardActionCoverage.test.ts` (baseline 4 → 2).

**The replay path matters as much as the claim.** `MailAlreadySentError` is now
caught explicitly and recorded as **sent**, carrying the real Lob id — not as a
failure. Recording a replay as failed would understate the sent count and invite
an operator to re-send something already in the post, turning a safety mechanism
into the cause of the exact duplicate it exists to prevent.

**Remaining two are genuinely blocked, not merely undone:**
- `apiQueue.ts` — unreachable today (nothing enqueues that operation), and
  wiring it needs an `orgId` the call does not pass, which would change which
  Lob credentials are used. See B6.
- `communications.ts` — a live double-print path, but its key semantics and the
  boundary's fail-open/closed posture on a money path are founder calls. See B5.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline ·
22/22 outward-action + 18/18 canon.

---

## Unit 9 — Scenario: the economics a decision was based on · this commit

**Audit requirement:** BI12 (Scenario is a canonical object), BK24 (Audit 022
"Scenario Architecture"), BK23 (Audit 021 "Deterministic Economics Kernel"),
canonical law 4 — *financial truth is deterministic, tested and versioned*.

**Premise verified first:** `scenario_simulations` and
`scenario_outcome_comparisons` exist but are **founder-plane autopilot** tables
(LLM war-gaming of company decisions). Reusing one would make Founder OS the
owner of customer financial truth (BI5 forbids). Meanwhile
`decision_snapshots` froze evidence and assumptions but had nowhere to point for
the ECONOMICS — a snapshot could record "offer $42,000" while the arithmetic
behind the number lived nowhere, so a year later you could reconstruct what the
investor believed about the **parcel** and not about the **deal**.

**The pattern was already in the repo, in one vertical.**
`server/services/notePaymentMath.ts` persists `PAYOFF_ENGINE_VERSION`,
`PAYOFF_DAY_COUNT_CONVENTION` and `engine_input_json` to NOT NULL columns —
"the verbatim input snapshot so the number can be recomputed and defended years
later". That is exactly BK23's contract. This **generalises** it rather than
inventing a second mechanism.

**Files:** `shared/economics/scenario.ts`, `shared/schema/scenarios.ts`,
`migrations/0230_scenarios.sql`, `scripts/migrate.mjs`,
`server/services/economics/scenarioStore.ts`, `server/routes-scenarios.ts`,
`server/routes.ts` + `routeManifest.ts`, `shared/calculators/landDeal.ts`
(engine identity), and the decision-linkage across
`shared/decisions/snapshot.ts`, `shared/schema/decision-snapshots.ts`,
`server/services/decisions/decisionStore.ts`, `server/routes-decisions.ts`.
Ratchet 759 → 760.

**Tests:** 19 scenario + the extended decision suite (38 across both).

**Architectural decisions:**
- **The engine registry is CLOSED, and that is structural.** BL3's fail
  condition for deterministic money math is *"a model response is required to
  reproduce a financial result"*. `computeScenario` has no path to anything but
  a registered pure function, and a test greps the module to assert it contains
  no model/fetch/dynamic-import reference at all. The guarantee is an **absent
  branch**, not a policy.
- **A null metric means UNDEFINED, never zero.** An IRR has no solution for some
  cash-flow shapes; rendering that as 0% is a different and false claim. Law 3's
  rule about unknowns applies to arithmetic too.
- **Money is integer cents, enforced at the boundary.** A fractional input is
  refused rather than rounded — 1/3 of a cent is how an unexplainable difference
  gets in.
- **The store computes; the caller supplies inputs only.** A route that accepted
  pre-computed metrics would make `engine_version` a claim by the caller rather
  than a fact about the arithmetic — and would be the exact hole through which a
  model-generated number becomes a persisted financial fact.
- **`describeFooting` names the ABSENCE of economics.** "no scenario computed"
  is printed explicitly, because silence would read as "the numbers were fine".

**Remaining risk (named):** only ONE engine is registered. Flip, BRRRR,
multifamily NOI and note payoff still compute outside the registry, so most
financial numbers in the product remain unversioned and unpersisted. That is
written into the fitness function's note rather than left implied.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline 654 ·
all ratchets at baseline. Canon: scenario absent → canonical,
objects-without-home 12 → **11**.

---

## Unit 10 — The send-coverage number gets honest · this commit

**Audit requirement:** BI148's SLO "no duplicate consequential action after
retry", and the standing rule that a measurement understating its own scope is a
comfortable lie.

**What was wrong with the number:** the coverage ratchet read **2**, which was
true of physical mail and false of the product. `emailService.sendEmail` had
**59 unguarded call sites** that the ratchet did not count, and its own header
admitted the omission. A gate that reports a small number while a large
unmeasured surface sits beside it is worse than one that reports nothing,
because the small number gets quoted.

**Files:** `server/services/emailService.ts` (opt-in idempotency),
`tests/unit/outwardActionCoverage.test.ts` (scope expansion 2 → **61**),
`shared/architecture/canon.ts`, `scripts/no-fabrication.allowlist.json`
(re-anchored).

**Order mattered.** The transport was wired FIRST. A ratchet with no mechanism
to lower it is a permanent accusation, not a gate — and a test in this very file
asserts every counted transport accepts a key, so widening the scope without
wiring email would have failed immediately, by design.

**Architectural decisions:**
- **Opt-in, engaging only when `organizationId` is also present.** The claim is
  tenant-scoped; a platform-scoped system mail has no org to scope to and is
  left honestly unprotected rather than silently claimed under a shared key.
- **Email replay RETURNS success with the original SES message id**, where
  physical mail throws. The asymmetry is deliberate: a mail caller must be
  stopped from printing a second piece, while an email caller almost always
  just wants to know the message went out — and the real provider id is the
  honest answer to that. Nothing is fabricated.
- **A boundary refusal becomes a structured failure, not an exception.** Every
  existing `sendEmail` caller expects an `EmailResult`; letting a safety refusal
  throw would crash 59 call sites the moment the feature was adopted anywhere.

**Correction made mid-unit:** the first baseline said 78, extrapolated from a
raw grep. Running the scanner reported **61** — it strips comments and excludes
the transport module. The baseline is the scanner's number, not the grep's: an
estimated baseline is a guess wearing a ratchet's clothes.

**Also fixed:** inserting into `emailService.ts` shifted line numbers and staled
a line-anchored `no-fabrication` allowlist entry (a MIME boundary string).
Re-anchored 359 → 377 rather than deleted — the entry is still legitimate.

**Still uncounted, and named:** SMS (~10 sites) and e-sign. Each needs its
transport wired before it can be counted without making the ratchet unlowerable.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at
baseline 654 · 40/40 across the three affected suites.

---

## Unit 11 — Outcome: the loop closes · this commit

**Audit requirement:** BI1 (the canonical loop ends in OUTCOME → LEARNING),
AA8 (the Decision–Outcome graph as a compounding moat), BI178 (an outcome is an
observation, not retroactive validation), canonical law 9.

**Premise verified first:** `outcome_telemetry` is org-scoped but shaped around
AGENT performance (`contributingFactors: agentActions, messagesSent,
responseTime`) and carries **no decision reference**; `outcome_calibrations` is
keyed by agent codename. Both are the agent/founder learning loop. An investment
outcome that cannot point at the decision it graded is not the canonical Outcome
at all (BI76).

**Files:** `shared/outcomes/outcome.ts`, `shared/schema/outcomes.ts`,
`migrations/0231_outcomes.sql`, `scripts/migrate.mjs`,
`server/services/outcomes/outcomeStore.ts`, `server/routes-decisions.ts`
(nested outcome routes), `shared/architecture/canon.ts`. Ratchet 760 → 761.

**Tests:** 22 (18 variance + 4 structural law-9 checks).

**Architectural decisions:**
- **Variance is a PURE PROJECTION, never a column.** A stored variance is a
  third number that can drift from the two it derives from, and "improving" it
  later would silently restate how good a past decision looked. It is computed
  against the scenario references the decision **froze** — not against live
  scenario rows, which would let a recomputation change the past.
- **`decision_snapshot_id` IS a real foreign key** — the opposite of the choice
  made for `evidence_claims`, `decision_snapshots` and `scenarios`, all of which
  must *survive* their subject. An outcome without its decision is meaningless:
  nothing to compare against, nothing to teach. The FK is right here for exactly
  the reason it was wrong there.
- **`unmeasured` and `unpredicted` are distinct states.** "We never measured the
  IRR" and "we never predicted the IRR" are different facts about a customer's
  own record-keeping, and collapsing them destroys the signal telling them which
  habit to fix. A predicted-but-unmeasured metric stays **visible** — silently
  dropping it is how "we predicted five things and checked one" comes to read as
  a clean scorecard.
- **The summary never judges the decision** (BI178). A test asserts the output
  contains none of good/bad/wrong/correct/mistake. A record that scores
  decisions by their results teaches an investor to be lucky rather than right.
- **No `relative` when the prediction was zero** — `delta / 0` is Infinity,
  which renders as a confident-looking number and means nothing.
- **The subject is read FROM the decision**, not accepted from the caller. An
  outcome claiming a different property than the decision it grades is two
  unrelated facts filed together.
- **Law 9 is structural:** the outcome store imports only `getDecision` from the
  decision store — never `recordDecision` — and a test pins that.

**Reachability caught one speculative export** (`outcomesForSubject`, no
consumer). Deleted rather than kept, same as in unit 2.

**Remaining gap (named in the fitness function):** nothing PROMPTS a customer to
record an outcome, so the loop closes only when someone chooses to close it. The
founder plane already has a due-outcome sweep (`outcomeLedger`/`decisionEval`)
to study. Calibration across many decisions is not built at all.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline 654 ·
40/40 across the affected suites. Canon: outcome role-table → canonical,
objects-without-home 11 → **10**.

---

## Unit 12 — A second, contrasting economics engine (BI191) · this commit

**Audit requirement:** BI191 — *"Every core primitive must pass contrasting
Strategy Pack fixtures. A land-only implementation that happens to expose
generic labels does not satisfy the architecture."*

**Why this mattered:** unit 9 shipped the economics layer with exactly ONE
registered engine. A registry containing one land engine is a land-shaped
abstraction pretending to be general, and the only way to find out is to make a
structurally different engine fit it.

**The obstacle, and how it was resolved.** The obvious second engine is
`note_payoff`, which is already versioned and already persists its inputs — but
it lives in `server/services/notePaymentMath.ts` and implements
statute-adjacent arithmetic, while `check-boundaries.mjs` rule S1 forbids
`shared/` importing `server/`. Rather than relocate regulated money code to
satisfy a module boundary, **the registry is now passed IN**:
`shared/economics/scenario.ts` exports `CORE_ENGINES` (the shared-side engines)
and `computeScenario(req, engines)` refuses anything outside the set it was
handed. The closure guarantee survives — it becomes per-call rather than global
— and there is still no path from a scenario computation to a model.

This is the same kernel/pack seam `server/services/autopilot/domainPack.ts`
already uses on the founder plane, rather than a second shape.

**Files:** `shared/economics/scenario.ts` (EngineSpec gains `compute`;
`ENGINES` → `CORE_ENGINES`; `requireIsoDate`, `metric`, `requireCents`
exported), `server/services/economics/engines/{index,notePayoff}.ts`,
`server/services/economics/scenarioStore.ts`, `server/routes-scenarios.ts`,
`shared/schema/scenarios.ts` (inputs widened to `number | string`).

**Tests:** 29 (10 new cross-engine).

**Architectural decisions:**
- **The adapter does NOT reimplement the maths.** It delegates to
  `computePayoffQuote` and a test asserts they agree exactly. Two
  implementations of the same money formula is the duplication law 1 forbids.
- **The version is read FROM the owning engine** (`PAYOFF_ENGINE_VERSION`),
  never copied. A version that can drift from its formula is a stamp that lies.
- **Inputs widened to `number | string` for DATES only.** `requireCents` still
  refuses any non-integer, so `"42000.50"` cannot slip through as money — a test
  pins both halves. A fractional *rate* is accepted, because 9.875% legitimately
  arrives as 987.5 bps from the servicing table.
- **`computeScenario` now verifies an engine emitted everything it declared.**
  An engine that silently omits a declared metric produces a scenario that looks
  complete and is not — caught at write time rather than read time.
- **A test asserts the two engines overlap in NO metric.** If the second engine
  produced the same outputs as the first it would be a second instance of one
  shape, not a test of the contract.

**Honest note left in the code:** `days_accrued` is carried with unit `months`
because `MetricUnit` has no `days` member, and widening that union touches a
type already persisted in two tables. The mismatch is flagged in a comment
rather than silently shipped — pretending the unit is right is exactly the
dimensional lie BI182 exists to prevent.

**Reachability caught one export again** (`NOTE_PAYOFF_ENGINE_ID`, read only by
its own module and a test). Un-exported; the test reads `notePayoffEngine.id`.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline 654 ·
88/88 across the four affected suites.

---

## Unit 13 — Correct the `days` unit while it is still free · this commit

**Small, and worth its own entry for the reason rather than the change.**

Unit 12 shipped `days_accrued` carrying unit `months`, with an apology in a
comment, because widening `MetricUnit` touches a type persisted in
`scenarios.metrics` and `outcomes.actuals`. That was the wrong call, and the
correction is one line.

BI182 requires explicit units precisely because comparing a figure in one unit
with one in another produces a number that looks plausible and is wrong. A
mislabelled unit with a comment explaining the mislabel is still a mislabelled
unit — the comment protects the next reader of the source, not the next reader
of the number.

**Correcting it was free HERE and only here.** `scenarios` and `outcomes` are
new tables that have never been deployed, so no persisted row carries the wrong
label. That is the pre-customer window BI104 describes, and it closes on first
deploy. Deferring would have converted a one-line fix into a data migration.

A test pins the unit so it cannot regress, and the reasoning lives in the code
rather than only in this ledger.

**Also verified this commit:** the FULL unit suite — **653 files, 8,508 tests,
1 skipped, 0 failures** — covering all thirteen units.

---

## Unit 14 — A third engine, and the rule that actually matters · this commit

**Audit requirement:** BK23 (deterministic economics kernel), BI92 (cross-strategy
comparison happens through normalised scenario outputs), BI182 (explicit units).

**Files:** `server/services/economics/engines/flipMao.ts`, `engines/index.ts`,
`shared/economics/scenario.ts` (`requireNumber`, two flip metrics),
`shared/architecture/canon.ts`. Tests: 38 in the scenario suite (8 new).

**Which flip function to wrap was the real decision.** Two exist.
`calculateFlipAnalysis` is the legacy 70%-rule version and its own file header
warns its numbers read HIGH by construction — it ignores acquisition closing
costs and carry. `computeMao` is the honest one: net profit is `null` (not zero,
not optimistic) when an input it needs is absent, holding cost has no invented
default, and it reports which price the profit was computed against. Its
null-not-zero discipline is already exactly what the Scenario contract requires,
so it maps across with no translation layer that could quietly fill a gap.

**The flip engine deliberately REUSES `profit`, `roi` and `total_cost`** rather
than minting flip-specific twins. That corrected a framing error from unit 12: a
test there read as though non-overlap between engines were a virtue. It is not.
Cross-strategy comparison happens through normalised outputs (BI92) and dies the
moment two engines name the same quantity differently. The test was rewritten to
say what it actually means — land and note happen to measure different
quantities — and a new test asserts the rule that matters: **every** registered
engine speaks the one metric vocabulary, and engine ids are unique.

**A 100x error caught by writing the adapter.** `computeMao` reports
`netRoiPct` as a PERCENT; the registry's `roi` metric is a RATIO. Storing 25
under a ratio label would compare against a land deal's 0.25 and read as a 100x
better return. Converted at the boundary, with a test asserting the stored value
is a ratio.

**`requireNumber` added** alongside `requireCents`. A percentage is legitimately
fractional (7.5%); money is not. One shared helper would either let fractional
cents through or refuse a valid rate.

**Gates:** `npm run check` PASS · tsc clean · reachability at baseline ·
78/78 across the three affected suites.

---

## Unit 15 — A fourth engine, and the contract gap it exposed · this commit

**Audit requirement:** BK23 (deterministic economics kernel), BI92 (cross-strategy
comparison through normalised scenario outputs), BI182 (explicit units), BI151
(a substituted default must be visible as a default).

**Files:** `server/services/economics/engines/rentalReturns.ts` (new),
`engines/index.ts`, `shared/economics/scenario.ts` (four rental metrics; widened
`EngineSpec.compute` return), `shared/architecture/canon.ts`. Tests: 46 in the
scenario suite (8 new).

**The engine had to be able to declare its own assumptions.** Until this unit
`EngineSpec.compute` returned only `{metrics, normalisedInputs}` — assumptions
came exclusively from the CALLER, on the reasonable theory that assumptions are
things a human chose. Buy-and-hold disproved that. When no expense figure is
supplied, the underlying maths substitutes a 40%-of-rent ratio; **only the engine
knows the substitution happened**, and with no way to say so it would vanish into
`annual_noi` and read as measured. So `compute` may now return
`assumptions?: ScenarioAssumption[]`, and `computeScenario` merges caller-supplied
and engine-declared ones. `origin: "platform-default"` exists precisely to keep a
platform guess from later reading as what the customer believed; without this
widening it could not have been used where it was most needed.

**Which rental function to wrap was again the real decision** — the same fork as
unit 14. `calculateRentalAnalysis` applies the same 40% substitution but returns
no way to know it did; its own file comment says callers must use
`computeRentalReturns`, "which reports `expenseBasis`, rather than rendering
these numbers unlabelled." The adapter wraps the honest one, and the whole
declared-assumption mechanism above exists to carry `expenseBasis` outward.

**A test was wrong and the code was right.** A new test asserted that omitting
expenses and passing an explicit `0` must produce different results — intuitive,
and false here. `computeRentalReturns`'s contract is `0/omitted = unknown`,
because a property with genuinely zero operating expenses does not exist, so an
explicit `0` is a missing figure wearing a number's clothes. **The test was
rewritten to pin the real contract** (an explicit `0` must still declare the
substitution) rather than the code being bent to satisfy it, and the reasoning
now lives in a comment in the adapter. Changing the code would have made `0`
mean "no expenses" and produced an NOI equal to gross rent, presented as
measured — the exact failure the substitution is declared to prevent.

**The same 100x trap as unit 14, caught the same way.** `capRatePct` is a
PERCENT; the registry's `cap_rate` is a RATIO. Converted at the boundary. Two
adapters in a row have hit this, which is evidence the metric registry's unit
column is doing real work rather than decorating.

**Reuses `total_cost`** (BI92) so a hold and a flip and a land deal remain
comparable; NOI, cash flow, cap rate and GRM are genuinely rental-specific and
get their own ids.

**Gates:** `npm run check` PASS (22 gates) · tsc clean · reachability at all four
baselines · 64/64 across the scenario and canon suites.

---

## Unit 16 — A fifth engine, the first one allowed to refuse · this commit

**Audit requirement:** BK23 (deterministic economics kernel), BI92 (comparison
through normalised outputs), BI182 (explicit units), BI191 (contrasting Strategy
Pack fixtures), and the repo's own refuse-not-fabricate rule.

**Files:** `server/services/economics/engines/multifamilyNoi.ts` (new),
`engines/index.ts`, `shared/economics/scenario.ts` (three metrics; `optionalCents`
and `requireOneOf`), `shared/rental/noi.ts` (`computeNoi` extracted),
`server/routes-investor-analytics.ts`, `shared/architecture/canon.ts`.
Tests: 20 new in the scenario suite, 1 rewritten in `propertyExpenseNoi`.

### The planned item did not exist

`NEXT_UP` said "BRRRR and multifamily NOI still compute inline". **Half of that
was false.** `BRRRR` appears NOWHERE in this repository — the only occurrence of
the string, before this commit, was in the gap note I had written in `canon.ts`.
There was no inline BRRRR arithmetic to register because there is no BRRRR
feature.

Section I of the mission is explicit that the live repo wins over a plan and that
a recommendation whose premise is false must not be implemented. That rule is
easiest to apply to someone else's stale claim and hardest to apply to one's own,
which is precisely why it is worth recording: **the false premise was mine, three
units old, and it would have produced a plausible engine for a product feature
that does not exist.** The claim is now corrected in `canon.ts` with the
correction dated and its reason stated, rather than quietly deleted.

The multifamily half was true, and it is what shipped.

### Why this engine is different from the previous four

It is the **first engine permitted to decline**. `shared/rental/noi.ts` already
refuses to invent an operating expense for an UNMEASURED COMMERCIAL building: the
residential 40%-of-collections rule of thumb is meaningless under a triple-net or
gross lease, so op-ex is null and NOI, cap rate and DSCR fall away rather than
being fabricated. The adapter propagates that all the way out — `annual_noi`,
`cap_rate`, `operating_expense_ratio` and `annual_operating_expense` are all
null, and **no assumption is declared, because nothing was assumed**. It still
computes GRM, which needs no expense figure; nulling that too would be a
different dishonesty — refusing a question that was asked and is answerable.

**The null carries no reason field, deliberately.** `normalisedInputs` is
persisted verbatim, so `structureClass: "commercial"` with
`measuredOpExRowCount: 0` and no `opExBps` fully explains the refusal to any
later reader. Widening the persisted metric shape to narrate it would be a
shape-version bump bought for a need nobody has measured; a test pins that the
inputs do the explaining.

### Four provenances, four different declarations

Unit 15 let an engine declare ONE assumption. This engine shows the mechanism was
not over-built:

| Situation | Declared as | Origin |
|---|---|---|
| No records, no override | 40% of collections | `platform-default` |
| Operator supplied a RATIO | that ratio | `user` |
| Records exist but span < 12 mo | `N/12 months` coverage | `derived` |
| Denominator is an ASSESSED value | the basis | `derived` |
| Records complete, market value | *(nothing)* | — |

The first two are the distinction `origin` exists for: both are ratios rather
than measurements, but only one is the customer's own judgement, and the route
being generalised makes exactly the same point in its own comment. The third is
`noi.ts`'s "a thin ledger must not read as a complete one" rule surviving into
the persisted record. The fourth came from reading the route: it falls back
`marketValue ?? assessedValue`, and an assessment is a taxing authority's figure
produced on its own cycle — a cap rate built on one is not comparable to a cap
rate built on a market value.

The coverage rule is asserted against the SHARED predicate across 0/3/11/12/13
months rather than a local `>= 12`, so the scenario record and the server label
cannot come to disagree about the same building.

### It deliberately does NOT reuse `total_cost`

Three reuses (`annual_noi`, `cap_rate`, `monthly_cash_flow`,
`gross_rent_multiplier` — four) and three new ids. But `total_cost` was refused:
this engine's denominator is a VALUATION, and a held building's market value is
not what it cost. Reusing the id would put two different quantities under one
label — the same class of error as the percent-under-a-ratio-label bug two
earlier adapters hit, just harder to see. A test pins the absence.

### The duplication this unit created, and removed

Writing the adapter gave `collections - opEx` a second home. It was extracted to
`shared/rental/noi.ts:computeNoi` and BOTH callers now use it — the same move
`decideOperatingExpense` made in Wave 4, for the same reason.

**An existing test pinned the inline expression I removed** (`propertyExpenseNoi`
grepped the route source for the exact ternary). Per the wave-discipline rule, it
was **rewritten, not deleted**: the invariant it protects — NOI and cap rate fall
away rather than being fabricated when op-ex is unavailable — is now asserted
BEHAVIOURALLY against the extracted pure function, so it cannot go stale the next
time the code moves.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 653 files, 8,544 tests, 1 skipped, 0 failures.**

---

## Unit 17 — The golden loop, and the lie it found in 20 minutes · this commit

**Audit requirement:** Master Audit Section VII(A) — "One Complete Property":
identity → evidence → provenance/conflict → economics → scenario →
DecisionSnapshot → outcome → learning. Also canonical law 3 (unknown is a valid
state, and mislabelling it is the failure) and law 9 (outcomes append learning).

**Files:** `tests/unit/goldenLoopOneProperty.test.ts` (new, 20 tests),
`shared/economics/scenario.ts` (`freezeScenarioRef`), `shared/outcomes/outcome.ts`,
`shared/decisions/snapshot.ts`, `shared/schema/decision-snapshots.ts`,
`shared/architecture/canon.ts`, plus three test files rewritten to the new truth.

### Why write it at all — every layer was already green

Units 2, 3, 9, 11 each shipped with a thorough test file, and all of them passed.
That is precisely the condition under which this repo's most common defect hides.
`CLAUDE.md` names it — "built but unwired" — and per-layer tests are structurally
blind to it, because **each one hand-builds the fixture for the layer below.** A
test that writes its own `FrozenScenarioRef` proves the decision layer reads the
shape it was handed. It proves nothing about whether the scenario layer PRODUCES
that shape, or produces all of it.

So the rule for this file: **every input is the previous layer's real output.**
The only hand-built object is the provider payload at the top, which is the only
thing that genuinely originates outside the system. It is deliberately imperfect
in the two ways real payloads are — a value with no provenance entry, and a
DERIVED AcreOS risk score sitting beside the raw flood zone — and both must be
dropped by the anti-corruption boundary without the loop filling the holes.

The whole chain is pure: no database, no clock, milliseconds, runs on every
`npm test`. That is a dividend of having written each layer as a pure isomorphic
module with the I/O pushed into thin stores, and it is worth naming as a payoff
of that decision rather than a happy accident.

### What it found immediately

**A real prediction was being reported as "unpredicted".**

`freezeScenarioRef` froze a `headline` of three metric ids — profit, roi, irr —
on the unexamined theory that a reference should be compact. The land engine also
predicts `hold_months`. The test property was forecast at 9 months and sold at
10. The variance reported `hold_months` as **`unpredicted`**.

That is a factual claim about the decision, and it was false. Nobody had failed
to forecast the hold; the forecast was dropped between the engine and the record.
It is exactly the mislabel law 3 forbids, one layer over — *"not predicted"* and
*"predicted but not retained"* are different facts — and it destroyed the single
clearest learning signal the run produced: a one-month overrun on a nine-month
plan.

**No per-layer test could have caught it.** `outcomeVariance.test.ts` hand-wrote
its `headline` array, so it always contained whatever the test needed. The loss
only appears when a real engine's output travels all the way to a real variance.

**Fix:** a decision now freezes EVERY metric its engine predicted, and the field
is renamed `headline` → `predicted`, which is what it actually is. Compactness
was never the reason those numbers were frozen — readability and durability were,
and both are served better by keeping all of them. Engines produce at most eight
metrics, so there was no size argument either. Renaming was free only because no
row has been deployed; the same pre-customer window the `days_accrued` unit fix
used, and it closes on first deploy.

**Three tests were rewritten rather than deleted**, per wave discipline. The
sharpest was `scenarioDeterminism`'s pair asserting the ref carried exactly
`["irr","profit","roi"]` and was "not a copy" of the output — the tests that
PINNED the defect as intended behaviour. Their real invariant (a reference must
carry enough to stay readable without the scenario row) survives and is stronger;
what is gone is the arbitrary three-id cut. The replacement is DERIVED from the
engine's `produces` list, so it cannot go stale as engines change.

### The fix was verified adversarially, not assumed

The new assertions were re-run against a deliberately reverted
`freezeScenarioRef`: **2 tests fail, 18 pass.** A test written after a fix that
has never been seen to fail is a hypothesis about a test, not a regression gate.

### Also pinned by this file

- **One subject identity** carried from provider payload to variance — if any
  seam silently re-keyed the subject, the chain would stay green per-layer while
  comparing two different parcels.
- **The refusal survives to the record:** a value dropped for having no named
  source reaches the decision as an absent predicate, never as `false`.
- **As-of reconstruction:** re-resolving at an earlier instant returns `unknown`
  for everything — different date, not a different code path.
- **Mounting WITH middleware:** each layer's router is asserted mounted behind
  `isAuthenticated` AND `getOrCreateOrg`, since every one of these tables is
  tenant-scoped and a mount without org scoping is a tenancy hole, not a typo.
- **Migration presence** for all four tables — a schema table with no CREATE in
  `scripts/migrate.mjs` 500s on deploy, which this repo has shipped before.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 654 files, 8,565 tests, 1 skipped, 0 failures.**

---

## Unit 18 — One Complete Failure, and the two defects it found · this commit

**Audit requirement:** Master Audit Section VII(C) — "One Complete Failure".
Also BI74 (idempotency at the action/provider boundary), AU28 (refuse after an
unknown outcome), canonical law 3 (unknown and conflict are valid states) and the
repo's refuse-not-fabricate rule.

**Files:** `tests/unit/goldenLoopOneFailure.test.ts` (new, 19 tests),
`server/services/actions/outwardAction.ts` (`ProviderNotContactedError` +
classification), `server/services/directMailService.ts` (both credit paths),
`shared/evidence/claim.ts` (`resolveClaims` self-filters),
`shared/architecture/canon.ts`, and one test in `outwardActionIdempotency`
rewritten.

### Why the failing loop is worth more than the succeeding one

VII(A) proved the happy path composes. But fabrication, fail-open defaults and
silent coercions do not live on the success path — nobody writes `?? 0` for a
value that arrived. They live in the branches that run when a provider times out,
a balance is short, or a payload comes back half-attributed. So this file traces
the three failures the system will actually meet: a PARTIAL provider payload, a
CONFLICT between two authorities, and an outward action whose outcome is UNKNOWN.

It found two defects.

### Defect 1 — a credit refusal permanently poisoned the idempotency key

`withOutwardAction` records any unclassified throw as `ambiguous`, which is the
correct DEFAULT and was the wrong ANSWER for a whole class of failures. A
transport's exec body runs several steps before it touches the provider —
resolving credentials, checking a balance — and every one can throw.

`checkCreditsAndRecord` only READS the balance (it deducts nothing, despite the
name), and Lob has not been called. Yet an org that ran out of credits got a
**permanently poisoned key**: top up, retry under the same durable
`mailing-order:{orderId}:lead:{leadId}` key, and meet `ActionAmbiguousError`
forever — with a message instructing the operator to reconcile against a provider
that never heard of the request. The letter could never be sent under its own key
again.

**Severity, stated honestly: this failed SAFE.** Nothing double-sent and no money
moved. It was an operational dead end requiring human intervention, not a
duplicate letter. But it sat on the money-spending path, and the code comment
already NAMED the distinction ("paths that ran BEFORE Lob accepted anything ... or
from the Lob call itself") without acting on it — the knowledge was present and
unenforced, which is the condition this program exists to end.

**Fix:** `ProviderNotContactedError`, classified as `failed` (retryable). **The
polarity is the design.** A transport must PROVE it never reached the provider by
raising the type; everything else stays ambiguous. Defaulting the other way —
assuming no contact unless proven otherwise — is how a second letter reaches a
real mailbox. Classification is by TYPE, never by sniffing an error message, and
a test asserts no `.message.includes(` appears in the classifier.

The Lob call itself is deliberately NOT reclassified, and a test pins that too: a
network failure there may or may not have printed a letter, which is the case the
entire ledger exists for.

### Defect 2 — `resolveClaims` could FABRICATE a conflict

Found by an assertion that handed `resolveClaims` the whole claim set, which is
what a caller who forgot to pre-filter would do. The function's contract is "every
claim for this (subject, predicate)" and it trusted the caller entirely — so an
APN and an acreage were read as two rival answers for the flood zone, returning
`conflict`: a confident, user-visible, entirely invented disagreement between
sources that never disagreed.

**Not a live bug** — the one production caller (`resolveFact`) filters via
`claimsForPredicate`, and that was verified before claiming anything. But the
safety of the evidence read path rested on a convention nothing enforced, and
*no fabrication is not a rule a pure function should delegate to its callers.*

**Fix:** `resolveClaims` filters by predicate itself. Filtering rather than
throwing, because it yields the CORRECT answer for the predicate asked about,
where a throw would turn a caller's extra rows into a 500 on a read path.

### Both fixes verified adversarially

Reverting either fix fails 4 tests across the two suites. A test written after a
fix and never seen to fail is a hypothesis about a test.

### A rewritten test, again

`outwardActionIdempotency`'s "an unclassified throw is recorded ambiguous, never
failed" sliced a fixed 900-character window after `exec()`; the new guarded
branch pushed the assertion out of it. **Rewritten, not deleted**, and made
stronger: it now asserts the ORDER of the two outcomes — the typed `failed` is
guarded and comes first, the `ambiguous` fallback is unguarded and comes last.
If those were ever reversed, an unknown outcome would become retryable. The
window brittleness is gone.

### Also pinned by this file

- A partial run still produces a usable record: refusing the whole thing because
  one category lost attribution is the opposite error.
- A conflict reaches the decision AS a conflict, never flattened to unknown —
  "we never looked" and "we looked twice and got two answers" call for different
  next actions.
- Last-write-wins is refused: the later-fetched county GIS value does not beat
  FEMA, so an answer never depends on lookup order.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 655 files, 8,582 tests, 1 skipped, 0 failures.**

---

## Unit 19 — One Complete Customer: the tenancy loop · this commit

**Audit requirement:** Master Audit Section VII(B). Also source-of-truth
precedence #1 — tenant isolation outranks every other consideration in this
program.

**Files:** `tests/unit/goldenLoopOneCustomer.test.ts` (new, 14 tests),
`server/services/economics/scenarioStore.ts` (`UnavailableScenarioError`),
`server/services/decisions/decisionStore.ts`, `server/routes-decisions.ts`,
`shared/architecture/canon.ts`.

### Why these four layers are unusually exposed

- `evidence_claims.subject_id` carries NO foreign key — deliberately, so a
  `parcel` claim can be recorded before Parcel has a table. Nothing at the
  database level stops a claim being keyed to another tenant's property id, so
  **the org column is doing all of the work.**
- A decision cites scenarios BY ID and an outcome cites a decision BY ID. Those
  are the two places one tenant's record could embed another tenant's numbers.
- All four tables are append-only. A leak here is not something you clean up
  afterwards; it is frozen into an immutable record.

### The finding: isolation was right, the RECORD was not

`freezeScenarioRefs` **silently skipped** ids it could not read. The org scoping
was correct — a foreign scenario was never frozen, and that part needed no
change. But a decision citing two scenarios, one foreign or simply mistyped, was
written with one, and `describeFooting` then reported "1 scenario(s)" as though
that had always been the whole story.

That is the same defect as unit 17's frozen-forecast loss, on the record a human
reads two years later to reconstruct what a decision rested on: **an incomplete
record that reads as complete.**

The old justification — refusing loudly would leak that a foreign row exists —
assumed a choice between leaking and losing. **There is a third option: refuse
WITHOUT distinguishing.** `UnavailableScenarioError` names no id and says nothing
about whether the id belongs to another tenant or does not exist, so no oracle is
created and no citation is quietly dropped. It also catches the far more common
case — a plain typo — which previously produced a decision silently justified by
nothing at all. Citations are de-duplicated first, so citing one scenario twice
is not counted as a missing one, and the route maps it to a 400 rather than a 500.

### My own test was vacuous, and a mutation test caught it

The "every canonical table declares organization_id NOT NULL" assertion used a
120-character window after the column name. Deliberately making the tenant key
NULLABLE **did not fail it** — the window had matched the NEXT column's
`.notNull()`.

**A vacuous tenancy assertion is worse than none, because it reads as proof.**
Rewritten to slice the column's own declaration (ending at the next column, not
at the first comma — `.references(..., { onDelete: "cascade" })` contains one,
which broke the first correction too), and re-verified against the same mutation.
It also now asserts the cascade, so deleting a tenant cannot orphan its records.

Every structural assertion in this file was mutation-tested rather than trusted:
removing an org predicate from a canonical read fails it, and so does the
nullable tenant key.

### Also pinned

- **`organizationId` is the FIRST parameter of every exported store function.**
  Not style: a tenant key arriving third, after two ids, is one argument-order
  slip from being someone else's, and TypeScript cannot catch a swap between two
  `number`s.
- Every read filters by org; both insert shapes stamp it (the BULK shape is
  followed through its row builder, since that is where a tenant key is most
  easily lost — the stamping happens somewhere else entirely).
- The org is never accepted from a request body — the zod schemas must not even
  admit the field.
- An outcome resolves its decision THROUGH the org and takes the subject FROM it,
  so it can never claim to be about a different property than the decision it
  grades.
- The pure resolution layer takes no org at all, and the test pins that it does
  not try to: a second, weaker isolation boundary that could disagree with the
  real one is a liability, not defence in depth. Handed two tenants' claims it
  reports `conflict` rather than silently picking one.
- A frozen decision body carries no organization id — the tenant lives in the
  ROW, so there is no second copy to drift from the column queries filter on.
- Every canonical index leads with the org column.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 656 files, 8,596 tests, 1 skipped, 0 failures.**
