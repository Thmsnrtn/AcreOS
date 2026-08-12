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

---

## Unit 20 — Calibration: the layer above a single variance · this commit

**Audit requirement:** Master Audit Section VII(D) — "One Complete Learning
Loop". Also BI178 (an outcome observes; it does not score the decision) and the
refuse-not-fabricate rule, which is the whole design here.

**Files:** `shared/outcomes/calibration.ts` (new, pure),
`server/services/outcomes/outcomeStore.ts` (`calibrationForOrganization`),
`server/routes-decisions.ts` (`GET /api/decisions/calibration`),
`shared/architecture/canon.ts`, `tests/unit/calibrationAcrossDecisions.test.ts`
(new, 23 tests).

### Why this is not an extension of decisionEval

The standing instruction is to extend the founder plane's sweep rather than
invent a second one, so the first work was checking whether it fits. It does not,
and the reason is worth recording: `autopilot/decisionEval.ts` scores a
PROBABILITY against a binary success/failure vote, via Brier. That is the right
shape for "was the autopilot's confidence warranted".

This measures a predicted NUMBER against an actual NUMBER — $58,000 forecast
against $54,000 realised — across many decisions, per metric. Brier does not
apply and neither does a hit rate. What IS reused is decisionEval's *discipline*,
which is the transferable part: a hard cold-start floor, a refusal to emit a
number the data cannot support, and no aggregate score. Neither module imports
the other's arithmetic, and a test asserts calibration.ts imports no server-side
code while still NAMING decisionEval in its header so the relationship is
findable by anyone who greps for either.

### The floor is derived, not chosen

This module is a number generator pointed at a small sample, and everything it
produces looks authoritative: a percentage, a direction, a p-value. "Your resale
assumptions run 12% optimistic" from four deals is fabrication wearing a
statistic's clothes, and it is worse than silence because it will change how
someone prices their next offer.

So `MIN_COMPARISONS_FOR_DIRECTION = 6`, and **six is derived rather than picked**.
Direction is a two-sided sign test: `n` comparisons all missing the same way has
probability `2 × 2^-n` under an unbiased forecaster. At n=6 that is 0.031 — the
first n at which even a UNANIMOUS result clears 0.05. At n=5 it is 0.0625, so
five outcomes cannot establish a direction however lopsided they look. A floor
chosen because it felt right would be exactly the fabrication the module exists
to prevent, so it sits at the point below which no evidence is possible. Tests
pin both probabilities.

Below the floor every derived field is **absent, not null** — a null renders as
"—" in some views and as 0 in others; an absent key cannot be rendered as a zero.

### The rest of the honesty budget

- **Median, never mean.** Seven deals 10% under and one that came in 20x gives a
  mean relative error of ~+2.4 — a number describing nothing that happened.
- **A suggestive lean is `centred`.** 7 of 10 one way is p=0.34. Naming that a
  bias is how noise becomes advice. The categorical claim is gated on the sign
  test; the raw counts and the p-value are always shown so a reader can judge.
- **`optimistic` respects `higherIsBetter`.** A break-even sale price forecast
  BELOW what it turned out to be was the *favourable* forecast, even though the
  number was smaller. This is where the metric registry earns its keep again.
- **The summary line takes its direction from the median DELTA, never from the
  bias word** — those agree only for higher-is-better metrics, and deriving
  "above/below" from the bias would state the opposite of what happened for every
  lower-is-better metric. (Caught while writing it; the first draft was wrong.)
- **Unmeasured and zero-predicted counts are carried, not dropped.** A metric
  forecast forty times and measured eight has a calibration built on eight
  points, and a reader who cannot see that reads it as forty.
- **`unpredicted` does not count against the forecasts that were made** — it is a
  fact about coverage, and mixing it in would make a well-calibrated operator
  look worse for having recorded an extra actual. A metric that was ONLY ever
  unpredicted is absent from the report entirely rather than listed as
  "insufficient", which would invite a reader to think a forecast had been
  attempted and fallen short.
- **No overall score.** One number mixing a cents metric with a ratio metric is
  arithmetic on incompatible units, and it would hide which measurement is thin.
  A test pins the report's key set to exactly three fields.

### Two corrections this unit made to earlier work

**The outcomeStore header became false.** It claimed the module "never touches
`decisionSnapshots` at all" — true until calibration needed to read the forecasts
it grades. Corrected rather than left as a comfortable overstatement: the real
invariant is **no WRITE path**, and an inflated claim makes it harder to see which
part is load-bearing. `outcomeVariance.test.ts` already pins the write ban
directly, so nothing was weakened.

**My own tenancy regex from unit 19 would have missed this query.** It matched
`db.select()` — the bare form — and the calibration sweep uses a projected
`.select({ id, scenarios })`. The new read would have slipped past the
"filters EVERY read by organizationId" check silently. Broadened to `.select(`
with any argument. A tenancy check with a shape-specific pattern quietly stops
covering the next query anyone writes, which is the same class of decay as a
stale allowlist.

The calibration read touches two tables and therefore has two chances to leak.
The decision fetch is scoped to the org **independently** rather than trusting the
ids carried on the outcome rows — those ids came from this org's own outcomes so
they should already be this org's decisions, but "should" is not an isolation
boundary and the cost of asking again is one predicate. Two queries, not N+1.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 657 files, 8,619 tests, 1 skipped, 0 failures.**

---

## Unit 21 — The outcome prompt: the loop's last open end · this commit

**Audit requirement:** Master Audit Section VII (the loop must CLOSE, not merely
be closeable). Also BI5 (Founder OS is a control plane, not a second product
database) and canonical law 6 (a historical decision preserves what was known).

**Files:** `shared/schema/decision-snapshots.ts` (`review_due_at` + org-leading
index), `migrations/0232_decision_review_due.sql`, `scripts/migrate.mjs`,
`shared/decisions/snapshot.ts`, `server/services/decisions/decisionStore.ts`
(`decisionsDueForOutcome`), `server/routes-decisions.ts` (`GET /api/decisions/due`),
`shared/architecture/canon.ts`, `tests/unit/outcomePrompt.test.ts` (new, 20 tests).

### Why this was the binding gap, not a nicety

Every layer worked and nothing ever ASKED for an outcome, so the loop closed only
when someone spontaneously chose to close it. That is not merely incomplete —
**it silently biases everything built above it.** People record the deals they
remember, and memorable usually means extreme: the one that tripled and the one
that went to zero. A calibration computed over volunteered outcomes measures what
someone remembers, not how they forecast. Unit 20 built a careful instrument and
pointed it at a self-selected sample; this is what makes it a measurement.

### The design is borrowed; the table is not

`server/services/outcomeLedger.ts` already solved the hard half on the founder
plane, and the transferable idea is precise: **the review date is written by the
CREATOR at decision time, never guessed later by a heuristic.** The person making
the call knows whether they will know in thirty days or two years. A rule that
guessed would nag about a long land hold and stay silent on a flip.

What is NOT reused is its table. `decisions_inbox_items` is founder
control-plane state, and BI5 forbids Founder OS owning customer investment truth.
So the pattern moves onto `decision_snapshots.review_due_at` and the founder's
queue is left untouched — asserted, because "reuse the pattern" is one slip from
"edit the founder's queue".

### The honesty decisions

- **Null is a real answer.** Many decisions have no natural review date, and a
  decision that will never be reviewed must stay distinguishable from one whose
  review was forgotten. The API deliberately has **no default** — a 30-day
  fallback would manufacture a due date the customer never chose and make the
  sweep nag about every decision ever recorded, which is how a prompt earns being
  ignored. A test pins the absence of `.default(`.
- **Immutability survives.** "Too soon to tell" is not an edit to the due date;
  it is a `still_open` OUTCOME, which appends. `still_open` already existed in
  `OUTCOME_KINDS` and, before this unit, appeared nowhere in server or client
  code — the vocabulary was there and unused.
- **Only a TERMINAL outcome closes the question.** Treating `still_open` as
  resolution would drop every unsettled position; treating it as silence would
  ask again as though never answered. It is counted and shown instead.
- **Oldest question first.** The longest-unanswered decision is the one whose
  outcome is least likely to be remembered later.
- **The sweep cannot write.** A prompt that could write into the learning layer
  would be a fabrication engine pointed at exactly the records that must remain
  observations. Asserted directly.
- **No `?? new Date()` anywhere.** The result asserts non-null off the
  `isNotNull` predicate rather than defaulting to a date nobody chose.

### The `pass` case is the whole point

The schema's own comment says a pass's outcome — "the parcel sold for 3x nine
months later" — is the single most valuable and least recorded fact in an
investor's history. It is also the one nobody ever volunteers, because there is
no deal in the pipeline to remind them. So the sweep filters on **nothing but
due-ness and resolution**: no kind filter, no subject-type filter, no "only if it
became a deal". A prompt that covered only decisions that turned into deals would
systematically miss the most informative half of the record. Two tests pin the
absence of those filters.

### Mutation-tested, as now standard

Making `still_open` count as resolution, and dropping the `isNotNull` guard so
dateless decisions would be nagged about, each fail the suite. The tenancy
assertion counts org predicates across all three queries (main, subquery,
interim) rather than assuming.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 658 files, 8,639 tests, 1 skipped, 0 failures.**

---

## Unit 22 — Adoption: the first customer surface to enter the loop · this commit

**Audit requirement:** the canonical loop must be REACHED, not merely built.
Also BI72 (an action must name the authority that permitted it), BI92, and
`CLAUDE.md`'s standing warning about "built but unwired".

**Files:** `server/routes-flip-analyzer.ts`, `shared/architecture/canon.ts`,
`tests/unit/canonicalLoopAdoption.test.ts` (new, 11 tests + an UP-only ratchet).

### The uncomfortable observation

Seven units built a complete canonical loop — five engines, four append-only
layers, evidence lineage, an outcome prompt, a calibration instrument. All
tested, all mounted, all org-scoped. And the number a customer actually acted on
was still recorded nowhere, because **no customer surface called any of it.**

That is this repo's signature defect, and this program produced a large instance
of it *while writing tests about it*. Every gate passed throughout:
`lint:reachability` is satisfied because the routes ARE mounted and the stores
ARE called — by the routes. The golden loops pass because they exercise the
layers directly. **Nothing measured whether a real product surface ever entered
the loop**, so nothing could notice that none did.

### Where it was wired, and why there

`POST /api/flip-analyzer/offer`. Drafting an offer is the moment a number stops
being exploratory and becomes a document — and the route already recomputes the
MAO server-side from real inputs, so it holds everything a scenario needs.

**Not `POST /api/flip-analyzer/mao`**, deliberately, and a test pins that it
stays clean. The MAO endpoint is what a form calls as inputs change; recording
there would fill the tables with keystrokes, and the calibration built on top
would then measure drafts rather than decisions.

### Four things the wiring had to get right

**It passes INPUTS to the engine, not the numbers it already computed.** The
route has `mao` in hand and hands it over anyway — `recordScenario` recomputes.
That looks redundant (the same `computeMao` runs twice) and it is the contract: a
caller that supplies pre-computed metrics can supply any metrics at all, and the
stored `engine_version` would then be a claim by the caller rather than a fact
about the arithmetic. The duplicate call is pure arithmetic on seven integers.

**It names a real authority.** `org_member:flip_analyzer_offer`, with
`actorRef: getUserId(req)`. "system" or "autonomous" would be false (BI72): the
route is reachable only by an authenticated org member, and the offer is refused
earlier if it exceeds the org's own MAO rule.

**It carries the org-rule vs platform-default distinction into `origin`.** The
analyzer already knows which figures are the operator's own rules and which are
platform defaults (`FigureSource`); flattening that on the way into the record is
exactly how a platform default later reads as "what the customer believed".
*Caught while writing it:* the first draft called
`stampAssumptionSources([], resolved.sources)` — which returns an empty array, so
it would have recorded ZERO assumptions while looking correct. It now stamps the
assumptions `computeMao` actually produced, and a test pins the argument.

**It can never fail the offer.** The offer row is already written when the
recording runs, so the whole block is in its own try/catch whose catch only logs
— same posture as the evidence write in `propertyEnrichment.ts`. It can add a
record; it can never remove one. The response reports `decisionSnapshotId: null`
rather than omitting the field, so a caller can tell "not recorded" from "not
asked for".

**It does NOT invent a review date.** An offer's fate is usually known within
weeks, so one would be useful — and nothing in the request carries one.
Defaulting would manufacture a date the operator never chose, which is precisely
what unit 21 refused to do. Null until the UI asks.

### The one ratchet in this repo that may only GROW

`ADOPTING_SURFACE_BASELINE = 1`. Every other ratchet here counts a defect and
shrinks; this counts coverage. Lowering it means a customer surface stopped
recording why it did what it did.

It deliberately counts **product** surfaces, not the canonical layers' own
endpoints — a test asserts `routes-decisions.ts` and `routes-scenarios.ts` are
excluded. Those are the loop's front door talking to itself; counting them would
let the ratchet be satisfied without a single customer ever entering the loop.
It is a small, blunt number precisely so it cannot be satisfied by another test,
another layer or another engine — only by wiring something a customer touches.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 659 files, 8,650 tests, 1 skipped, 0 failures.**
Mutation-tested: a generic `authority` and a flattened `origin` each fail.

---

## Unit 23 — The loop closes on a real surface · this commit

**Audit requirement:** the canonical loop must close for a CUSTOMER, not only in
a test. Also canonical law 9 (outcomes append) and BI178.

**Files:** `shared/schema.ts` (`offers.decision_snapshot_id`),
`migrations/0233_offer_decision_link.sql`, `scripts/migrate.mjs`,
`server/routes-flip-analyzer.ts` (reordered), `server/routes-va-engine.ts`
(outcome on resolution), `scripts/no-fabrication.allowlist.json` (re-anchored),
`shared/architecture/canon.ts`, `tests/unit/canonicalLoopAdoption.test.ts`
(ratchet 1 → 2, +8 tests).

### The planned next target was wrong, by my own criterion

NEXT_UP listed the rental comparison (`POST /api/flip-analyzer/rental`) as
candidate (a). Checking it against unit 22's own rule — *record where a number
stops being exploratory and becomes an act* — it fails: the rental endpoint is a
"what if I held it instead" calculation with no offer, no document, no act.
Wiring it would have reproduced exactly the keystroke problem unit 22 avoided by
NOT wiring the MAO endpoint.

The higher-value target was the other end of the surface already adopted:
**decisions that nothing ever grades are not a loop.** Unit 22 began recording
offer decisions; until something observes what happened to them, the calibration
instrument has nothing to calibrate.

### The link had to be real, not inferred

An outcome must know which decision it grades. The decision's subject is the
PROPERTY, and a property with two offers makes property-matching a coin flip. So
`offers.decision_snapshot_id`, written in the offer's own INSERT.

**No foreign key, deliberately.** `offers.organization_id` does not cascade while
`decision_snapshots.organization_id` does — an FK would make tenant deletion fail,
because the snapshots would go and the offers pointing at them would block it.
The read resolves through the org-scoped `getDecision`, so a stale or foreign id
yields nothing rather than leaking or crashing.

**The recording moved BEFORE the offer insert** so the link is written once
rather than patched in afterwards, which would leave a window where the offer
exists unexplained. The trade is deliberate and stated in the code: a crash
between the two now leaves an unreferenced decision rather than an unexplained
offer. **An orphaned record of reasoning is inert; an offer nobody can explain is
the thing this layer exists to prevent.**

### No actuals, and that is the honest part

An accepted offer resolves the OFFER. It measures none of what the decision
forecast — profit, ROI and total cost are unknown until the deal closes and
resells. So the outcome records the fact with an empty `actuals` list, and the
variance layer reports those metrics `unmeasured`, which is true. The tempting
alternative — recording the offer amount as a realised number — would put a
figure that was never a measurement into the calibration.

`offer_accepted` and `offer_rejected` had been in `OUTCOME_KINDS` since the
outcome layer shipped and were used by nothing. Like `still_open` before unit 21,
the vocabulary was already right and unreached.

### Only on a transition

The outcomes table is append-only, so a duplicate is permanent and would
double-count in every calibration built above it. Re-patching an already-accepted
offer records nothing. `observedAt` uses the seller's `respondedAt` when present
rather than now — back-dating to the offer's creation would make every response
look instant.

### Two corrections to my own work this unit

**A comment became false when I reordered the code.** The recording block said
"the offer already succeeded and its row is written", which stopped being true
the moment it moved above the insert. Rewritten to state the real reason it is
best-effort (every refusing check has already passed, so the operator gets a
draft either way) and the real trade the reordering makes.

**A test assertion read past its subject.** "This catch does not throw" sliced a
fixed 400 characters and picked up the enclosing handler's `Errors.badRequest` —
so it failed against code that does not throw. Replaced with a helper that ends
the slice at the closing brace at the catch's own indentation. *A source
assertion that reads past its subject is not stricter; it is wrong.*

**The fabrication allowlist went stale** because my insertion shifted
`routes-va-engine.ts` by 58 lines (1883 → 1941, 1963 → 2021). **Re-anchored, not
deleted** — the gate offers "delete the stale entry" as the usual fix, and here
that would have quietly widened it. Same call as the earlier `emailService.ts`
line shift.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 659 files, 8,658 tests, 1 skipped, 0 failures.**
Mutation-tested: recording on every patch rather than transitions, and throwing
from the bookkeeping catch, each fail.

---

## Unit 24 — The customer is finally asked · this commit

**Audit requirement:** the loop must close where the customer is. Also the
five-fixed-doors rule and the UI patterns in `CLAUDE.md`.

**Files:** `client/src/components/today/OutcomePrompt.tsx` (new),
`client/src/pages/today.tsx`, `shared/architecture/canon.ts`,
`tests/unit/canonicalLoopAdoption.test.ts` (ratchet 2 → 3, +8 tests).

**The first CLIENT surface in the whole program.** Units 2–23 were entirely
server-side: the loop could be entered by an API caller and by two server
routes, and the customer was never asked anything and never told anything.

### Why a Today card and not a route

The customer nav is five fixed doors and no new surface may become a sixth. This
is an ATTENTION item — "three decisions are waiting on you" — and Today is the
attention door, so it is a card there. Nothing was added to `NAV_MODULES` or
`nav-items.ts`, and a test asserts both.

### What it refuses to do

- **`still open` is an ANSWER, not a dismissal**, and there is deliberately no
  dismiss control. A card you can only silence by claiming a result is a card
  that manufactures results. "Still open" appends an interim observation, which
  is what the immutable record needs to stay honest about an unresolved position
  — and the server already counts those, so the card can say "checked 2× already"
  rather than asking as though for the first time. That is the difference between
  a prompt and a nag.
- **It asks for NO numbers.** An outcome's `actuals` are measurements, and a
  figure typed into a prompt three months later to clear a card is not one. The
  metrics stay `unmeasured` — which is true — until something measures them. A
  test pins the absence of any `<Input`.
- **It pre-selects nothing.** A default selection is a guess wearing the user's
  signature.

### A real user-facing bug, caught by an existing gate

The card used `animate="show"`. The shared variants are named `hidden`/`visible`,
so **the entire list would have rendered stuck at opacity 0** — a card that shows
nothing and throws nothing, the hardest kind of front-end defect to notice.
`animationVariantNames.test.ts` caught it in the full-suite run. That test exists
because this has happened before, which is the argument for keeping narrow
gates like it.

### Two of my own test bugs, fixed

- The adoption ratchet's assertion appended `(` to each claimed write, which
  suits a function name and made the check **unsatisfiable** for a client surface
  whose writes are URLs. The entries now carry their exact literal.
- The "no dismissal" assertion scanned the whole file, including the header
  paragraph explaining *why* there is no dismiss — so it failed on the prose that
  documents the rule. It now strips comments first, like every other
  code-must-hold assertion in the file.

**Gates:** `npm run check` PASS (22 lints, including the client-side eslint
ratchet — the first draft used a bare `"Cancel"` where the repo keeps one verb
vocabulary in `@/lib/labels`) · tsc clean · reachability at all four baselines ·
**full unit suite 659 files, 8,666 tests, 1 skipped, 0 failures.** Mutation-tested:
removing `still_open` and dropping the calibration invalidation each fail.

---

## Unit 25 — …and finally told · this commit

**Audit requirement:** the learning loop must be visible to the person it is
about. Also BI178.

**Files:** `client/src/components/deals/ForecastCalibration.tsx` (new),
`client/src/pages/deals.tsx`, `shared/architecture/canon.ts`,
`tests/unit/canonicalLoopAdoption.test.ts` (ratchet 3 → 4, +7 tests).

Unit 24 asked the customer what happened. Until this, the answers fed an
instrument they could never see — which is an efficient way to teach someone that
answering is pointless.

### The one property that matters: it paraphrases nothing

`summary` comes straight from `describeCalibration` and is printed as-is. The
server already refuses to claim a direction below six compared outcomes, already
says "not enough measured outcomes yet" as a whole sentence rather than a hedged
claim, and already never says a decision was good or bad.

**A client that paraphrased would eventually paraphrase the refusal away.**
"Trending optimistic (early data)" is precisely the sentence the floor exists to
prevent, it reads as helpful, and no server-side test would ever catch it. So the
panel does no arithmetic on the numbers at all — a test asserts there is no
comparison against `medianRelativeError`, `directionProbability` or
`comparedCount` anywhere in it. Every claim is the server's.

The direction badge is gated on the server's own `state`, and `no clear
direction` is styled identically to `not enough yet` and more quietly than a real
finding — **neither is a result, and styling "not enough data" like a conclusion
is how a reader comes away with one.** The `factors` line is always shown,
including when refusing, so "not enough yet" is never a bare assertion.

The floor and the BI178 caveat ("a good decision can have a bad outcome") are
stated in the UI, not only in the code.

### Behind Deals, not Today

The decisions being calibrated are offers, passes and acquisitions. And Today is
for what needs attention *now* — a calibration is a reference view you consult,
not a task. Putting it there would have competed with the prompt that actually
needs answering. A section behind an existing door; nothing added to the sidebar.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 659 files, 8,673 tests, 1 skipped, 0 failures.**

---

## Unit 26 — The loop actually turns: asking when they'll know · this commit

**Audit requirement:** Section VII — the loop must CLOSE in practice, not merely
be closeable.

**Files:** `client/src/pages/flip-analyzer.tsx`,
`server/routes-flip-analyzer.ts` (schema + use),
`tests/unit/canonicalLoopAdoption.test.ts` (one test rewritten, one added).

### The loop was complete and could never turn

Units 22–25 closed the customer-side loop end to end, and it had a quiet dead
spot: **every decision the offer path recorded carried `reviewDueAt: null`**, so
not one of them could ever reach the Today prompt. The prompt existed, the
calibration existed, the recording existed — and nothing would ever appear.

The server was right to refuse: unit 21 established that a manufactured review
date makes the prompt nag about every decision ever recorded, which is how a
prompt earns being ignored. The missing half was that **someone has to ask**, and
nothing did.

### And the client would have asked into a void

Adding the question to the analyzer was not enough. The offer route's zod schema
did not accept `reviewDueAt` and the handler hardcoded `null` — so the client
would have collected an answer, sent it, and had it silently dropped. Checking
the receiving end rather than assuming it is the whole discipline of this
program's "built but unwired" rule, and it applied to my own two-sided change.

### Where the question goes, and what it refuses

Asked at the moment of DRAFTING, because that is when the operator actually
knows — they are looking at the offer and have a view on how long a seller takes.

- **Nothing is pre-selected.** A chip selected by default would manufacture a
  date on the server's behalf, defeating the exact refusal it is paired with.
- **"No set date" carries equal weight** — an answer, not a skip. A decision with
  no date never prompts, which is correct for the many that have no natural one,
  and never answering sends the same `null`.
- **Four fixed choices, not a date picker.** Mirrors the founder ledger's
  `checkInDays: 30 | 90` shape; a picker is friction at exactly the moment
  friction makes someone skip the question, and the honest answers are coarse.
- **A past date is refused** server-side: it would make the decision due the
  instant it was recorded, which is a client bug rather than anything an operator
  could have meant.

### A test that pinned the dead spot, rewritten

`does NOT invent a review date` asserted `reviewDueAt: null` — correct while
nothing carried a date, and it would have pinned the loop permanently shut.
**Rewritten, not deleted**: the invariant is unchanged and is now asserted at
BOTH ends — the server never defaults (no `.default(`), and the client never
pre-selects. Mutation-tested: adding a server default, or pre-selecting 30 days
in the client, each fail.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 659 files, 8,674 tests, 1 skipped, 0 failures.**

---

## Unit 27 — A verified negative: nothing measures a realised number · this commit

**No code change.** The queued item was "measure actuals somewhere". Checking its
premise against HEAD before implementing disproved it, and the disproof is worth
more than a rushed build on top of it.

### What was checked, and what HEAD says

Every outcome recorded so far carries `actuals: []` — honestly, because accepting
an offer measures none of what was forecast. The queued fix assumed a realised
number existed somewhere to record. **It does not, anywhere a decision can
reference.**

| Candidate | What it actually is |
|---|---|
| `deals.analysisResults` | FORECASTS. `expectedSalePrice`, `netProfit`, `roiPercent` are all projections written at analysis time — the same kind of number a Scenario already holds, not a measurement of what happened. |
| `lead_conversions.dealValue` / `profitMargin` | Genuinely realised, and in a different plane: keyed to a LEAD for model-training attribution, with no path to a decision. |
| `offers` | Amounts offered, never amounts realised. |

Searched for `actualSalePrice`, `actual_sale`, `realizedProfit`,
`realized_profit`, `actualProfit`, `actual_profit` across the schema: **zero
hits.** There is no column in this repository holding what a deal actually
returned.

### The consequence, stated plainly

`GET /api/decisions/calibration` will report every metric `unmeasured` forever
until some surface records a realised number against a decision. The instrument
is correct, tested and honest — and it currently has nothing to measure. That is
not a defect in it; it is the next piece of work, and it is a BUILD.

### Why `lead_conversions` was not wired to it

It is the only realised money in the repo, and linking it would mean matching a
lead conversion to a decision by property or lead id — a heuristic. Unit 23
refused exactly that reasoning when linking outcomes to decisions ("a property
with two offers makes property-matching a coin flip") and added a real
`decision_snapshot_id` column instead. Reaching for the heuristic here because it
is the only thing available would undo that discipline, and a calibration built
on mis-matched pairs is worse than one that honestly says `unmeasured`.

### The recommended shape, for the next session

The **`OutcomePrompt` card is the right place**, and it does not contradict unit
24's "asks for NO numbers" rule — that rule exists so a figure is never typed
under mild duress to make a card disappear. An OPTIONAL amount on a TERMINAL
answer ("Sold" / "Acquired") is different: it is asked at the one moment the
operator genuinely knows, and leaving it blank sends `actuals: []` and keeps the
metric `unmeasured`, which is the same honest outcome as today. The rule to keep
is **never coerce**, not **never ask**.

`still_open` must never gain the field — an unresolved position has no realised
number by definition.

---

## Unit 28 — Giving calibration something to measure · this commit

**Audit requirement:** the learning loop must actually learn. Implements the
shape unit 27 verified and recommended.

**Files:** `client/src/components/today/OutcomePrompt.tsx`,
`shared/architecture/canon.ts`, `tests/unit/canonicalLoopAdoption.test.ts`
(one test rewritten, two added).

### Reversing my own rule, and why that is not a reversal

Unit 24 shipped this card asking for **no numbers at all**, on the reasoning that
a figure typed to make a card disappear is not a measurement. That reasoning is
correct about a nagging prompt and **wrong as a blanket rule** — and applied as
one it left the calibration layer permanently unable to measure anything, since
unit 27 verified that nothing else in the product records what a deal actually
returned.

**The rule worth keeping is NEVER COERCE, not NEVER ASK.** So one optional amount
is asked, under three constraints that make it a measurement rather than a
formality:

1. **Only on a TERMINAL answer.** `still_open` can never carry one — an
   unresolved position has no realised number by definition. Nor can an answer
   that resolves the position without revealing a number (a rejected offer, a
   walk-away).
2. **Only for a metric the deciding engine actually PREDICTED** — `profit` for a
   sale, `total_cost` for an acquisition, both produced by `flip_mao`. Asking for
   a number nothing forecast would produce two unrelated figures filed together,
   not a variance. A test cross-checks both ids against the engine's `produces`.
3. **Always optional.** Blank submits no `actuals` at all and the metric stays
   `unmeasured` — exactly the state it was in before. Nothing is pre-filled,
   nothing is required, and an answer with nothing to measure still submits in
   one click, so the field costs nothing to operators it does not apply to.

**Absence is never coerced to zero.** A realised profit of exactly zero is a real
and different fact from an unmeasured one, and the entire variance layer rests on
that distinction. The mutation omits `actuals` entirely rather than sending `0`,
and a test asserts there is no `?? 0` anywhere near it.

### The test that pinned the old rule, rewritten

`asks for NO numbers` asserted the card contained no `<Input` at all. **Rewritten,
not deleted**: the invariant it protected — absence stays absence — is now
asserted directly and more sharply, against the coercion rather than against the
existence of a field. Mutation-tested: coercing blank to `0`, and letting
`still_open` carry a measurement, each fail.

### A window bug in my own new test

`only asks where a number is a real MEASUREMENT` sliced 200 characters from each
answer entry, and the slice from `offer_rejected` ran into `acquired` — which
does measure — so it **failed against correct code**. Each entry is now bounded by
the next one. This is the third time in this program a fixed-size source window
has read past its subject; the lesson is the same each time and is now written
into the helper's own comment: *a source assertion that reads past its subject is
not stricter, it is wrong.* The rewrite also asserts the two answers that DO
measure, so the test cannot pass by measuring nothing at all.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 659 files, 8,676 tests, 1 skipped, 0 failures.**

---

## Unit 29 — A surface that must NOT adopt, and why · this commit

**Audit requirement:** canonical law 1 — canonical state has ONE owner. Also the
repo's standing "do not build a second X" discipline.

**Files:** `tests/unit/canonicalLoopAdoption.test.ts` (+1 test, `MUST_NOT_ADOPT`).

### The up-only ratchet had a failure mode

`ADOPTING_SURFACE_BASELINE` counts product surfaces that record into the
canonical loop and may only grow. That is the right pressure and it has a hole:
**it can be satisfied by wiring the wrong thing.**

Looking for a second adoption surface, the note payoff path is the obvious
candidate — `note_payoff` is a registered engine, `POST :id/payoff/quotes` is
unambiguously an act (the quote becomes a document a borrower is given), and it
is the most economics-shaped route in the product. Wiring it would have raised
the ratchet and looked like progress.

It would have been a defect. `note_payoff_quotes` persists `engine_version` (NOT
NULL), `day_count_convention` and the VERBATIM `engine_input_json` alongside
every output — it is already a complete, recomputable, defensible economics
record. `shared/economics/scenario.ts` names it in its own header as **the
pattern the Scenario layer generalises**, not one it replaces. Recording a
Scenario there would create a SECOND owner of the same canonical state.

### The criterion, sharpened

Unit 22 said: record where a number stops being exploratory and becomes an act.
That is necessary and not sufficient. The full rule:

> **Adopt where the reasoning would otherwise be LOST. Do not adopt where an
> equivalent versioned record already owns that state.**

`MUST_NOT_ADOPT` encodes it, so the ratchet cannot be satisfied harmfully. The
guard also **checks its own justification** — it asserts `notes-vertical.ts`
really does declare `engine_version` NOT NULL and `engine_input_json`, so the
exemption cannot outlive the reason for it. An allowlist entry whose rationale
has silently stopped being true is how every stale exemption in this repo began.

Mutation-tested: adding a `recordScenario(` call to `routes-notes.ts` fails it.

### What this unit deliberately did NOT do

It did not wire a second surface. The remaining candidates were checked against
the sharpened criterion and none passed: the rental comparison and the MAO
endpoint are exploratory (no act), the public land calculator has no tenant, and
the note payoff path already owns its state. **Adding a surface to move a number
would be optimising for the ratchet rather than for the customer**, which is the
failure the ratchet exists to detect in others.

---

## Unit 30 — Security: four lead write paths bypassed a configured permission · this commit

**Audit requirement:** source-of-truth precedence #1 — safety, security and
authorization outrank everything else in this program.

**Files:** `server/utils/assignedLeadGate.ts` (new),
`server/routes-leads.ts` (5 paths), `scripts/ratchets/as-any.json` (1407 → 1406),
`tests/unit/assignedLeadGateCoverage.test.ts` (new, 9 tests).

### The defect

`team_members.viewOnlyAssignedLeads` is a restriction an org owner sets
deliberately, and which is forced on for the `va` role. It was enforced on
`GET /api/leads`, `GET /api/leads/paginated`, `PUT /api/leads/:id` and the
`/api/bulk/leads/*` routes — and **missing from four writes**:

| Path | What guarded it |
|---|---|
| `DELETE /api/leads/:id` | `canDeleteLeads` only — which says the caller may delete leads, not WHICH |
| `PATCH /api/leads/:id/restore` | nothing at all |
| `POST /api/leads/bulk-delete` | `canDeleteLeads` only |
| `POST /api/leads/bulk-update` | nothing at all |

A VA restricted to their own leads could delete, restore or mass-update any lead
in the org by guessing a numeric id, and the two bulk paths accepted an arbitrary
id array.

**Severity, stated honestly: INTRA-ORG, not cross-tenant.** Every affected path is
already org-scoped, so nothing crossed an organization boundary. What was
bypassed is a permission the org's own owner configured — a real boundary, and
not the same thing as a tenant leak.

### Why it was invisible

Exactly the shape of the `/api/admin` MFA defect found earlier in this program: a
correct gate applied to some surfaces and not others. Each route reads fine on
its own; the gap only appears when the surfaces are enumerated and checked
together. **Five hand-written copies of a security rule is not five times the
safety — it is five chances to forget the sixth**, and the sixth through ninth
were forgotten.

### The fix, and one thing it deliberately does not do

The rule now has ONE owner. `assertAssignedLeadWritable` checks a single lead
against its assignee; `refuseBulkLeadWrite` **refuses a bulk write outright
rather than filtering it to the caller's own leads** — a bulk call that quietly
does less than it was asked reports success for work it did not do, and that is
harder to notice than a refusal. That was already `routes-bulk.ts`'s choice; this
generalises it rather than inventing a second answer.

An **unassigned** lead is not writable by a restricted caller. Treating "assigned
to nobody" as "assigned to everybody" would void the restriction for exactly the
leads most likely to be unclaimed.

Four paths also lacked `attachPermissionContext()`. Without it the check
`context?.permissions.viewOnlyAssignedLeads` yields `undefined`, the condition is
falsy, and the gate **fails open** — so the middleware is asserted alongside the
call rather than assumed.

### The test found that the fix was incomplete

Written before the last edit, it failed on `PUT /api/leads/:id` — which still
carried its own hand-written copy. That is the test doing its job: the unit's
claim was "one owner", and two owners is not one. Migrating it removed an
`(existingLead as any).assignedTo`, so the **as-any ratchet dropped 1407 → 1406
and was lowered in the same commit** per its strictly-down rule. The shared gate
takes a structural `{ assignedTo?: unknown }` rather than an `any` erase — it
needs one field, so it does not need the row's whole type and must not destroy it.

### Mutation-tested against all three failure modes

Removing the bulk refusal (reintroducing the original defect), computing the
single-lead gate but ignoring its result, and treating an unassigned lead as
writable — each fails. The suite also carries a **vacuity guard**: if a route is
renamed, the file fails rather than silently checking nothing, which is the
failure mode of every source-scanning security test.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 660 files, 8,686 tests, 1 skipped, 0 failures.**

---

## Unit 31 — Three declared permissions that nothing enforced · this commit

**Audit requirement:** source-of-truth precedence #1 — authorization.

**Files:** `server/routes-properties.ts`, `server/routes-deals.ts`,
`server/routes-finance.ts`, `tests/unit/destructivePermissionCoverage.test.ts`
(new, 5 tests), plus a corrected comment-stripper in three test files.

### The defect

Unit 30 found a permission enforced inconsistently. Asking whether the same drift
existed elsewhere found something worse: **three permissions enforced NOWHERE AT
ALL.**

| Route | Guarded by, before |
|---|---|
| `DELETE /api/properties/:id` | `isAuthenticated` + `getOrCreateOrg` only |
| `POST /api/properties/bulk-delete` | same |
| `POST /api/deals/bulk-delete` | same |
| `DELETE /api/notes/:id` | same |

`canDeleteProperties`, `canDeleteDeals` and `canDeleteNotes` are all FALSE for
`member`, `va` and `viewer`. They existed in the type, in the role table and in
the client's `useOrganization` shape — and were read by no server code on any
path. **A `viewer`, a role whose entire purpose is read-only access, could delete
every property, deal and note in the organization**, in bulk.

**Severity, stated honestly: intra-org, not cross-tenant.** All four paths are
org-scoped, so nothing crossed an organization boundary. What was unenforced is
the org owner's own configuration.

### Why a registry rather than four assertions

The defect was not "someone forgot a middleware". It was that **nothing related
the permission vocabulary to the routes that need it**, so a permission could be
declared, shipped, read by the client and never once consulted. Four hand-written
assertions would fix the four known routes and leave the next one exactly as
undiscoverable. The test maps each destructive permission to its routes, and
fails both when a route loses its gate AND when a declared permission has no
route — which is how these sat unenforced.

### The test found the fourth one itself

`canDeleteNotes` was initially written as a documented exemption: "no notes
delete endpoint exists". The exemption **checks its own justification**, and the
check failed — `routes-finance.ts` has `DELETE /api/notes/:id`, unguarded. The
exemption became a fifth registry entry instead. An exemption that cannot verify
its own premise is how every stale allowlist in this repo began.

The two surviving exemptions are verified the same way: `canDeleteCampaign` has
no delete route anywhere (checked against every route file), and `canDeleteOrg`
is founder-only under `/api/admin` behind MFA and an exact-name confirmation —
a customer-role permission is the wrong lock for it, and adding one would imply a
customer path that must never exist.

### A broken helper, found and fixed

The comment-stripper these source-scanning tests rely on used the obvious
one-regex form. On `server/routes.ts` it **removed 38.8% of the file** — an
unbalanced block-comment opener inside a string swallowed everything to the next
closer, including the `app.use("/api/admin", …)` line an assertion was checking.
So the assertion failed against correct code; a weaker assertion would have
**passed against broken code**. This is the third time in this program a
source-scanning helper has read past its subject.

Replaced with a line-state machine, which structurally cannot run away. Two
corrections on the way:

- **The first guard's premise was wrong.** "A strip that eats a third of the file
  is a bug" fired on correct output — this repo's files are deliberately
  comment-heavy and `assignedLeadGate.ts` is 72% prose by design. A guard whose
  premise is wrong is worse than no guard: it fails on correct input and trains
  the next reader to loosen it. Replaced with a structural check — an unclosed
  block at EOF, which is the actual runaway signal. Comment density is not
  evidence of anything.
- **JSX comments are prose too.** `{/* No "dismiss" … */}` made a test asserting
  the ABSENCE of "dismiss" fail on the very comment documenting why it is absent.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 661 files, 8,691 tests, 1 skipped, 0 failures.**
Mutation-tested: removing all three new gates fails the suite.

---

## Unit 32 — The viewer role, actually made read-only · this commit

**Audit requirement:** source-of-truth precedence #1 — authorization.

**Files:** `server/middleware/viewerReadOnlyGate.ts` (new),
`server/middleware/getOrCreateOrg.ts`, `tests/unit/viewerReadOnlyGate.test.ts`
(new, 14 tests).

### The defect

`server/middleware/roleGuard.ts` has documented `viewer — read-only across the
CRM` since it was written. **It was not.** `canEditLeads`, `canEditProperties`,
`canEditDeals`, `canEditNotes` and every `canCreate*` are FALSE for `viewer` and
TRUE for every other role — and none of them was enforced by any server code on
any path. A viewer could create and edit leads, properties, deals and notes
across the whole CRM.

Thirteen permissions in total have zero `requirePermission` sites. `viewer` is
the only role the edit/create ones deny, so that is the concrete exposure and
this gate closes it.

**Severity, stated honestly: intra-org, not cross-tenant.** Every route involved
is already org-scoped. What was unenforced is the org owner's own configuration —
the entire reason to invite somebody as a viewer rather than a member.

### Why a gate and not sixty `requirePermission` calls

The destructive-delete gaps in unit 31 were fixed route by route because there
were four and each names a specific resource permission. **Read-only is different
in kind**: it is a statement about a ROLE, and the set of routes it covers is
"every mutation not explicitly exempt". Gating each one would mean touching
sixty-plus handlers and would leave the sixty-first open by default — which is
precisely how those four came to be unguarded.

**The polarity is the design.** A new write route is DENIED to viewers unless
someone deliberately exempts it. Every alternative fails open.

It chains from `getOrCreateOrg` alongside `subscriptionPauseGate` and
`dunningAccessGate`, whose own comment already establishes the seam:
*"getOrCreateOrg is the single chokepoint that sets req.organization across every
org-scoped route ... there is no global /api org middleware."* Reusing that
rather than inventing a second one. It runs LAST of the three, so a paused or
delinquent org is refused for the more actionable reason.

### The fail-open it would have had

The first draft read `req.permissionContext`. That is attached by
`attachPermissionContext()` and `requirePermission()`, both of which run
PER-ROUTE and therefore **after** this chokepoint — so it would have found
`undefined` on essentially every request, never matched `"viewer"`, and passed
everything through while looking correct. Exactly the shape of the missing
`attachPermissionContext()` found in unit 30, one layer up.

It now resolves the role itself and **caches** the context onto the request, so a
later `requirePermission` reuses it rather than re-reading the membership. On
routes that already gate this is net-neutral; elsewhere it is one extra read per
MUTATING request, and reads are untouched — a read never even resolves the role.

### It fails CLOSED, and the trade is stated

If the membership cannot be read, the gate refuses rather than assuming. A
security gate that guesses is not a gate. The cost is that writes are refused
during a membership-store outage — but during such an outage the writes would be
failing anyway, so refusing loses little while assuming loses the guarantee. It
logs at error level, because a gate that starts refusing everyone must be visible
immediately.

### Behavioural, not source-scanned

The gate takes a request and either calls `next()` or responds, so it is driven
directly with fakes. **A security gate that has only ever been read is a security
gate that has never been tried.** Mutation-tested: reading the not-yet-attached
context, and failing open on an unresolvable role, each fail five tests.

The exempt list is asserted to stay small and to contain no CRM resource — every
entry is a path a read-only account may write to, and the list growing quietly is
how "read-only" stops being true.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 662 files, 8,705 tests, 1 skipped, 0 failures.**
