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
