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

---

## Unit 33 — Three privileged mutations, including a billing one · this commit

**Audit requirement:** precedence #1 (authorization), and the founder's standing
rule that money boundaries are founder-controlled.

**Files:** `server/routes-organization.ts` (3 routes),
`tests/unit/destructivePermissionCoverage.test.ts` (+3 tests).

Continuing the audit past the delete verbs found three more unenforced
mutations, all in `routes-organization.ts`:

| Route | Permission | Denied to |
|---|---|---|
| `POST /api/organization/seats/purchase` | `canManageBilling` | **everyone but `owner`** — including `admin` |
| `PATCH /api/organization/ai-settings` | `canAccessSettings` | member, va, viewer |
| `PATCH /api/organization/settings` (partly) | `canAccessSettings` | member, va, viewer |

### The billing one, described precisely

`seats/purchase` creates a Stripe checkout session and writes `stripeCustomerId`
onto the organization, with no permission gate at all.

**It is NOT a silent charge** — completing a checkout session requires someone to
enter a card, so no money moved without a human. Saying otherwise would overstate
it. What it IS: a billing action that mutates billing state, startable by a role
the owner explicitly denied billing access to. `canManageBilling` is true for
`owner` ONLY — not even `admin` — which is exactly the shape of a deliberately
narrow money boundary, and nothing enforced it.

### The settings endpoint is gated by FIELD, not wholesale

`PATCH /api/organization/settings` mixes two kinds of thing: per-org UI state any
member legitimately toggles (`showTips`, `checklistDismissed`,
`notificationsConfigured`) and org-wide operational settings (`mailMode`,
`timezone`, `currency`) that `canAccessSettings` exists to deny.

Gating the whole route would have stopped a member dismissing their own
checklist — **a real regression to fix a real gap**, which is the trade a blunt
gate makes and the reason blunt gates get reverted. Only the org-wide subset is
refused. Splitting the endpoint is the right long-term shape; this is the honest
fix that costs nobody anything today, and a test asserts the benign fields stay
writable so a later tightening cannot quietly swallow them.

### Where the audit now stands

Thirteen permissions had zero `requirePermission` sites when this thread started.
Resolved as:

- **Fixed by gating** (units 31, 33): `canDeleteProperties`, `canDeleteDeals`,
  `canDeleteNotes`, `canManageBilling`, `canAccessSettings`.
- **Fixed structurally** (unit 32): every `canEdit*` and `canCreate*` — `viewer`
  was the only role they denied, and the read-only gate covers all of them at
  once, including routes nobody has written yet.
- **Enforced by another mechanism, verified**: `canManageTeam` (team role change
  and invitations use `requireAdminOrAbove()`), `canDeleteOrg` (founder-only
  under `/api/admin`, MFA + exact-name confirmation).
- **No exposure**: `canViewLeads` is true for every role, so nothing is denied.
- **Still unenforced, and recorded rather than guessed at**: `canImportData`,
  `canExportData`, `canAssignLeads`. These deny member/va/viewer; viewer is now
  covered by the read-only gate, so the residual question is member/va on import,
  export and lead assignment. Left for a session that can check each route's
  real caller rather than gating on a pattern match.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 662 files, 8,708 tests, 1 skipped, 0 failures.**
Mutation-tested: removing the billing gate, and folding a benign field into the
org-wide set, each fail.

---

## Unit 34 — A read-only account could export the whole database · this commit

**Audit requirement:** precedence #1. This is the most consequential of the
permission findings.

**Files:** `server/routes-communications.ts`, `server/routes-import-export.ts`,
`server/routes-finance.ts`, `server/routes-properties.ts` (10 routes),
`tests/unit/destructivePermissionCoverage.test.ts` (+4 tests).

### The defect

`canExportData` is FALSE for `member`, `va` and `viewer`. It was enforced on
**exactly one of ten** export endpoints — `GET /api/leads/export`. The other nine
carried `isAuthenticated` and `getOrCreateOrg` only, and they include:

- **`/api/export/backup`** — a ZIP of the entire organization
- **`/api/export/:entityType`** — the generic exporter
- **`/api/export/jobs/:id/download`** — the completed export file itself
- per-entity CSV exports for leads, properties, deals and notes

**These are GETs, so unit 32's viewer read-only gate does not cover them** — it
refuses mutations. A viewer, the role most likely to be handed to an outside
party precisely because it "can only look", could export the organization's
entire database.

**Severity: intra-org data exfiltration by a role explicitly denied export.**
Still not cross-tenant — every route is org-scoped. But export is exactly the
capability an owner withholds when they do not fully trust someone, and it was
the least protected thing in the permission system.

`bulkExportLimiter` sits on two of these routes and reads like protection. It
bounds how OFTEN, never WHO. A test now says so explicitly.

### The test found the tenth route; I found nine

The coverage test derives the export surface **from source** rather than from a
hand-written list. That immediately paid: `/api/export/jobs/:id/download` is
registered across several lines, so the single-line grep that located the other
nine walked straight past it — and it is the step that hands over the file.

Then the test's own extractor had the same bug in mirror image: it captured only
to the end of the line containing the path, so it reported that route ungated
after it had been gated. The capture now runs from `api.get(` to the start of the
HANDLER. **The line-bound version could also have reported a route GATED when it
was not**, which is the dangerous direction — this is the fourth time in this
program a source-scanning span has been drawn too narrowly, and the first where
getting it wrong would have hidden a hole rather than invented one.

Three endpoints are deliberately excluded and named: `/api/export/jobs` and
`/api/export/jobs/:id` report on the caller's own export requests and carry no
records, and the per-conversation AI transcript export is scoped to one
conversation the caller can already read.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 662 files, 8,712 tests, 1 skipped, 0 failures.**
Mutation-tested: removing the backup gate and one CSV gate each fail.

---

## Unit 35 — Bulk import, and the end of the permission audit · this commit

**Files:** `server/routes-import-export.ts`, `server/routes-leads.ts`,
`server/routes-properties.ts` (11 routes),
`tests/unit/destructivePermissionCoverage.test.ts` (+4 tests).

`canImportData` is FALSE for `member`, `va` and `viewer`, and was enforced on
**zero of thirteen** import endpoints. These are POSTs, so unit 32's read-only
gate already covered the viewer; the residual was `member` and `va`, who could
bulk-import into the CRM against an explicit denial — polluting the record set at
scale and consuming the org's usage allowance.

Lower severity than the export gap: creating data is recoverable, exfiltrating it
is not. Same defect shape.

**Previews are gated too.** A preview parses the operator's uploaded file and
reports what it would create; leaving it open would let a denied role use the
importer as a file-processing oracle against the org's own schema.

Two endpoints are exempt with verified reasons: `/api/data-sources/bulk-import`
is founder-only behind `isFounderAdmin` (the exemption re-checks that middleware
is still there), and `/api/writing-styles/:id/import` imports a writing-style
config rather than customer records.

### The audit is now complete

Thirteen permissions had zero `requirePermission` sites when this thread opened.
Final disposition:

| Permission | Outcome |
|---|---|
| `canDeleteProperties`, `canDeleteDeals`, `canDeleteNotes` | gated (unit 31) |
| `canManageBilling`, `canAccessSettings` | gated (unit 33) |
| every `canEdit*`, `canCreate*` | resolved structurally by the viewer read-only gate (unit 32) — viewer was the only role they denied |
| `canExportData` | 9 of 10 endpoints gated (unit 34) |
| `canImportData` | 11 of 13 endpoints gated (this unit) |
| `canManageTeam` | verified enforced by `requireAdminOrAbove()` |
| `canDeleteOrg` | verified founder-only under `/api/admin`, MFA + exact-name confirmation |
| `canViewLeads` | true for every role — denies nobody |
| `canAssignLeads` | **still unenforced.** Recorded, not guessed at. |

`canAssignLeads` is left deliberately: assignment happens through several
surfaces (the lead PUT's `assignedTo`, bulk update, the round-robin assigner),
and the honest fix needs each caller checked rather than a pattern match. It is
also the mildest of the set — reassigning a lead inside an org neither destroys,
exfiltrates nor spends.

**What the six security units share.** Every one was the same defect: a rule that
existed and was applied to some surfaces and not others. The MFA gate protected
2 of 7 admin routes; the assigned-leads gate covered reads but 4 writes; three
delete permissions were declared and never consulted; `canExportData` reached 1
of 10 exports; `canImportData` reached 0 of 13. **None was a missing rule. Every
one was an unenforced one** — which is invisible route by route and obvious the
moment the surface is enumerated. That is why each fix ships with a registry that
derives its surface from source rather than a hand-written list, and why one of
those registries found a route the hand-list had missed.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 662 files, 8,716 tests, 1 skipped, 0 failures.**

---

## Unit 36 — The first CROSS-TENANT finding · this commit

**Audit requirement:** precedence #1, and specifically tenant isolation — the one
thing that outranks everything else in this program.

**Files:** `server/routes-organization.ts` (1 route),
`tests/unit/founderRouteGuardCoverage.test.ts` (new, 4 tests).

### The defect

`GET /api/founder/safety-status` carried `isAuthenticated` and `getOrCreateOrg`
and **no founder check**, despite living under `/api/founder/`. Its query reads

```
db.select().from(simulatedActions).where(createdAt >= since).limit(100)
```

— with **no organization filter** — and returns `sample: recent.slice(0, 10)`.

So any authenticated user of any organization could read ten recent
`simulated_actions` rows **belonging to other tenants, payloads included**. A
simulated Lob payload is written as
`{ recipientName, recipientAddress, color, doubleSided }`.

**This is the first CROSS-TENANT finding in the program.** Every earlier
authorization defect was intra-org — a permission the org's own owner had set,
bypassed within that org. This one crosses the boundary that matters most.

Two honest qualifications, neither of which changes the disposition: the table
only holds rows while simulation mode is active (a founder-set flag), so the
practical exposure depends on that; and the leak is bounded to ten rows per call.

**The fix is the missing guard, NOT an org filter.** Scoping the query would
break the platform-wide view this endpoint exists to provide — a founder safety
dashboard is *meant* to see every org. The cross-org read is correct once the
caller is provably the founder.

### Why nothing had caught it

608 `/api/founder/*` routes registered from ~40 files, with **no global mount**.
Nothing related the set to its guard, so each route looked fine read on its own —
the same shape as every finding in units 30–35, on the surface where it matters
most.

### Three wrong answers before the right one

Writing the checker produced large FALSE POSITIVES — 378, then 322, then 20
"unguarded" routes, all of them actually fine. The surface guards itself **four**
different ways: middleware in the registration, an in-handler first statement, a
prefix mount in `routes.ts`, and a spread `...guards` array.

Each wrong number was verified by hand before being believed, which is the only
reason none of them was reported. **The usual lesson from this program is that
source scanners under-report; here the danger was the opposite.** A checker that
models three of four mechanisms calls healthy code broken — and a security test
that cries wolf is a security test that gets deleted.

The test now models all four, and asserts the ORDERING rule for prefix mounts:
a mount only counts if it is registered before the routes it covers. That is the
`/api/admin` MFA defect exactly, and the assertion is structural so the rule
cannot be dropped from the scanner without failing.

Mutation-tested: reintroducing the missing guard, and moving the v11 prefix gate
below its registrar, each fail.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 663 files, 8,720 tests, 1 skipped, 0 failures.**

---

## Unit 37 — A protected write with an unprotected read · this commit

**Files:** `server/routes-leads.ts` (3 routes),
`tests/unit/piiScopeSymmetry.test.ts` (new, 5 tests).

### The defect

`server/middleware/roleScope.ts` defines `tenant_pii_read` and
`tenant_pii_write` — "SSN, prior addresses, screening results" — and denies both
to `member`, `va` and `viewer`.

`POST /api/skip-traces` carried `requireScope("tenant_pii_write")`. The three
READS, **twenty lines above it in the same file**, carried nothing:

```
GET /api/skip-traces
GET /api/skip-traces/:id
GET /api/skip-traces/lead/:leadId
```

`skip_traces.results` is typed `{ phones, emails, addresses }` — phone numbers,
email addresses and address history for a real person. So the scope stopped a
denied role from ORDERING a skip trace and let them read every one the
organization had already bought.

**Reads are what exfiltrate.** A write gate without its matching read gate is the
most misleading shape in an authorization system, because the surface looks
considered: somebody thought about the scope, named it correctly, and applied it
to the wrong half.

Same class as units 30, 31 and 34 — a rule that exists and is applied to some
surfaces and not others — and the sharpest instance, because the protected and
unprotected routes are neighbours.

### A note on the scope model, checked before acting

`roleScope.ts` reads like an aspirational feature — its header describes
bookkeepers, attorneys and family co-owners, none of which are real roles
(`OrgRole` is `owner | admin | member | viewer | va`). That would have made
enforcing it premature.

It is not aspirational: `ROLE_SCOPES` maps **exactly the five real roles**, and
the denial of `tenant_pii_read` to member/va/viewer is a live rule. Worth
checking, because "this feature isn't finished" would have been a plausible and
wrong reason to leave PII reads open.

### The test asserts the premise, not just the gate

Three of the five assertions check things other than the middleware: that the
scope really is denied to member/va/viewer AND granted to owner/admin (a gate
that locks everyone out is also broken), and that `skip_traces.results` still
carries contact data at all. **An authorization test whose subject has quietly
stopped being sensitive is enforcing a rule with no reason left.**

The read gate is asserted separately from the general "every route has a scope"
check, deliberately: the write was already gated when this was found, so a single
combined assertion would pass on three of four and its failure message would not
say which half was missing.

Mutation-tested: removing one read gate fails, and quietly granting `viewer` the
scope fails — the second is the subtler regression, because the routes would
still look gated.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 664 files, 8,725 tests, 1 skipped, 0 failures.**

---

## Unit 38 — A signing secret readable by any org member · this commit

**Files:** `server/services/webhookDispatcher.ts`,
`server/routes-integrations.ts`, `tests/unit/webhookSecretRedaction.test.ts`
(new, 9 tests).

### Found by generalising unit 37

Unit 37's defect — a guarded write with an unguarded read on the same path —
generalises, so the next step was to scan for it across every route. Eight
same-path asymmetries came back.

**Seven were not defects**, and saying so matters as much as the eighth: a role
that may read leads but not delete them is exactly how permissions are supposed
to work. Reading `/api/leads` while being denied `canDeleteLeads` is correct
design, and gating those reads on a pattern match would have broken the product
to satisfy a scanner. The filter is not "is the read unguarded" — it is **what
does the read actually expose**.

### The eighth

`WebhookEndpoint.secret` is the HMAC key every outbound delivery is signed with.
`GET /api/webhooks` returned the stored objects verbatim, so any authenticated
member — a `viewer` included — could read it, while the `PUT` that sets it is
`requireAdminOrAbove()`.

**A leaked signing secret is worse than leaked data.** It grants the ability to
FORGE deliveries: whoever holds it can inject fabricated deal and lead events
into the customer's own downstream systems, and the signature will verify. That
is capability, not information — a different category from every other finding in
this program, even though the defect shape is identical to unit 37's.

Intra-org, since the read is org-scoped. But a secret's blast radius is not
bounded by where it leaked from.

### Redaction, not a gate

Everyone in the org may legitimately need to see which webhooks are configured
and whether they are active. Nobody needs to read the secret back — **not even an
owner, who had it when they set it.** A write-only secret keeps the read useful
and removes the exposure; a gate would do the opposite of both. `hasSecret` is
reported so the UI can still say "signing is configured".

The secret is **removed, not masked**. A masked value is still a field a client
can round-trip and save as the literal mask, replacing a real key with four
asterisks. Absent is the only shape that cannot be written back by accident, and
a test pins it.

### The half that was easy to forget

`client/src/pages/webhooks.tsx` GETs the endpoint list and PUTs it straight back.
Redacting the read **without preserving on write** would have written
`secret: undefined` over every configured key on the next save — silently
disabling signature verification on every downstream integration, raising no
error anywhere and showing nothing in the UI.

So `saveWebhookEndpoints` now carries forward a stored secret when the incoming
endpoint omits one, matched by `url`. Three tests bound that behaviour so
preservation cannot become something worse: an explicit new secret still
REPLACES (rotation must stay possible), a brand-new endpoint does not inherit
another's key, and changing an endpoint's URL does not carry the old key to a
destination the operator never signed for.

The dispatcher's own reader stays unredacted — signing genuinely needs the key,
and redacting the shared function would have broken outbound webhooks outright.

Mutation-tested: masking instead of removing, and dropping the preservation, each
fail.

**Gates:** `npm run check` PASS (22 lints) · tsc clean · reachability at all four
baselines · **full unit suite 665 files, 8,734 tests, 1 skipped, 0 failures.**

---

## Unit 39 — The same secret, the other exposure: plaintext at rest · this commit

**Files:** `server/services/webhookDispatcher.ts`,
`tests/unit/webhookSecretAtRest.test.ts` (new, 15 tests),
`tests/unit/webhookSecretRedaction.test.ts` (assertions rewritten to the new
truth).

### The fix that was only half a fix

Unit 38 stopped `GET /api/webhooks` handing the HMAC signing key back. It did
nothing about where the key lives: `saveWebhookEndpoints` wrote it into
`organization_integrations.credentials` **in the clear**, while every other
provider in that same column stores an `{ encrypted: "<envelope>" }` blob.

Same credential, two different exposures. Closing the API one leaves a database
dump, a support query, a logical replica and a restored backup all still
yielding a key that lets its holder forge deliveries into the customer's own
systems.

This was found by asking a question the previous unit did not: *having stopped
the API returning it, where else does this value exist?*

### Field-level, not blob-level — and not for consistency

The obvious move was to match the other providers and store
`{ encrypted: enc(<the whole endpoint list>) }`. Encrypting only each endpoint's
`secret` buys three properties the blob shape cannot:

- **The redacted read never decrypts.** `getWebhookEndpointsForDisplay` answers
  "is signing configured?" from the ciphertext's presence, so the API path never
  holds key material at all. Unit 38's redaction is no longer the only thing
  standing between a member and the key.
- **The webhook list survives a key problem.** url/events/isActive stay
  readable, so a missing key degrades signing rather than blanking the
  configuration screen.
- **`/api/integrations` keeps ignoring this row.** That route decrypts anything
  carrying `credentials.encrypted`; giving the webhooks row one would have
  pulled it into a surface never written with it in mind. Checked, not assumed.

### Lazy migration, no script

Rows written before this hold plaintext. `isEncrypted` tells the two apart by
the `enc:v1:` marker — not `decrypt()`, which passes an unrecognised string
through as plaintext and would therefore turn a corrupted envelope into a
signing key. Legacy rows sign correctly as-is and are encrypted on their next
save. No data-migration script, no window where a row is unreadable, no deploy
ordering to get right.

### The new state, and why it refuses

Encrypting at rest creates a state that did not exist before: **a secret that is
configured but cannot be read** (key rotated without the old kid, ephemeral dev
key after a restart, corrupted row). It is deliberately a third state,
`secretUnavailable`, distinct from "no secret configured" — because the two
demand opposite behaviour.

The tempting handling is to drop the secret and deliver. That is the dangerous
one: a receiver's check is usually "if a signature header is present, verify
it", and an unsigned payload sails straight through it. Signing with the
ciphertext is no better — the signature can never verify and the failure reads
as the receiver's bug.

So **an endpoint configured for signing is never delivered to unsigned.** The
delivery is skipped, counted failed, and logged with what to do about it. An
endpoint with no secret at all still delivers unsigned, exactly as before.

### A save must never destroy a key it cannot read

Preservation (unit 38) now carries the **ciphertext** across untouched rather
than the decrypted value. That is not an optimisation: it means a routine save —
toggling an endpoint off, editing a URL — cannot take "this process cannot open
the envelope" as "there is no secret here" and write the field away. The org
would otherwise lose a key that a restored encryption key could have recovered,
and nothing would report it.

`||` not `??` on the carried value, deliberately: an empty-string secret is far
more likely to be a blank form field than an intent to disable signing.

Derived fields are stripped on write. `hasSecret` and `secretUnavailable` are
answers this module computes, and the round-trip hands them back as input — a
client must not be able to assert them. (Unit 38 was persisting `hasSecret`;
that is fixed here too.)

### Verification

Five mutations, each caught: storing plaintext; dropping the dispatch refusal;
making the display path decrypt; keeping the derived fields; reading the
decrypted shape for preservation (which drops an unreadable key AND churns the
envelope — two tests fire).

Unit 38's test file was **updated, not deleted**, per wave discipline: the
persisted secret is now an envelope, so its assertions decrypt before comparing.
Every invariant it pinned — rotation still replaces, a new endpoint inherits
nothing, a changed URL does not carry the old key — survives unchanged.

---

## Unit 40 — Charged for the key we then ignored · this commit

**Files:** `server/services/integrationCredentials.ts` (new),
`server/routes-misc.ts`, `server/routes-integrations.ts`,
`server/routes-properties.ts`, `server/services/mailProvider.ts`,
`server/services/parcel.ts`, `server/services/comps.ts`,
`server/services/directMail.ts`, `server/services/directMailService.ts`,
`server/services/emailService.ts`, `server/services/financeAgent.ts`,
`server/services/providers/resolveProviderCredential.ts`,
`tests/unit/integrationCredentialShape.test.ts` (new, 14 tests).

### Found by asking unit 39's question of the neighbouring column

Unit 39 asked "having stopped the API returning this secret, where else does it
exist?" Asking the same of `organization_integrations.credentials` — the column
the webhook secret lives in — turned up a second plaintext credential, and then
something considerably worse than plaintext.

**Two writers, two shapes:**

| route | shape |
|---|---|
| `POST /api/integrations/:provider` | `{ encrypted: "<envelope>" }` |
| `POST /api/settings/save-api-key` | `{ apiKey: "sk_live_..." }` — **in the clear** |

Same five providers (lob, regrid, twilio, sendgrid, rapidapi). The second is
the route behind the BYOK panel in Settings — the one a customer actually uses.
**Nothing in the client calls the first.**

### The readers were split down the middle

- `.encrypted` only — `comps.ts`, `directMail.ts`, `directMailService.ts`,
  `emailService.ts`, `resolveProviderCredential.ts`, `routes-properties.ts`,
  `financeAgent.ts`, and seven test/validate routes.
- `.apiKey` only — `mailProvider.ts`, `parcel.ts`, the BYOK status route.

So a key set through the panel was invisible to almost everything, and the
consequences compound:

- **comps and directMail did not find it**, so the org's lookups and mail ran on
  the PLATFORM's key. AcreOS paid a vendor bill for a customer who had supplied
  their own account.
- **`routes-properties` decided whether to charge credits with
  `credentials?.encrypted`**, so that same customer was ALSO billed ten cents a
  comps query for lookups their own key was meant to cover. **Charged for a key
  they gave us and we then ignored** — two halves of one wrong answer, and the
  reason this unit is named for the billing rather than the encryption.
- `hasConnectedSendingIdentity` reported no connected sending identity for an
  org that had connected one.
- `POST /api/integrations/:provider/test` read `.encrypted` unguarded and handed
  `undefined` to `JSON.parse` — a 500 instead of an answer.

This is the units 30–38 class again — a rule applied to some surfaces and not
others — except the rule is a data shape rather than a permission, and the cost
lands on the customer's invoice rather than their privacy.

### One accessor, and the gate reads the same way as the use

`readIntegrationCredentials()` returns the credentials whichever shape they are
in; `sealIntegrationCredentials()` is the only way to write. Both writers seal,
every reader reads through the accessor.

There is deliberately **no cheap "does this org have a key?" helper** that
answers without decrypting. That shortcut is precisely what the credit gate
used, and a gate that answers differently from the code it gates is the entire
defect. The gate now resolves the credential exactly as the query does, so they
cannot disagree.

**Plaintext wins a conflict, on evidence rather than taste.**
`upsertOrganizationIntegration` replaces `credentials` wholesale, while
save-api-key merged onto whatever was there — so an envelope write erases a
plaintext sibling, and a plaintext sibling can only have been written *after* an
envelope. Both present therefore means the plaintext value is the newer one.
Fields are merged rather than chosen, so anything only the envelope holds
survives; blank plaintext fields are dropped first, so an empty form field
cannot blank a real key.

### What was deliberately NOT swept in

`stripeConnectAccountId` reads in `stripeConnect.ts`, `routes-billing.ts`,
`achMandateSetup.ts` and `customerMoneyRouting.ts` are an **identifier**, not a
secret, and `findOrganizationIntegrationByCredential` looks orgs up by it. Left
exactly as they were. Saying so matters as much as the fix: sweeping them would
have broken a lookup to satisfy a pattern.

Two sites still read the raw shape on purpose and are registered with reasons:
`indexAnalyzer.ts` (round-trips a platform report as plain JSON through the
`encrypted` slot — never a credential), and the two `routes-integrations`
display surfaces, which must distinguish "configured but unreadable" from "not
configured" because the accessor deliberately returns null for both and
reporting "not configured" for a key the org really set would be false.

### Verification

The registry derives the reader set **from source**, because the defect is
invisible file by file — every one of those readers looks correct alone — and a
hand-written list is how the set got out of sync to begin with.

Three mutations, each caught: reintroducing a raw read in an unregistered file;
reverting save-api-key to a plaintext write; reverting the credit gate to
`.encrypted` (caught twice, by two independent assertions).

---

## Unit 41 — The webhooks panel said "Active" for endpoints that could never fire · this commit

**Files:** `server/services/webhookDispatcher.ts`,
`server/routes-integrations.ts`, `client/src/pages/webhooks.tsx`,
`tests/unit/webhookActiveFlag.test.ts` (new, 18 tests).

### Two identifiers, and nothing else wrong

`client/src/pages/webhooks.tsx` wrote `enabled`, rendered its Active/Paused
badge from `enabled`, and toggled `enabled`. `dispatchWebhook` has always
filtered on `isActive`. `saveWebhookEndpoints` persisted whatever the client
sent. So an endpoint added through the panel was stored as
`{ url, events, enabled: true }` — **with no `isActive` at all.**

The entire webhooks feature, as reachable by a customer, delivered nothing:

- every endpoint added through the panel was `isActive: undefined`, filtered out
  of every dispatch, forever;
- the panel read its own field back and displayed **"Active"**;
- the toggle flipped a field nothing read, so pausing and resuming both did
  precisely nothing;
- and nothing errored, because nothing was broken. Two halves of the system
  simply never agreed on the name of the fact.

This is the repo's most common defect class — *built but unwired* — in its least
visible costume. There is no missing wire to grep for: the route is mounted, the
service is called, the row is written, the UI renders. The only evidence is that
two identifiers differ.

**It is also a fabrication.** A badge reading "Active" for an endpoint
structurally incapable of receiving anything is a claim about system state the
system does not have — the same defect as an invented number, and the reason
this ranks above a cosmetic rename.

### Normalised on READ, not only on write

Rows already in the column carry `enabled` and no `isActive`. Fixing only the
writer would leave every existing customer's webhooks silent until somebody
happened to re-save them. `isActive ?? enabled` repairs them in place, on the
next dispatch, with no migration.

**Absent both still means off.** An endpoint nobody ever expressed as active is
not one to start delivering an org's lead and deal events to. A legacy PAUSE is
honoured for the same reason: it was a real intent expressed through the only
field the UI had.

The legacy field is dropped on write and never returned to the client, so the
two names cannot drift apart again.

### The test button was testing the wrong thing

`POST /api/webhooks/test` signed only when the caller passed a secret — and the
client passes only a url, because unit 38 redacted the read. So **every test
event went out unsigned while every real delivery went out signed.** The one
message sent to prove an endpoint works was the one message a
signature-verifying receiver would reject, and the panel reported a correctly
configured endpoint as broken.

A test to a configured endpoint is now signed with that endpoint's own stored
secret, and an unreadable secret refuses rather than downgrading — the same rule
`dispatchWebhook` follows, and the test is the surface where finding out is most
useful. A caller-supplied secret applies only to a url the org has NOT
configured: the button tests the endpoint as configured, not as the request asks.

The rule lives in `resolveTestSigning()` rather than inline in the route, so it
is unit-testable — a source assertion would have been the alternative, and a
source assertion cannot tell you which key was used.

The response now reports `signed`, and the panel says which of the two it did.
Without that, an unsigned test reads as proof that signing works.

### One helper added, deliberately

The refusal is a 422 — the request is perfectly well-formed and simply cannot be
carried out in the system's current state — and the `res-status-raw` ratchet
correctly refused a raw `res.status(422)`. `Errors.validationFailed` was the
wrong fit (it hardcodes "Some fields need a fix:", and no field is wrong) and
`Errors.badRequest` would have said 400, which is not true. So
`Errors.unprocessable` was added: the caller has nothing to correct in what they
sent, something else has to change first. Ratchet back at baseline without
raising it.

### Verification

Four mutations, each caught: dropping the legacy fallback (3 tests fire),
defaulting an unexpressed endpoint to active, letting a caller-supplied secret
beat the stored one, and reverting the client to `enabled`.

The client assertion strips comments before checking, because the interface's
doc comment mentions `enabled` on purpose — with a vacuity guard, since the
assertion would otherwise pass against an empty string.

---

## Unit 42 — Fourteen of fifteen subscriptions could never arrive · this commit

**Files:** `shared/webhooks/catalogue.ts` (new),
`server/services/webhookDispatcher.ts`, `server/routes-integrations.ts`,
`client/src/pages/webhooks.tsx`, `tests/unit/webhookEventCatalogue.test.ts`
(new, 16 tests).

### Found by asking unit 41's question of the next field along

Unit 41 was a name mismatch on the ACTIVE flag. The obvious follow-up was
whether the same payload's other field — the event list — agreed at both ends.
It did not, and then the answer got worse twice.

**First: six of the fifteen events the panel offered did not exist.** The
dispatcher declared a 36-member union; the client had a hand-written 15-event
picker; they overlapped by nine. Ticking `offer.sent`, `offer.accepted`,
`deal.status_changed`, `payment.late`, `property.updated` or `task.created`
stored a string nothing would ever match, and the panel showed it ticked.

Four of the six are **near-miss renames** of real events —
`deal.offer_sent`, `deal.offer_accepted`, `deal.stage_changed`,
`payment.overdue`. That is what let it survive: every name is plausible, the
list looks right, and nothing anywhere compared the two.

**Second, and larger: of the 36 declared events, exactly ONE has a dispatch call
site.** `lead.created`, from `routes-leads.ts`. The dispatcher exports five more
convenience wrappers — `webhookLeadStatusChanged`, `webhookDealCreated`,
`webhookDealStageChanged`, `webhookPaymentReceived`, `webhookCampaignResponse` —
and **none of them is called from anywhere**. So even after unit 41 made
endpoints capable of firing, one of the picker's boxes describes an event that
can actually arrive.

### Not hidden — said

Hiding the thirteen would be the wrong fix: a customer may reasonably subscribe
now to something that ships later, which is exactly what the workflow builder
allows. So the panel **badges** every non-live event, and the catalogue is the
one place both ends read.

The liveness claim is **derived from call sites**, not listed. `CLAUDE.md`
records why: Wave B wired four event lanes and added one to
`shared/workflow-live-triggers.ts`, leaving six genuinely-firing triggers badged
"Not yet live" while every agent reported success. So the test scans `server/`
for both dispatch shapes — the direct `dispatchWebhook(org, 'x', …)` call and
each convenience wrapper AT ITS CALL SITE, never at its definition — and
requires `LIVE_WEBHOOK_EVENTS` to equal the derived set **in both directions**.
Shipping an emitter without updating the catalogue fails; claiming an event is
live without an emitter fails.

### Legacy subscriptions: repaired, dropped, or kept — three different answers

- The four near-miss renames are **normalised on read** (and on write, and on
  the display path, so the panel shows the subscription that will actually be
  matched). That is not rewriting intent; `offer.accepted` and
  `deal.offer_accepted` are the same intent under a name the wire never carried.
- `property.updated` and `task.created` have no counterpart and are **dropped**.
  They were inert from the moment they were stored, and inventing a destination
  would be a guess about what the customer meant.
- An event name this codebase does not recognise at all is **kept**. This
  function repairs names *we* got wrong; something unrecognised is the
  customer's, and quietly deleting a customer's configuration is a worse failure
  than leaving it unmatched.

### The precondition, closed

`PUT /api/webhooks` validated `Array.isArray(endpoints)` and a length cap.
Nothing else. That is the precondition for both unit 41 and unit 42: an opaque
jsonb column will accept any shape, so two ends can disagree indefinitely with
no error anywhere. The route now refuses a genuinely unknown event **by name**,
with the list in the message — accepting a subscription that cannot be delivered
is the silent failure this whole area kept producing.

### Verification

Four mutations, each caught: claiming an event is live with no emitter; shipping
an emitter without listing it (the Wave B direction); putting a phantom event
back in the picker; and hardcoding a second list in the client.

### What this did NOT do — and a claim it nearly shipped

A second, complete webhook system exists (`webhook_subscriptions`,
`publicWebhookDispatcher`, `server/api-v1/*`), and the first draft of blocker B8
described it as a **second live rail**. That was wrong, and this program's own
records caught it: `BLOCKERS.md` B7 had already noted that `registerPublicApiV1`
has zero callers. Checking HEAD confirmed it — the public rail is **entirely
unmounted**, its UI page is not routed in `App.tsx`, and `/api/v1/*` is only a
passthrough alias that rewrites to `/api/*`, so `/api/v1/webhooks` reaches the
LEGACY route.

Which is the expansion ladder working — *no public API before ~50 customers* —
rather than rot. The decision between the rails belongs to the moment that
trigger fires, and it is recorded in **B8**, not taken here.

Worth noting for its own sake: the check that caught the bad claim was **reading
what this program had already written down**, not a fresh investigation. §6a of
NEXT_UP records it alongside the BRRRR correction — one is the rule failing, the
other is the rule working, and both are cheap only if the notes are read.

---

## Unit 43 — A safety kill-switch outside its own column's contract · this commit

**Files:** `shared/schema.ts`, `server/storage/orgRepo.ts`,
`scripts/ratchets/as-any.json`, `tests/unit/orgSettingsMerge.test.ts` (new,
9 tests).

### Two sweeps that failed, and the one hand-check that paid

NEXT_UP pointed at the precondition units 41–42 shared: *client-supplied
structures persisted into opaque jsonb*. Two detectors were built for it and
**both were too noisy to be findings**, which is worth recording as plainly as a
success:

- *Unvalidated jsonb mutations* — 165 hits. The conjunction "handler mentions
  `req.body`" AND "a key matches a jsonb column name" is far too weak; most hits
  were server-constructed audit metadata.
- *Undeclared field accesses on typed jsonb columns* — 235 hits after filtering
  array built-ins. `metadata`, `settings`, `result`, `items` and `checks` are
  among the most common local identifiers in the codebase, so name-collision
  swamps the signal. Precision here needs field-level dataflow, not grep.

An earlier sweep in the same thread returned **zero** and was also wrong: it
looked for client payload keys absent from all server source, and `enabled` — the
unit 41 defect — appears in ~100 server files, just never in the code that reads
that endpoint. **Presence-anywhere is not the test.** All three are recorded in
NEXT_UP so the next session does not rebuild them.

One hit from the second sweep survived a hand-check, and it was worth the two
that did not.

### The finding

`server/utils/simulationMode.ts` calls itself "the single source of truth for no
real-world side effects" and names three layers. The third is
`org.settings.simulationMode`: when true, no mail, SMS, email or webhook leaves
the building for that org.

**It was not declared in `organizations.settings.$type<>`**, and was read as
`(org as any)?.settings?.simulationMode`. So the flag that disarms every
outbound rail sat outside the contract its own column publishes:

1. No typed write composed from that type could carry it.
2. A write that assigned `settings` wholesale rather than spreading would drop
   it — and every gate downstream would then read `false` and start sending for
   real. Nothing errors, nothing logs, and the first symptom is real mail
   arriving from an org that was supposed to be simulated.

### A verified negative, then made enforceable

**Every writer merges today** — checked by hand across `routes-organization`
(which also `.strict()`-parses its patch), `services/onboarding` (seven sites)
and `storage/orgRepo`. So this is a latent gap, not a live defect, and the entry
says so.

What it is NOT is a safe gap to leave unpinned: `settings: { ...x }` and
`settings: { ... }` differ by three characters, the difference is invisible at
every individual call site, and only one of them preserves a safety flag. So the
field is now declared (the cast is gone, `as-any` 1405 → 1404, lowered in the
same commit) and a test derives the write set from source and requires each to
spread.

### The scan states its own blind spot

It classifies inline object literals. A write that passes a precomputed value —
`settings: merged`, which is what the customer-facing PATCH does — cannot be
classified without following dataflow. Those are **collected separately and
registered**, not skipped: an unclassifiable write is not a safe one. The single
registered site has its merge asserted directly, one line from the write.

The first version of the scan also flagged `supportAgent.ts:1517`, which builds
a read-only diagnostics response. The fix was to tighten the scan to model an
actual org write, **not** to weaken the assertion — a checker that reports safe
code as broken is how a safety test gets deleted.

### Verification

Three mutations, each caught: a write that replaces instead of merging; the
settings PATCH dropping its merge; and undeclaring `simulationMode`.

---

## Unit 44 — Adoption reaches a second product surface · this commit

**Files:** `shared/subdivision/lotPricing.ts`, `shared/schema/subdivision.ts`,
`shared/finance/cents.ts`, `server/routes-lot-pricing.ts`,
`migrations/0234_lot_pricing_decision_link.sql`, `scripts/migrate.mjs`,
`tests/unit/lotPricingDecision.test.ts` (new, 16 tests),
`tests/unit/canonicalLoopAdoption.test.ts` (baseline 4 → 5).

### The surface, and why it passes a criterion three candidates failed

`POST /api/parcels/:id/pricing-rules/lock` writes every child lot's
`listPrice` — the asking price the market sees. Verified reachable end to end
before anything was built: the registrar is called at `routes.ts:2281`, the page
is routed at `/lot-pricing`, and it calls the lock endpoint.

The rule, as sharpened by unit 29: **adopt where the reasoning would otherwise
be LOST; never where an equivalent versioned record already owns it.**

`lockedGrid` preserved the OUTPUT — base, premium, asking price, override flag —
and none of the reasoning:

- `rules` and `basePriceSource` live in the **same mutable row the lock
  updates**. Editing the rules tomorrow leaves the grid intact and destroys its
  explanation. That is *historical decisions preserve what was known*, violated
  by construction rather than by oversight: there was nowhere else for them to
  live.
- The derived base-per-acre was never stored at all — you cannot tell whether a
  lock used the parent's AVM or an operator's fixed $/acre.
- No engine version, though the arithmetic sits in a versionable pure module.

**The exact mirror of the note payoff path**, which `MUST_NOT_ADOPT` pins
*because* `note_payoff_quotes` already carries `engine_version` NOT NULL and
verbatim `engine_input_json`. One owns its reasoning and must not gain a second
owner; the other had none.

### What the snapshot freezes

The three things the row cannot keep — base-per-acre (origin `user` for a fixed
$/acre, `derived` for an AVM one, because flattening them would let a platform
figure read back as what the customer believed), the engine version, and the
rule set **verbatim**. Kind `price`, from the closed `DECISION_KINDS` set, which
already read *"set or change an asking/offer price"* — no new kind invented.
Authority names the capability (`org_member:lot_pricing_lock`), never a generic
system actor (BI72).

Operator overrides become real **alternatives**: the rules-derived price
genuinely was on offer, so these are choices not taken rather than the empty
list most decisions honestly carry.

### Ordering, and why it differs from unit 22

Unit 22 records BEFORE its insert because the decision id must be in the INSERT.
Here the link is a follow-up UPDATE, so the decision is recorded **after the
transaction commits**. Recording first would let a failed lock leave an
immutable snapshot asserting a price change that never happened — and a decision
record is not rewritable. **A lock with no snapshot is a gap; a snapshot with no
lock is a lie.** Best-effort, so the operator's pricing never fails because the
reasoning could not be written; a null link says so honestly.

### Two things deliberately NOT done

**No Scenario, and no sixth engine.** A per-lot price grid carries none of the
shared metrics — no `total_cost`, no `profit`, no `cap_rate`. Adding an engine so
this surface could produce a Scenario would move the adoption count without
helping a customer, which is the failure an up-only ratchet invites rather than
prevents. A test asserts the absence.

**No review date.** A review date is what later makes the loop ASK for an
outcome. The first draft of this entry said the blocker was `OUTCOME_KINDS`
being shaped for a single position; re-reading `OutcomePrompt.tsx` immediately
afterwards showed that is imprecise, and the real reason is stronger:
**a decision with no Scenario has nothing for an outcome to be measured
against.** Calibration compares a predicted metric to a realised one, and this
decision predicts none — so even a perfectly-fitting kind would produce a
measurement with no forecast to compare it to.

`OutcomePrompt`'s `ANSWERS` table compounds it: `measures` is keyed to KIND
alone, justified in its own comment by *"both ids are produced by the flip
engine that records these decisions"* — true when the analyzer was the only
recorder, no longer true in general. Nothing is broken today only because this
lock never sets a review date.

So lot pricing is **deliberately decision-only**: the reasoning is preserved and
no calibration is claimed. Corrected in NEXT_UP rather than left standing.

### The mutation that exposed a bad assertion

Six mutations were run and **every one was verified to have actually applied** —
which is the only reason this was caught. Deleting the frozen rule copy left the
test passing: the assertion matched `rules.rules ?? []).map`, and the same text
appears in the grid computation twenty lines earlier, because the handler window
had been sliced to end-of-file. **A window drawn wider than the thing it
inspects** is this program's most repeated self-inflicted defect, and this is the
fifth instance. The assertion now matches the key the frozen copy emits, and the
window ends at the next route registration.

The other five: recording before the transaction; flattening the base origin;
dropping the org scope on the link write; replacing the engine version; and
adding a Scenario (the ratchet-gaming move). A seventh attempt was a bad
mutation, not a passing test — it imported `recordScenario` without calling it.

### Incidental

`formatCents` now has a canonical home in `shared/finance/cents.ts` beside
`dollarsFromCents`. Four other copies exist and **only two are the same
function**: the two `shared/rental/*` ones are byte-identical, but
`wonBidToCertificate.ts` renders negatives as `$-1,234.56` and
`MRRTrajectory.tsx` ABBREVIATES ($1.2M / $3.4K) — a different function wearing
the same name. They were left alone rather than unified blindly; recorded in
NEXT_UP.

---

## Unit 45 — A refusal that unblocks itself · this commit

**Files:** `tests/unit/canonicalLoopAdoption.test.ts` (+3 tests, new
`BLOCKED_ON_A_REAL_LINK` registry).

### The most tempting surface in the repo, checked and refused

NEXT_UP named the deal close as the next adoption candidate. It is better than
it looks and still wrong, and both halves are worth recording.

**Better than it looks:** `PUT /api/deals/:id` transitioning to `closed` writes
`acceptedAmount` — a **realised sale price**, already fed to the valuation
training corpus as arm's-length ground truth. That is precisely the realised
number **unit 27 searched for and did not find**: it looked for
`actualSalePrice` / `realizedProfit` / `actualProfit` across the schema, and the
value is stored under a name that does not say "actual". Unit 27's negative was
about a realised *return* and stands; but a realised *price* does exist, and the
next session should not repeat the search.

**Still wrong:** there is **no link** from the deal to the decision that
produced its offer. `offers` has no `dealId`, `deals` has no `offerId` and no
`decisionSnapshotId`, and **no code path anywhere creates a deal FROM an
offer** — deals are created by the AI tools, the importer and the sample seeder,
independently. The only shared key is `propertyId`.

Matching on `propertyId` is exactly what unit 23 refused when it added a real
`decision_snapshot_id` column instead of pairing offers to decisions by
property. One property carries many offers over time, so the pairing is a guess,
and **a calibration built on mis-matched pairs is worse than one that honestly
reports `unmeasured`.**

### Why this is a test and not a paragraph

A verified negative recorded only in prose decays exactly like an audit claim —
§6a of NEXT_UP exists because this program has already shipped one that HEAD
disproved. So the refusal is asserted, and asserted **inverted**: the test
requires the link to be MISSING.

The day someone adds `deals.decisionSnapshotId` or `offers.dealId`, this test
FAILS, and its message says the surface can now record an outcome against the
decision that produced its offer, and to wire it. **A refusal that cannot notice
its own reason disappearing is just a hardcoded no.**

A second assertion catches the other failure mode, which is not inaction: it
fails if `routes-deals.ts` starts recording a decision or outcome while the link
is still absent — i.e. if someone pairs a deal to a decision through
`propertyId` because both happen to have one.

`BLOCKED_ON_A_REAL_LINK` is deliberately a **different registry** from
`MUST_NOT_ADOPT`. That one says *never — another versioned record already owns
this state*. This one says *not until a real link exists*, and names the exact
column whose arrival ends the block.

### Verification

Two mutations, both caught: adding `deals.decisionSnapshotId` (the refusal
notices the block is over), and wiring a recorder while the link is still
missing (the heuristic-pairing guard).

---

## Unit 46 — The last unenforced permission · this commit

**Files:** `server/utils/leadAssignmentGate.ts` (new),
`server/routes-leads.ts`, `server/routes-bulk.ts`,
`tests/unit/leadAssignmentPermission.test.ts` (new, 11 tests).

### Applied to none, which is the same defect at its limit

`canAssignLeads` is granted to `owner` and `admin` and denied to `member`, `va`
and `viewer`. `client/src/hooks/use-organization.ts` exposes it, so the UI hides
the control. **No server route had ever checked it**, and three paths accepted
an assignee from anyone:

- `POST /api/leads` — `assignedTo` in the create body
- `PUT /api/leads/:id` — `assignedTo` in the update body
- `POST /api/bulk/leads/update` — `updates.assignedTo`, over an id array

Units 30–35 were all *a rule applied to some surfaces and not others*. This is
that at its limit, and **a permission the UI honours while the server ignores it
is worse than no permission at all**: it reads as enforced to everyone who looks
at the product, and the API is open.

### Why assignment is an access-control operation

It decides whose pipeline a lead lands in and who is measured on it — and for a
`va`, or anyone carrying `viewOnlyAssignedLeads`, **who can see it at all**.
Assigning a lead to a restricted user grants them access to it; assigning it
away revokes theirs. It is access control wearing a workflow name, which is
exactly why it was easy to leave ungated.

**`assignedTo: null` counts.** Unassigning is an assignment decision in the
direction that removes access; reading `null` as "not an assignment" would leave
half the operation open. A test pins it.

### Gated by field, and failing closed

Same trade as `ORG_WIDE_SETTINGS`: `PUT /api/leads/:id` carries ordinary member
edits, and refusing the whole request because the payload also contains
`assignedTo` would break real work to close a narrow gap. The refusal fires only
when the request SETS an assignee.

The gate **fails closed** on an unresolvable role — the lesson from unit 32,
whose first draft read a context attached later than the chokepoint, found
`undefined`, and would have passed everything through while looking correct.
That makes a missing `attachPermissionContext()` a new failure mode (it would
refuse an owner too), so a test asserts each gated route attaches one.

### Three assigners deliberately NOT gated

- `services/leadAssigner` — the rules-based auto-assign that runs on create when
  the caller named nobody. It applies the ORG'S OWN rules; denying them the right
  to run would break intake for exactly the roles that need it. The gate sits
  ABOVE it, so a caller who named an assignee is refused and a caller who did not
  still gets the org's rules.
- `services/territoryService` — automation under its own authority. A user
  permission is the wrong instrument.
- `services/importExport` — already behind `canImportData` (unit 35). A second
  gate would be a second owner of the same rule.

Property and deal assignment on the bulk routes are **out of scope, not
overlooked**: there is no declared permission for either, and inventing one here
would be a different change smuggled in.

### Verification

Four mutations, each caught: removing the gate from the bulk path; failing open
instead of closed; treating `assignedTo: null` as not-an-assignment; and
dropping `attachPermissionContext` from the create route.

**Thread A is now complete.** Every declared permission this program found
unenforced is enforced, and each fix ships with a registry that derives its
surface from source.

---

## Unit 47 — An uncapped, undeletable array on the hot read path · this commit

**Files:** `shared/schema.ts`, `server/routes-va-engine.ts`,
`tests/unit/vaWorkflowBounds.test.ts` (new, 10 tests).

### Three things wrong at once, and the third is why it matters

`POST /api/va/workflows` appended a customer-authored workflow to
`organizations.settings.va_workflows`:

1. **No cap.** Every workflow ever created accumulated in one jsonb blob.
2. **No delete and no update.** Create-and-list only, so it could only grow.
3. **On the hot read path.** `getOrCreateOrg` resolves the org through
   `getOrganizationByOwner`, which is `db.select()` with no column list — a
   `SELECT *` on `organizations`. So this array is fetched on **every
   org-scoped request the product makes**, not when someone opens the VA screen.

Any one is survivable. Together, a customer who uses the feature makes every one
of their own requests slower, permanently, with no way to undo it and nothing
reporting it.

The webhook endpoint list, in the neighbouring blob, has capped at 10 since it
was written. **The rule existed and this surface did not apply it** — the shape
units 30–46 kept finding, this time about resource bounds rather than
permissions.

### The cap and the delete shipped together

A cap on a collection that cannot be pruned is not a fix, it is a wall: the org
reaches 50 once and can never create another workflow. That is a **worse**
outcome than the unbounded growth it replaces, and it is the obvious half-fix to
make here — so `DELETE /api/va/workflows/:id` ships in the same change, reports
`notFound` rather than dressing a no-op as a deletion, and preserves the rest of
the settings blob (the invariant unit 43 derives from source).

`va_workflows` is also now declared in the settings `$type<>` — unit 43's
finding on a second field.

### One of four, said out loud

`routes-va-engine.ts` holds **three more** undeclared collections in the same
blob — `va_tasks`, `va_escalations`, `va_scheduled_tasks` — each read through
`(orgRecord as any).settings`, and **NOT fixed here**.

A correction, made while writing this up: they were first recorded as three
identical repetitions of this defect. Mapping each read back to its route showed
otherwise — only `va_escalations` appends (`POST /api/va/escalate`); `va_tasks`
is modified in place and its key is owned by `services/vaManagement.ts`; and
`va_scheduled_tasks` is read-only in this file. **One confirmed unbounded
appender, not three.**

And it needs a DIFFERENT fix from this one, which is why it was not folded in:
`va_escalations` is a **log**, and refusing to record an escalation past a cap
is the wrong bound — you cannot decline to escalate. A log wants retention or
its own table, and choosing between them is a design call rather than a
mechanical repeat. Pasting this unit's cap onto it would be the wrong answer
arrived at quickly.

Shipping one of four is exactly the inconsistency this program has spent units
30–46 fixing, so it is not left implicit: a deliberately **inverted** assertion
pins all three as still-unfixed and **fails the day someone fixes one**, at
which point they extend this file rather than leave a half-true comment. The
same technique as `BLOCKED_ON_A_REAL_LINK` in unit 45.

The reason for stopping at one is context budget, not judgement about the other
three: each needs its own cap, delete path and type declaration, and a
half-finished sweep across four is worse than one complete fix plus an honest,
enforced record of the remainder.

### Verification

Three mutations, each caught: removing the cap, removing the delete route, and
raising the cap to a decorative 100,000.

---

## Unit 48 — A VA asked for help, got "success", and nobody was told · this commit

**Files:** `shared/schema.ts`, `server/routes-va-engine.ts`,
`tests/unit/vaEscalationDelivery.test.ts` (new, 14 tests).

### Three facts, each verified against HEAD before anything was written

`POST /api/va/escalate` — *"escalate task to human supervisor"* — took a
`taskId`, a `reason`, an `urgency` and a `supervisorUserId`, pushed a record
into `organizations.settings.va_escalations`, and returned
`{ success: true, escalation }`. That was the entire route.

1. **Nothing reads the key.** `va_escalations` appears in exactly two places in
   the repository, and both are inside this handler — the read and the write of
   its own read-modify-write. No route, job, service or screen consumes it.
2. **The supervisor was never notified.** `supervisorUserId` was stored and
   otherwise unused. No notification, no task, no alert, no mail.
3. **Nothing calls it.** No caller anywhere in `client/src`.

So the one function of an escalation — reaching a human — did not happen, and
the response said it had. The "recorded as sent but never sent" family the
borrower reminder ladder was rebuilt to remove, on a path where the message is
*someone is stuck and needs help*.

### Finishing the contract the signature already published

The route now raises an in-app notification to the named supervisor. **That is
not a new feature**: the route's own name and its `supervisorUserId` parameter
declare the intent, and not delivering was the defect. In-app only — no email,
no SMS, nothing leaves the building, which a test asserts by naming the rails it
must not reach.

`supervisorUserId` is now **required**. An escalation with no recipient reaches
nobody — the same class of check as the `taskId` and `reason` the route already
demanded. Safe to tighten precisely because nothing calls it.

The recipient is **validated as an org member**. It arrives in the request body
and a notification row is about to be written for it; unchecked, that is a write
into another organization's user's inbox. This defect would have been
*introduced* by the fix, which is why the guard is asserted to run before the
notification rather than merely to exist.

`system_alert`, from the closed `NOTIFICATION_TYPES` set. `task_assigned` would
read to the supervisor as "a task was assigned to you", which is not what
happened, and widening a closed vocabulary for one caller is what makes such a
set stop meaning anything.

`notifiedAt` is written **only after** `createNotification` returns, and the
response reports `notified` from it. A failed delivery is logged and recorded as
undelivered — the reminder ladder's rule, where `sent` is written only alongside
the rail that accepted it.

### The bound unit 47 deliberately did not apply

Unit 47 capped `va_workflows` and explicitly declined to paste that cap onto
this log, on the grounds that refusing to record an escalation is the wrong
bound — you cannot decline to escalate.

That argument turned on the blob being the *only* record. It no longer is: the
escalation is delivered as a notification, so trimming the oldest entries drops
log history rather than the escalation itself. The log is now bounded at 200,
and **the ordering is asserted, not commented** — the retention trim must come
after the delivery, because that is the entire reason it is safe.

A test also pins that nothing outside this handler reads `va_escalations`, with
a message saying to revisit the bound if a reader appears.

### The unit-47 ratchet caught this unit

`vaWorkflowBounds.test.ts` pinned `va_escalations` as a still-unfixed sibling
with an inverted assertion — *fails the day someone fixes one*. It fired on the
first full run after this change, naming the collection and saying to extend the
coverage rather than leave a half-true comment. It came off the list because the
test demanded it, not because anyone remembered.

**That is the mechanism paying for itself one unit after it was written**, and
it is the argument for inverted assertions over prose: a paragraph saying "three
siblings remain" would have quietly become wrong.

### Verification

Five mutations. Four caught immediately; the fifth — moving `notifiedAt` into
the `catch`, so a FAILED delivery records as a successful one — **passed**,
because the assertion only checked that it was set *after* the call, and the
catch block is also after the call. Strengthened to require it inside the `try`
body, then the mutation fails. The mutation was verified to have applied before
that conclusion was drawn, which is the only reason the weak assertion surfaced.

---

## Unit 49 — A create that stored nothing, returning 200 · this commit

**Files:** `server/utils/errors.ts`, `server/routes-elite-features.ts`,
`docs/implementation/BLOCKERS.md` (B9),
`tests/unit/vaTaskPersistence.test.ts` (new, 7 tests).

### Found by pointing unit 48's question at the rest of the blob

Unit 48 asked *"does anything read this back?"* of `va_escalations`. Asking it
of the neighbouring keys found something larger: **the VA task subsystem does
not work end to end**, and two of its routes said otherwise.

`vaManagement.createTask` is a **pure function** — it stamps an id and
timestamps onto its input and returns the object. `POST /api/va/tasks` returned
that object with a 200. Nothing persisted it, and nothing could:
`VA_TASKS_KEY = "va_tasks"` is declared in that module and **never used**, with
a `SOP_LIBRARY_KEY` beside it in the same state. Those two constants are the
persistence layer that was never written.

`PUT /api/va/tasks/:id` was worse in a second way: it took `{ task, updates }`
**from the request body**, merged them in memory, returned the result, and
**ignored `:id` entirely**. The caller supplied the record it was "updating". A
merge function with a URL.

Everything downstream inherits it — `/api/va/metrics` and `/api/va/audit-trail`
compute over an array nothing populates, `/api/va/tasks/:id/verify` can never
find a task, and `GET /api/va/scheduled` reads a key with **exactly one
reference in the entire repository**, that read. No client calls any of them.

### What was fixed, and the line drawn

A caller could not tell a stored record from a fabricated one. That is the
constitution's fabrication rule at the API boundary, and removing it is not a
product decision — so both writes now refuse with **501** and a message naming
what is missing.

`Errors.notImplemented` was added for it. `badRequest` would blame the caller's
input and `serviceUnavailable` would promise it works again later; neither is
true. Same justification as unit 41's `Errors.unprocessable`, and the
`res-status-raw` ratchet stays at baseline rather than being raised.

**Nothing else was touched.** Building persistence means a table, a migration
and a UI; removing the subsystem means deleting six reachable API routes. Both
are founder decisions (**BLOCKERS B9**), and either would discard a refusal
written in the meantime.

The read routes were left alone **deliberately**: `[]` and zeros are accurate
for an empty collection. What is wrong is that the collection can never be
non-empty — the same decision, not a separate defect. Asserting them broken
would be asserting a product opinion.

### The test guards the premise in both directions

It pins the refusals, and it pins **why** they are correct: `VA_TASKS_KEY` used
exactly once (its declaration), `createTask` still reaching no storage, and
`settings.va_tasks` having exactly one writer. Each of those failing means the
subsystem may have grown persistence — at which point the message says to
replace the refusals with the real implementation rather than leave them.

### Verification

Three mutations, each caught: restoring the lying 200; `createTask` beginning to
persist; and a new writer of `settings.va_tasks` appearing.

---

## Unit 50 — Any member could buy ads on AcreOS's own account · this commit

**Files:** `server/routes-elite-features.ts`,
`server/services/metaAdsService.ts`, `server/utils/simulationMode.ts`,
`docs/implementation/BLOCKERS.md` (B11),
`tests/unit/adSpendAuthority.test.ts` (new, 11 tests).

### The finding

`POST /api/meta-ads/campaigns` took `dailyBudgetCents` from the request body and
handed it to a service that POSTs `daily_budget` to `graph.facebook.com` against
**`META_AD_ACCOUNT_ID` with `META_ACCESS_TOKEN`** — one platform ad account for
every organization. Gated by `[isAuthenticated, getOrCreateOrg]` and nothing
else: any member, va or viewer of any org could name their own budget and bill
it to the platform. No cap, no credit deduction, no simulation guard.

**The founder had already ruled on this exact shape, in this file.** Twenty
lines below sits the note recording the 2026-07-29 deletion of the ACTUM ACH
endpoints under *"be the rail, not the provider"* — one platform
`ACTUM_MERCHANT_ID` for all orgs. The ads routes are the same pattern and were
never brought under it. Units 30–46's shape at the highest stakes in the repo,
and the only one denominated in dollars per day.

### Three protections, each for a different failure

- **`requireFounder`** — spending the platform's money is a platform decision,
  and the constitution names it ("spends >$500 are founder-only").
- **A $500/day ceiling in code.** The gate does not make it redundant: the rule
  is *spends over $500 are founder-only*, not *unbounded once a founder is on
  the call*, and a typo in a cents field is three orders of magnitude from its
  intent. Asserted to be checked BEFORE the service call.
- **`ads` as a simulated category**, in the global default set with every other
  spend rail. The guard runs **before `getAdAccountId()`**, which throws when
  the env var is absent — a guard placed after it would never run in exactly
  the environments that most need it, and a test pins the ordering.

A simulated run returns `{ simulated: true, campaignId: null }`. Returning
plausible ids would be the no-fabrication rule broken at the worst place: a
caller could not tell a real campaign from a suppressed one and would poll stats
for an ad that does not exist. The return type is a discriminated union so
callers cannot ignore it.

### Not deleted, and the near-miss that decided it

The ACTUM precedent says deletion is the founder's call (**B11**), and unit 49's
line holds: these routes do something real, so removing them removes capability
rather than a lie.

**A truncated grep nearly buried this.** `grep ... | head -3` returned three
comment matches and no registration, and the first conclusion was "the file is
dead, so this is not live". `routes.ts:2544` calls
`registerEliteFeatureRoutes(app)` — the real answer was below the cut. The
lesson is narrow and worth keeping: **`head` on a reachability check can turn a
live finding into a dismissed one**, and reachability is exactly the question
where a partial answer is worse than none.

### Verification

Five mutations, each caught: dropping the founder gate; removing the cap;
moving the simulation guard after `getAdAccountId()`; dropping `ads` from the
global default set; and fabricating a campaign id on a simulated run.

---

## Unit 51 — A subscription tier could buy past the expansion ladder · this commit

**Files:** `server/middleware/featureGate.ts`, `server/routes.ts`,
`shared/governance/constitution.ts`,
`tests/unit/expansionLadder.test.ts` (new, 10 tests).

### Picked by the technique, not by a scan

The previous unit's write-up concluded that the thing which works on this
codebase is *find a rule the repo has already written down and enumerate the
surfaces it should cover*. `shared/governance/constitution.ts` is that list,
made machine-readable, and it flags its own weakest entries as **`prose-only`**
— recorded, relying on vigilance. There were two. This is one of them.

`expansion.marketplace-25-api-50` — *"no marketplace before ~25 customers, no
public API before ~50"* — carried the note: *"Enforced today by the
marketplace/API surfaces staying feature-flagged off. No automated
customer-count gate. GOVERNANCE DEBT."*

Checked against HEAD, that note was **half true**, and the wrong half mattered.

### The API side was fine; the marketplace side was not

`registerPublicApiV1` has zero callers, so `server/api-v1/*` is unmounted (B8),
and `/api/v1/*` is only a passthrough rewriting to `/api/*`. Genuinely off.

The marketplace was mounted behind `featureGate("feature_marketplace")`, and
`requireFlag` — which `featureGate` aliases — carries two escape hatches:

1. **An enterprise-tier bypass.** Its own comment calls it back-compat for
   legacy reseller / white-label routes. Applied to the marketplace it meant a
   **subscription tier silently overrode a founder decision** — a paid plan
   buying its way past the ladder.
2. **Failing OPEN when the flag store throws** (*"DB unavailable — fail open to
   avoid breaking the app during initial setup"*). Kind for a product flag; for
   an expansion gate it means a transient database error opens the marketplace.

Neither is a bug in `requireFlag`. Both are wrong for a governance gate, which
is the distinction the fix rests on.

### `requireLadderFlag`

Founder bypass **kept** — the founder must be able to look at the surface they
are deciding about, and a test asserts it so a later "tighten everything" pass
does not remove it as though it were the same kind of hole. Tier bypass dropped.
Fails closed.

A contrast guard asserts that ordinary `requireFlag` still HAS its escape
hatches: if it were tightened too, the two gates would be redundant and should
be collapsed rather than maintained as a distinction that no longer exists.

### Inverted, because the threshold is unmeasurable from a test

A test cannot know the customer count, so it cannot assert "25 has not been
reached". It fails the moment either surface is switched on and says to confirm
the threshold, update the registry, and change the assertion **deliberately** —
the `FOUNDER_ROUTE_BASELINE` shape.

The constitution entry moves `prose-only` → `ratchet-test`, and its note now
records what the old one got wrong. **One of the two remaining prose-only
entries is closed**; the other (`ai.pax-stays-ambient`) is enforced indirectly by
the five-door ratchet and needs a different instrument.

### The ratchet asked for a better fix than the one intended

`requireLadderFlag` needed two 404 responses, and `res-status-raw` went 505 →
507. The rule is *fix the occurrence, not the baseline* — so rather than raise
it, `Errors.featureUnavailable` was added and **all three** raw
`res.status(404).json({ message: "Feature not available" })` calls in
`featureGate.ts` were converted, including the two that predate this unit.
Baseline 505 → **504**.

`notFound` was the wrong helper to reuse: *"we couldn't find that Feature — it
may have been deleted, archived, or moved between organizations"* makes three
false suggestions about a route that is simply off. 404 rather than 403 is kept
and predates this work — a feature the caller is not in the cohort for should
not advertise its own existence.

### Two assertions rewritten to the new truth, neither deleted

The conversion broke two tests, and both were right to break:

- `tests/unit/featureGate.test.ts` pinned the exact body
  `{ message: "Feature not available" }` — the only refusal shape in the API
  that did not conform to the documented `{ error, message, statusCode }`
  envelope. The **invariant** it protects (404, `next()` not called) is
  unchanged, so the assertion was rewritten rather than dropped.
- This unit's own "fails CLOSED" check asserted the literal `"404"` in the
  handler, and broke the moment `res.status(404)` became
  `Errors.featureUnavailable`. That is an assertion coupled to *where the number
  is written* rather than to what the code does. It now asserts the refusal, and
  a second test asserts the helper really is a 404 — the property still holds
  end to end, across two checks instead of one.

### Verification

Five mutations, each caught: reverting the marketplace to `featureGate`; making
the ladder gate fail open; reintroducing the enterprise bypass; mounting the
public API v1; and reverting the registry entry to `prose-only`.

---

## Unit 52 — The last prose-only entry, and the AI destination nobody could see · this commit

**Files:** `shared/governance/constitution.ts`,
`tests/unit/paxStaysAmbient.test.ts` (new, 11 tests).

Closes the **second and last** `prose-only` entry in the constitution registry.
`ai.pax-stays-ambient` — *"No new AI destinations — Pax stays ambient fabric
behind the existing doors, never a separate app-within-the-app"* — carried the
note *"Enforced by the five-door ratchet indirectly (no new top-level entry). No
dedicated Pax-surface gate."*

**Indirect** is the whole problem. The five-door ratchet governs what appears in
the NAV. A second AI destination that renders its own page and is reached by a
link, an email redirect or a typed URL — never appearing in the sidebar at all —
passes that ratchet untouched while being exactly the app-within-the-app the
rule forbids.

### The first draft passed, and was wrong twice over

It matched on **path names** and reported "one destination, two aliases folding
into it". Both halves were false. Adding a second detector — the **name of the
component the route renders** — produced the real picture:

| route | renders | verdict |
| --- | --- | --- |
| `/ai` | `PaxPage` | the door |
| `/pax` | `Redirect /ai` | alias |
| `/ai-team` | `Redirect /ai#agents` | alias |
| `/agents` | `Redirect /ai#agents` | alias — *path says nothing about AI* |
| `/command-center` | `Redirect /ai#chat` | alias — *likewise* |
| `/settings/pax` | `PaxControlsPage` | behind the Settings door |
| `/negotiation` | `NegotiationCopilotPage` | **a second destination** |

`/negotiation` is a 607-line AI surface — objection detection, counter-offer
suggestion, strategy recommendation, session workflow — at a **top-level route,
rendering its own page**. It is in no nav module and nothing in the client links
to it, which is precisely why the five-door ratchet never saw it. A path-name
check does not see it either: the path is a business noun, and only the
component name says "Copilot".

### It is not a live violation — and that distinction is the finding

`docs/company/deletion-ledger.md` carries a **KILL** verdict on it ("Duplicate
of the orchestrator, flagged off, no nav"), the orchestrator itself lives on
inside Pax via `routes-core-ai.ts`, and `shared/feature-freeze.ts` hard-denies
the route ahead of every fail-open rule in `resolveRouteEnabled`. So the rule is
upheld **by the freeze, not by absence** — which is a materially different fact
from the one the first draft asserted, and the difference is one `FROZEN_ROUTES`
edit wide. `isRouteEnabled` fails **open** (unseeded flags table → show
everything); the freeze list is checked before that, and is the only thing
standing between this page and any authenticated user typing the URL.

The test now says so: the exemption is **listed rather than inferred** (a filter
would have quietly absorbed a second and third frozen AI page), and unfreezing
`/negotiation` fails here with a message pointing at the ledger's reactivation
criterion. Inverted, like `FOUNDER_ROUTE_BASELINE` — a test cannot know whether
the standalone copilot should come back, but it can make coming back a decision
somebody reads a message about.

`/api/negotiation` is still **mounted** (`routes.ts:1343`, auth + org only) under
a KILL verdict whose client door is frozen. Recorded as **B12**; not touched
here, because unit 49's line holds — the routes do something real, so removing
them removes capability rather than a lie, and that is the founder's call.

### Verification

Seven mutations, each verified to apply before its result was believed, each
caught:

1. `/pax` renders `PaxPage` instead of redirecting → 2 failures.
2. `/ai-team` redirects to `/today` → alias check fails.
3. `"/ai"` removed from `PROTECTED_DOOR_ROUTES` → protected-door check fails.
4. The registry entry flipped back to `prose-only` → 2 failures.
5. `/negotiation` removed from `FROZEN_ROUTES` → 2 failures.
6. `/settings/pax` promoted to `/pax-controls` → 3 failures.
7. `NegotiationCopilotPage` renamed so the component detector stops matching →
   the **vacuity guard** fails.

Mutation 7 is the one worth keeping. The vacuity guard asserts `/negotiation` is
among the routes found, so the component detector cannot be silently neutered:
without it the file would revert to the path-only check that missed the surface,
and would keep passing while doing less.

An earlier attempt at mutation 4 inserted an unused marker into the entry — the
diff was non-empty, so the harness accepted it, and the suite stayed green. That
is a **no-op mutation reported as a survived one**; it was redone as a real
`kind:` flip anchored to the entry. Verifying that a mutation applies is not the
same as verifying it changes the thing under test.

**No `prose-only` entries remain in the registry.** Every founder decision now
has an automated backstop, and the final assertion fails if a new decision is
added without one — which is the moment to write the gate, not later.

`npm run check` EXIT=0 · `tests/unit` 678 files, 8900 passed, 1 skipped.

---

## Unit 53 — Any org could read, mutate and approve any other org's KYC file · this commit

**Files:** `server/services/investorVerification.ts`,
`server/routes-investor-verification.ts`, `server/routes.ts`,
`scripts/ratchets/reachability.json`,
`tests/unit/investorVerificationTenancy.test.ts` (new, 26 tests).

**The highest-severity finding in this program since unit 36.** Source-of-truth
order puts tenant isolation first, ahead of everything else in the queue.

### The tenant key was designed, migrated, indexed — and wired to nothing

`investor_verification_requests` carries `organizationId NOT NULL` with a
foreign key and an org-leading index (`investor_ver_requests_org_status_idx`).
The DB-backing wave that added them also added `listRequestsByOrg`, the one
org-scoped method on the storage seam. **No route called it, and no other
method took an org at all.** Every route-reachable path resolved its subject by
primary key or by investor-profile id:

| endpoint | what any authenticated user of any org could do |
|---|---|
| `GET /verifications/:investorId` | read another org's KYC status |
| `GET /verifications/:id/history` | read its full audit trail, reviewer ids and notes |
| `POST /verifications/:id/documents` | attach a document to its request |
| `PATCH /verifications/:id/submit` | advance its state machine |
| `PATCH /verifications/:id/review` | **approve it** — which writes `isVerified` to that org's investor profile |
| `POST /verifications/:id/accreditation` | write net worth / annual income onto it |

`isAdmin(req)` asks whether the caller is an admin **of their own org**. Role
and tenancy are two questions, and answering one has never answered the other —
an admin is exactly the account that could do the most damage with an unscoped
id.

This is the failure mode `CLAUDE.md` names in as many words — *"an agent reports
success for the part it built, and is blind to the part it didn't"* — and the
same shape as unit 36 (a founder route with no founder guard) and unit 46
(`canAssignLeads` declared for every role, checked by none): **the control
exists and is not applied.**

### The load-bearing check is on CREATE, not on read

`investor_profiles.organizationId` is `NOT NULL UNIQUE` — one profile per org —
so `assertProfileInOrg` is an exact ownership test. Without it, an org could
open a request against someone else's profile and approving it later would write
`isVerified` to that profile. **Scoping only the reads would have moved the leak
to the write rather than closing it.**

Cross-tenant refusals render **404, not 403**. A 403 confirms the record exists;
probing another tenant's ids must be indistinguishable from probing ids that
were never issued.

### The admin queue was answering with a literal

`GET /admin/verifications` returned a hardcoded `{ verifications: [] }` under a
TODO reading *"the service exposes no listAllVerifications() — state lives in an
in-memory per-process store."* **Both halves were stale.** The DB-backing wave
had moved state into the table AND added `listVerifications(orgId)` — the one
org-scoped method — and the note that said otherwise is why the only correct
method stayed dead. An empty array is not an honest answer to "what is waiting
for me to review".

### Two side doors on a gated front door

The deletion ledger's **Marketplace (FREEZE)** row names buyer-network and
investor-verification alongside matchmaking and deal-rooms. Unit 51 moved
`/api/marketplace` to the strict ladder gate; these two were mounted with
`isAuthenticated, getOrCreateOrg` and nothing else. Same verdict, same flag, same
gate now. Neither has a single client caller — but "nothing calls it" is not an
access control.

### The test is two halves because neither is sufficient

**Behaviour**, against an in-memory storage double that filters by org exactly as
the SQL does — this proves the *service* threads `orgId` through every path, and
it cannot see a missing `WHERE`. **Source**, over the Drizzle storage — every
query must carry an `organizationId` predicate, which is where the bug actually
lived. The positive path is asserted first: a scoping bug that refused
*everything* would satisfy every negative test in the file.

### The reachability gate caught something real about itself

`npm run check` failed at `unreached-exports 655 > 654`. The new export was
`class InvestorVerificationService` — and it had been "reached" only by a
**stale comment**. This linter detects references by substring, so
`// TODO(tsc): InvestorVerificationService exposes no listAllVerifications()`
in the routes file counted as a production call site. Deleting the false note
revealed the export.

**Verified rather than assumed:** re-adding that comment with no other change
returns the gate to PASS at 654. So the count moved because a lie was removed,
not because something was built unwired — the deletion-revealed category the
ratchet's own notes already carve out for tables. Allowlisted with that reason;
**the baseline was not raised.**

The wider implication is recorded in NEXT_UP §7: the 654 baseline contains an
unknown number of comment-only "references", and a symbol can be un-hidden by
tidying prose.

### Verification

Eight mutations, each verified to apply, each caught: dropping the
profile-ownership check on create; resolving the review request without the org;
removing the org predicate from `markProfileVerified`, from
`listRequestsByProfile` (single-line **and** multi-line forms); turning the
cross-tenant refusal into a 403; restoring the hardcoded empty admin queue; and
removing the ladder gate from the buyer-network mount.

The multi-line variant is the one worth keeping. The catch-all assertion ("no
storage query resolves a request by id alone") first required `where(eq(`
adjacent and missed a mutation that dropped the predicate across three lines — a
checker that only catches the tidy formatting of a bug. Widened, then re-run to
confirm it now fails.

`npm run check` EXIT=0 · `tests/unit` 679 files, 8926 passed, 1 skipped.

---

## Unit 54 — The tenancy lint had a real rule and one layer · this commit

**Files:** `scripts/check-org-scoped-fetch.mjs`, `scripts/lint-reachability.mjs`,
`scripts/ratchets/reachability.json`,
`tests/unit/orgScopedFetchCoverage.test.ts` (new, 7 tests).

Unit 53 fixed one cross-tenant leak. The question that follows is whether the
repo already had something that should have caught it — and it did.

`scripts/check-org-scoped-fetch.mjs` has run in CI since the Tier 1F conversion,
flagging methods that query a table carrying `organizationId` without any
organization context. It works. It walked **`server/storage.ts` and
`server/storage/*.ts` and nothing else**, so a service that owns its own
persistence never passed under it — and that is exactly where the KYC leak was.

### Not a claim — a check that was run

Pointed at `server/services/**`, the lint flags **all six** of the methods unit
53 fixed:

```
git show HEAD~1:server/services/investorVerification.ts > server/services/_probe.ts
node scripts/check-org-scoped-fetch.mjs
  - _probe.ts — findActiveRequest, getRequest, updateRequest,
                listRequestsByProfile, isProfileVerified, markProfileVerified
```

The current, fixed file appears nowhere in the offender list. The rule was never
missing; it was applied to one layer.

### 136 frozen, as a debt register and not as approval

744 storage+service methods touch an org-scoped table; **556 already carry org
context**, so the service layer is ~81% conformant. The remaining 136 across 43
files are frozen exactly as the storage half landed — *"pre-existing offenders
are frozen below so the lint can land NOW and block regressions."* Converting
136 methods, several on the ACH payment rail, is a refactor with its own risk,
not a safer choice.

The register carries the triage order rather than a promise: **22 of the 43
files are imported by a `routes-*` file** and can therefore take an id straight
from a URL. Those first. The rest are jobs and analytics iterating rows they
already selected with an org filter — and the heuristic cannot tell the two
apart, which is why this is a register and not a verdict.

### The register resurrected a corpse

`npm run check` then failed with `unreached-exports` at **653, baseline 654** —
a *stale-high* baseline, i.e. the gate asking to be lowered.

Lowering it would have been wrong. `lint-reachability.mjs` tokenises identifiers
across every production file, and `scripts/` is a production root. Freezing 136
keys of the form `"server/services/<file>.ts::<method>"` turned this register
into a list of identifiers — and `productEvolutionEngine`, a **module orphan
nothing imports**, whose singleton happens to share its filename, read as
referenced. The count fell because a dead module looked alive.

That linter's own header already documents this trap for itself: *"This file
DOCUMENTS the dead symbols it exists to find … the linter would resurrect
exactly the corpses it names."* There are two such files now, so `SELF` became
`SYMBOL_REGISTERS`. Count back to 654, **baseline untouched**, and the orphan
stays visible.

It is the same mechanism as unit 53's stale TODO, from the other side: **that
one hid a live symbol behind prose; this one hid a dead module behind a debt
register.** Neither is a substring accident to be worked around — a reference
scanner that reads prose as code will keep producing both, and the answer is to
exempt the files whose purpose is to name offenders.

### Verification

Five mutations, each verified to apply, each caught: removing the services
branch from the walk; making the walk non-recursive (three offenders live in
`services/founder-chat/tools`, one in `services/borrower`); a baseline key
naming a nonexistent file; **a genuinely new unscoped service method** — the
end-to-end proof the extension does its job; and removing the register
exemption.

`npm run check` EXIT=0 · `tests/unit` 680 files, 8933 passed, 1 skipped.

---

## Unit 55 — The fabrication gate named the UI and scanned the server · this commit

**Files:** `scripts/check-no-fabrication.mjs`,
`scripts/no-fabrication.allowlist.json`, `shared/governance/constitution.ts`,
`tests/unit/noFabricationScope.test.ts` (new, 11 tests).

Unit 54's question, asked again: *does a gate's declared scope match the harm it
names?* This one answers itself in its own header.

`check-no-fabrication.mjs` enforces the hard-stop *"no invented numbers, fake
activity, or placeholder data presented as real"*, and explains why:

> AcreOS sells truth. A dashboard number, a skip-trace phone, a deal-velocity
> stat … If any of them is `Math.floor(Math.random() * …)`, **we are lying with
> a confident UI.**

It then scanned `server/routes-*.ts`, `server/storage*` and
`server/services/**` and stopped. **The UI it names was outside the walk.** A
component rendering `Math.floor(Math.random() * 40) + 50` as a match score
passed every gate in `npm run check` — a fabrication invented in the rendering
layer never touches a route handler at all.

### What the widening found: nothing bad

Worth stating plainly rather than dressed up. All 16 client hits are legitimate:
12 client-side ids (error reports, optimistic message ids, offline queue keys,
two `crypto.randomUUID` fallbacks), 2 camera-jitter values in the map
flythrough, 1 shadcn skeleton width, and 1 decorative image picker.

The value is not a fix. It is that the **next** one cannot ship silently, and
that the hard-stop's gate now covers the layer its own rationale named.

One entry is a judgement rather than a fact and is annotated as such:
`lib/aerial-images.ts` picks one of 28 curated aerials at random and **has zero
call sites**. As a page background that is decoration. Attached to a specific
parcel it would present a stock photo as that property's imagery — fabrication.
The note is addressed to whoever gives it a call site, and a test pins the
warning so a later tidy-up cannot reduce it to "legitimate use".

### The registry was overstating its own gate

`truth.no-fabrication` carried `kind: "lint"` and a bare pointer at the script —
which reads as full coverage of a hard-stop while the gate saw one layer. Units
51–52 established that this registry is the **checkable form** of the rules; a
pointer that overstates its gate is the registry lying about itself.

The entry now states the scope **and the limit**: `Math.random` is one way to
invent a number and the only one a token scan can see. A hardcoded plausible
constant is invented data that no scan catches — refuse-not-fabricate is still a
judgement a reviewer makes, and the gate narrows where that judgement can be
skipped rather than replacing it.

### Verification

Six mutations, each verified to apply, each caught: dropping `client/src` from
the walk; collecting only `.ts` so no component is seen; removing `client/src`
from the registry note; removing the stated limit; reducing the aerial warning
to "Legitimate use."; and **a new unannotated `Math.random` in a client file**,
shaped as a fake score — the end-to-end proof.

An earlier attempt at the registry mutation deleted the note's first
concatenated line and the suite stayed green: the phrases under test were on
later lines, so the mutation applied without touching the property. Same lesson
as unit 52's — anchor the mutation to the exact text the assertion reads.

`npm run check` EXIT=0 · `tests/unit` 681 files, 8944 passed, 1 skipped.

---

## Unit 56 — Any org could read, and OVERWRITE, any other org's document text · this commit

**Files:** `server/services/documentIntelligence.ts`,
`server/routes-document-intelligence.ts`, `server/routes-micro-features.ts`,
`scripts/check-org-scoped-fetch.mjs`, `scripts/ratchets/as-any.json`,
`tests/unit/documentIntelligenceTenancy.test.ts` (new, 24 tests),
`tests/unit/orgScopedFetchCoverage.test.ts`.

First item off B14's triage list. `documentIntelligence` was picked because it
is **live** — `/api/document-intelligence` is mounted with
`isAuthenticated, getOrCreateOrg`, no flag gate, driven by
`pages/document-intelligence.tsx` — and because `document_analysis` holds the
extracted TEXT of contracts, deeds, title reports and closing statements, plus
the AI-derived parties, amounts, dates and risk flags.

### The split was visible in one screen

Every per-document endpoint resolved its subject by primary key: `/process`,
`/text`, `/key-terms`, `/risks`, `/summary`, `/compare`. In the **same router**,
`getDocumentsByProperty(org.id, …)`, `getDocumentsByDeal(org.id, …)`,
`searchDocuments(org.id, …)` and `uploadDocument(org.id, …)` all passed the org.
The scoping was understood; it just was not applied to the endpoints that take
an id from the URL. Units 30–55's shape, at its most concentrated.

`compareDocumentVersions` is the one worth naming: it resolved **both** ids
bare, so a caller could diff their own document against a foreign one and read
the foreign one's extracted fields out of the diff — and out of the gpt-4o
summary written from it.

### `GET /documents/:id/text` was a WRITE

It forwarded `req.query.fileUrl` into `extractText`, whose `data:text/plain`
branch base64-decodes that value and **stores it as the document's `rawText`**.
A caller could overwrite another org's extracted contract text with content of
their choosing — and `key-terms`, `risks` and `summary` all read `rawText`, so
the poisoning propagates into every later answer about that document.

The parameter is gone rather than validated: the URL comes off the stored row.
Both real callers already passed exactly that value — the HTTP route was
"fetching fileUrl from the document record" according to its own comment, which
it did not do, and `routes-micro-features` quick-capture creates the row with
`fileUrl: dataUrl` and then passed the same `dataUrl` back in. Behaviour-
preserving for both, and the injection has nowhere left to enter.

### A header comment that was false about two of its six endpoints

> W4.1 — every endpoint below that triggers a gpt-4o call now runs the same
> meter stack as chat (ai_requests limit + BYOK threshold) and counts the turn.

`/text` runs OpenAI Vision for OCR and `/compare` writes a gpt-4o difference
summary. **Neither had `...aiMeter` or `countAiTurn`** — unmetered gpt-4o on the
platform account, no turn counted, no pool, which is precisely what that note
was written to end. Both are metered now, and the test asserts the property for
all six rather than trusting the sentence.

Third time this program has found a load-bearing comment stating something
untrue (unit 53's TODO, unit 55's scope claim, this).

### Ratchets moved because occurrences were fixed, not because counts were eased

- `check-org-scoped-fetch` reported **6 stale baseline entries** the moment the
  service was scoped — the register working exactly as designed. Removed in this
  commit; `BASELINE_ENTRIES` 188 → **182**.
- `as-any` went stale-high, 1397 → **1396**. The occurrence was
  `const doc = await documentIntelligenceService.uploadDocument as any;
  // placeholder to get fileUrl` — a method *reference*, cast, assigned, never
  used, directly above the handler that then read the URL from `req.query`
  instead. The cast is what let a placeholder look like code: `uploadDocument as
  any` type-checks, so nothing ever asked why a route was holding an unbound
  method.

### Verification

Eight mutations, each verified to apply, each caught: dropping the org predicate
from `requireDoc`; one write losing its org; `compare` scoping only the first
document; the text route forwarding `req.query.fileUrl` again; the meter coming
off `/compare`; the refusal becoming 403; `extractText` accepting a caller URL
again; and the summary endpoint passing a constant org id instead of the
caller's.

The last is the one worth keeping: an assertion that merely looked for
`organizationId` somewhere in the handler would have passed it. The check is for
`getOrganizationId(req)` — the org must come from the REQUEST.

`npm run check` EXIT=0 · `tests/unit` 682 files, 8968 passed, 1 skipped.

---

## Unit 57 — A client route guard was the only gate on AcreOS's billing console · this commit

**Files:** `server/routes.ts`,
`tests/unit/dunningFounderOnly.test.ts` (new, 6 tests).

`client/src/App.tsx`, above the Dunning Manager page:

> The dunning API is founder-only (`requireFounder` on the whole router, P1-5) —
> a customer reaching this page saw every panel 404 (2026-07-11 sweep). Gate the
> page like its API.

The router was `app.use('/api/dunning', isAuthenticated, dunningRouter)`. **The
claim was false**, and a 2026-07-11 sweep hardened the UI on the strength of it
and moved on. A client route guard is not an access control: with a session
cookie, every endpoint answered.

| endpoint | what any authenticated user could do |
|---|---|
| `GET /summary` | active cases by stage and the **platform's total amount at risk** — AcreOS's own revenue-distress number |
| `GET /cases` | every organization's dunning events |
| `GET /history` | every organization's dunning history |
| `POST /:id/retry` | **charge a Stripe invoice** on any org's case |
| `POST /:id/cancel` | cancel any org's case |
| `POST /:id/resolve` | resolve any org's case |

`getActiveCases` selects from `dunning_events` filtered by status and nothing
else; `retryPayment(eventId)` resolves by primary key and calls Stripe.

### Founder-only, not org-scoped

Dunning chases failed **subscription payments TO AcreOS** — under *"be the rail,
not the provider"*, the one flow AcreOS is a party to. No organization owns this
queue. Org-scoping it would have invented a per-customer view of a platform-level
list; the right gate is the one the comment already claimed, so the fix makes the
sentence true rather than rewriting it.

The test asserts the **pairing** — page gate and API gate together — because the
failure was precisely that one existed and read as evidence for the other. It
also pins `getActiveCases` having no org parameter: not a defect to fix, but the
fact that makes founder-only the right verdict. If dunning ever becomes a
per-customer surface, that assertion fails and asks for the verdict to be
revisited rather than the gate quietly kept.

### Two things checked and found sound

Enumerating the routers mounted with `isAuthenticated` and nothing else (14 of
them) turned up two more candidates, both of which held up:

- **`/api/eval`** guards each handler with `req.isFounder`, and `isAuthenticated`
  itself sets that flag (`clerkAuth.ts:278`) — so the check works without
  `getOrCreateOrg`. It looked broken-closed and is not.
- **`/api/metrics`** returns windowed request/error/cache aggregates: counts,
  status codes and paths, no bodies and no org data. Operational telemetry, not
  a tenant surface.

Recorded because "checked and fine" is worth as much as a finding to the next
session, and both would otherwise be re-investigated.

### Verification

Four mutations, each verified to apply, each caught: removing `requireFounder`
from the mount; downgrading the page to `ProtectedRoute`; making
`requireFounder` depend on `req.organization` (which would break every mount
that omits `getOrCreateOrg`, this one included); and giving `getActiveCases` an
organization parameter.

`npm run check` EXIT=0 · `tests/unit` 683 files, 8974 passed, 1 skipped.

---

## Unit 58 — Two copies of "who is the founder", both missing a third of the answer · this commit

**Files:** `server/routes-beta.ts`, `server/middleware/getOrCreateOrg.ts`,
`scripts/ratchets/colon-any.json`,
`tests/unit/founderGateSingleOwner.test.ts` (new, 8 tests),
`docs/implementation/BLOCKERS.md`.

Unit 57's lesson — *a comment asserting something about a different file is an
unverified cross-reference* — turned into a scan for routers whose header claims
a founder gate. **The scan was mostly noise** (260 comment hits across 177 files;
the narrower router-vs-mount version misresolved 60 imports and produced one
usable hit), and the one hit was worth the whole exercise.

### `routes-beta.ts` had its own founder check

```ts
function isFounder(req: any, res: any, next: any) {
  const founderEmails = (process.env.FOUNDER_EMAILS || "").split(",")…
  if (!user || !founderEmails.includes(user.email?.toLowerCase()))
    return Errors.forbidden(res, "Founder access required");
  next();
}
```

Two divergences, both wrong:

1. **403, not 404.** `routes-admin.ts` states the rule five separate times —
   *"Hide existence of founder-only surfaces from non-founders (404, not 403)"* —
   and `requireFounder` implements it. A 403 reading "Founder access required"
   confirms both that the endpoint exists and that it is a founder surface. Six
   endpoints advertised themselves.
2. **One env var out of three.** Founder identity is `FOUNDER_EMAIL` **or**
   `FOUNDER_EMAILS` **or** `FOUNDER_USER_IDS`. The shim read only the plural, so
   a founder identified by Clerk id — *"identity-stable across email changes"*,
   per that service's own header — was refused by their own admin console.

### The second copy was the one that mattered more

`getOrCreateOrg.ts` defined its own `isFounderEmail`, under a comment claiming it
was *"matching the same logic as server/services/founder.ts"*. It was not — same
omission, no `FOUNDER_USER_IDS` — and this middleware runs ahead of nearly every
org-scoped request, deciding the *"enterprise tier and unlimited access"* the
comment above it describes. **A comment asserting parity with another file is the
same unverified cross-reference as unit 57's**, one level down.

Both now use `services/founder.ts`, which has no imports of its own, so there is
no cycle and nothing to pay on the hot path.

### The assertion had to learn the distinction it describes

The first draft flagged all five remaining `process.env.FOUNDER_EMAIL` reads.
Three were resolving a **recipient** — who to email — in
`routes-founder-intelligence`, `routes-marketplace` and `routes.ts`. A checker
that cannot tell *who may act* from *who to notify* cries wolf, and one that
cries wolf gets deleted. They are listed with reasons, and a second assertion
fails if a listed file stops reading the var — so the classification cannot go
stale unexamined. The check also reads code only: the comment explaining this
rule must not trip it.

### What was found and deliberately NOT fixed

The beta waitlist **does not persist** — `betaProgram.ts` says so itself
(`// ─── In-memory store (replace with DB tables in production) ───`), and there
is no `beta_waitlist` table. `POST /api/beta/waitlist` is unauthenticated,
appends to a module array, and answers with a queue **position** and a referral
code that die at the next deploy; `GET /waitlist/status` is an unauthenticated
email-enumeration probe that is also simply wrong (it calls `getWaitlist()` with
no args, default `limit = 50`, so anyone past position 50 is told `found: false`).

Recorded as **B15**, not fixed here. Three of the four available moves — delete,
501, or DB-back it — change a **public** endpoint that may be wired to a
marketing page outside this repository. That is the founder's call. The fourth,
leaving a public endpoint fabricating queue positions, is the only one that is
definitely wrong, which is why it is written down rather than left to be
re-found.

### Verification

Five mutations, each verified to apply, each caught: a beta admin route losing
its gate; the local shim returning; `getOrCreateOrg` copying the helper again;
`requireFounder` answering 403; and a stale recipient-allowlist entry.

`colon-any` 3014 → **3011**, locked in here. The three came from
`(req: any, res: any, next: any)` — and the erasure was load-bearing: a
middleware typed as `any` need not resemble `RequestHandler`, so nothing
objected when it answered the wrong status code with the wrong identity check.

`npm run check` EXIT=0 · `tests/unit` 684 files, 8982 passed, 1 skipped.

---

## Unit 59 — One router, two gates, and the split ran along the URL parameter · this commit

**Files:** `server/services/dueDiligencePods.ts`,
`server/routes-due-diligence.ts`, `server/routes-ai-operations.ts`,
`scripts/check-org-scoped-fetch.mjs`, `scripts/no-fabrication.allowlist.json`,
`tests/unit/dueDiligenceTenancy.test.ts` (new, 13 tests),
`tests/unit/orgScopedFetchCoverage.test.ts`.

Second item off B14, chosen by unit 56's blast-radius screen: mounted, one
client caller, customer content, and a "read" endpoint that writes.

### The split was inside one file, along the URL parameter

Eleven handlers. Seven carried `isAuthenticated, getOrCreateOrg`. Four carried
`isAuthenticated` and **nothing else**, so `req.organization` was undefined and
they could not have scoped even if they had tried:

| endpoint | what any authenticated user could do |
|---|---|
| `GET /dossier/:id` | read any org's dossier |
| `GET /dossier/:id/summary` | its executive summary |
| `GET /dossier/:id/recommendation` | its go/no-go investment recommendation |
| `POST /:id/run` | **run the research pod on it** |

The line between the groups is which parameter the URL carries: handlers keyed
by `:propertyId` were gated, handlers keyed by a dossier `:id` were not. Nothing
about that distinction is meaningful — both ids come from the caller.

**And the gated seven leaked too.** `researchTitle(propertyId)` and its six
siblings had `getOrCreateOrg` in front of them and did not pass `org.id`; the
service resolved the property by primary key. *Having the org and not using it
is the same defect as not having it, and it is harder to see.*

### This one spends money

Every research method starts at `getPropertyData` and then calls
`dataSourceBroker.lookup(...)` — the provider registry, which deducts credits on
paid lookups. An unscoped property fetch was not only a read of another org's
parcel; it was a **paid lookup performed against it**. `POST /:id/run` fans out
to all seven at once. A test pins the broker call, so the reasoning above cannot
quietly become stale.

### The detail worth reading twice

`researchOwner` scopes its lead join by `property.organizationId` — the org of
the row it just fetched. That reads as careful, and it is what hid the bug:
**deriving the tenant from an unscoped fetch inherits whatever the first query
got wrong**, and the code downstream looks more rigorous than the code upstream.

### A third instance, in a different router, that this unit's test would have missed

`npm run check` failed on a type error in `routes-ai-operations.ts` — a **second
caller** of `getDossier`, serving `GET /api/ai-operations/due-diligence/:id`
through a dynamic import. Same defect: `getOrCreateOrg` present, org not passed.

The first version of `dueDiligenceTenancy.test.ts` read
`routes-due-diligence.ts` alone and would have gone green with that leak still
reachable under another path. It now sweeps **every file under `server/`** for
callers of the service. *Scoping a service is not finished when its own router
is fixed* — and the compiler, not the test, is what caught it, which is worth
recording: the signature change was load-bearing.

### Ratchets

- `check-org-scoped-fetch`: 3 entries went stale (`getDossier`,
  `getPropertyData`, `updateAgentStatus`), removed here. `BASELINE_ENTRIES`
  182 → **179**.
- `no-fabrication`: inserting the error class moved a `Math.random` from line
  110 to 122, and the allowlist is line-anchored. **Re-anchored, not deleted** —
  deleting an entry quietly widens the gate, which NEXT_UP §7 already records.
  The failure surfaced through `noFabricationScope.test.ts`, which shells out to
  the real lint; running the lint by hand piped into `head` reported `EXIT=0`,
  the exact trap §7 warns about.

### Verification

Seven mutations, each verified to apply, each caught: `/dossier/:id` losing
`getOrCreateOrg`; `getPropertyData` losing its predicate; one research endpoint
passing a constant; `runDossierPod`'s select losing the org; the run refusal
reverting to a raw 400 (which would have answered 400 with the words "not found
in this organization"); the provider-broker claim going stale; and the **second
router's caller** losing its org.

The broker mutation needed a second attempt: replacing one of eight occurrences
left the `toContain` satisfied. A no-op mutation reported as a survived one —
the same trap as unit 52's, and the reason every mutation here is checked for
having actually changed the thing under test.

`npm run check` EXIT=0 · `tests/unit` 685 files, 8995 passed, 1 skipped.

---

## Unit 60 — The org accepted at the front door and dropped one call deep · this commit

**Files:** `server/services/cashFlowForecaster.ts`, `server/routes-cash-flow.ts`,
`scripts/check-org-scoped-fetch.mjs`,
`tests/unit/cashFlowTenancy.test.ts` (new, 13 tests),
`tests/unit/orgScopedFetchCoverage.test.ts`.

Third item off B14, and the sharpest form of the shape so far.

### A scoped signature in front of an unscoped body

`generateForecast(organizationId, params)` **takes an organization**. It then
called five internal methods with the id alone:

```
projectNoteIncome(noteId, periodMonths)
analyzePaymentHealth(noteId)
calculatePaymentRiskScore(noteId)
identifyRiskFactors(noteId)
projectExpenses("note", noteId, periodMonths)
```

each resolving `notes` by primary key. `POST /api/cash-flow/forecast` with
**another org's `noteId` in the body** forecast that org's note — payment
history, default probability, risk factors, projected income — through an entry
point whose signature says it is scoped.

Fifteen internal call sites in total dropped the org; the compiler found every
one once the signatures changed.

### The lint structurally cannot see this

`check-org-scoped-fetch` asks whether a method MENTIONS an organization.
`generateForecast` does, so it passed. Its callees did not, and were on the debt
register — where they read as *"known, pre-existing"* rather than *"reachable
from a scoped method with a caller-supplied id"*. The lint's own header note
(added in unit 54: *"passing this lint means a method mentions an org, not that
it is safe"*) now has a concrete instance behind it, and the new test asserts the
property the lint cannot: **no internal call to an id-keyed method may drop the
organization.**

The route half was the familiar split — `/forecast`, `/portfolio/*` and
`/forecast/actual-vs-projected` passed `org.id`; `/notes/:noteId/health`,
`/notes/:noteId/risk-score` and `/forecast/:forecastId/insights` passed the id
alone.

### A checker that truncates its evidence manufactures findings

The repo-wide caller sweep first used `service\.(\w+)\([^;]*?\)` — lazy, so it
stopped at the FIRST closing paren. `analyzePaymentHealth(parseInt(req.params.noteId), getOrganizationId(req))`
was captured as `…(parseInt(req.params.noteId)` and reported as **missing the org
that was right there**. Replaced with a paren-balanced scan.

Worth recording next to unit 50's truncated grep: that one turned a live finding
into a dismissal, this one turned correct code into a finding. Both are the same
error — reading part of the evidence and concluding from it.

### Verification

Five mutations, each verified to apply, each caught — including **the original
defect reintroduced**: `generateForecast` passing `noteId` where the org belongs.
That is the mutation that matters, because it is the bug this unit existed to
fix and the one no existing gate could see.

`check-org-scoped-fetch`: 6 entries went stale, removed here. `BASELINE_ENTRIES`
179 → **173** (188 at the start of B14 triage; three subsystems have now retired
15 between them).

`npm run check` EXIT=0 · `tests/unit` 686 files, 9008 passed, 1 skipped.

---

## Unit 61 — Rule 2: "has an organization and does not use it" · this commit

**Files:** `scripts/check-org-scoped-fetch.mjs`,
`server/services/priceOptimizer.ts`, `server/routes-price-optimizer.ts`,
`tests/unit/orgScopedFetchCoverage.test.ts`.

Four units in a row (56, 59, 60, and the `recordPriceOutcome` fix here) found
the same defect by hand. This makes the gate find it instead.

### The gap rule 1 cannot close

`check-org-scoped-fetch` asks whether a method **mentions** an organization.
That is the right question for a method with no org at all, and blind to the
shape that produced every recent finding: a method that **accepts** an
`organizationId` and resolves an org-scoped table by primary key anyway.
`cashFlowForecaster.generateForecast(organizationId, params)` passed rule 1 while
forecasting another org's note from a `noteId` in the request body.

**Rule 2:** inside a method that has org context, every `where(eq(<table>.id, …))`
on an org-scoped table must also constrain `organizationId`.

64 methods across 32 files. One of them was a live cross-tenant **write** — the
rule found it on its first run, before it had a baseline.

### The one it found: `priceOptimizer.recordPriceOutcome`

`POST /api/price-optimizer/outcome/:id` took a recommendation id from the URL
and set `actualPrice`, `priceAccepted` and `outcomeRecordedAt` on it, unscoped.
Any authenticated user could record outcomes against **any org's price
recommendations** — the input to `analyzeRecommendationAccuracy`. Not a leak, a
**corruption**, and one that surfaces later as a pricing model mis-scoring its
own history.

It then re-read the row and logged the event against
`recommendation.organizationId` — the tenant derived from a bare-id fetch, the
same shape unit 59 found in `researchOwner`. Fixed here, so it never entered the
baseline. Register frozen at **63**.

### The register holds two different things, and says so

Roughly half the entries are `.returning()` followed by
`.where(eq(t.id, inserted.id))` — an id the method just minted, safe, and
textually identical to the dangerous kind. `priceOptimizer`'s three `recommend*`
methods are this kind. The note in the baseline names both categories, because a
triage pass that reads 63 findings and discovers half are noise abandons all 63.
Scoping the safe ones is free and correct — the row was inserted with that org —
so that is the cheapest way to shrink the register toward the entries that
matter.

### Mutation testing the rule caught a hole in the rule

`M1` reintroduced the defect and **the suite stayed green**. The fix had hoisted
the predicate — `const owned = and(eq(id), eq(org))` … `.where(owned)` — and
rule 2 was matching on the text at the `where()`, which is now an identifier.
**Hoisting a predicate evaded the check**, and the fix that had just been written
was in exactly that style.

Rule 2 now resolves single-assignment predicate locals. Deliberately no
reassignment tracking and no scope analysis: a conditionally-built predicate is
out of reach and stays out of reach — the check reports what it can see and never
guesses.

The lesson is about method, not regex: **mutate your own fix, not only the code
you are accusing.** A rule written against a defect you have already fixed will
be shaped by that fix, and will have a blind spot exactly where your style
differs from the original author's.

### Verification

Five mutations, each verified to apply, each caught after the hole was closed:
`recordPriceOutcome` unscoped again (both inline and hoisted forms); rule 2
removed from the scan; a rule-2 baseline entry gone stale; and the two-kinds note
deleted from the register.

`npm run check` EXIT=0 · `tests/unit` 686 files, 9010 passed, 1 skipped.

---

## Unit 62 — Triaging 63 findings down to the three a customer can reach · this commit

**Files:** `server/services/acreOSValuation.ts`, `server/services/landCredit.ts`,
`scripts/check-org-scoped-fetch.mjs`,
`tests/unit/orgScopedFetchCoverage.test.ts`,
`docs/implementation/BLOCKERS.md`.

Unit 61 froze 63 rule-2 entries. **Sixty-three findings is a number people bounce
off**, so before grinding through them subsystem by subsystem they were sorted by
whether the id can actually come from a caller:

| | count |
|---|---|
| reachable with a **caller-supplied id** | 6 |
| **no external caller at all** | 28 |
| called internally with derived ids | 29 |

Three of the six are customer-reachable. All three are resolved here.

### `acreOSValuation.generateValuation` — a safety gate reading a stranger's parcel

It fetched `properties.landStatus` by bare id to run the Indian-Country /
federal-trust check (25 USC §177), so an org could name **another org's
propertyId** and the gate would consult that org's parcel to decide whether to
proceed.

Scoping it is safe *because of how the gate fails*: `assertFeeSimpleOrThrow`
treats a missing row as `landStatus: "unknown"` and **throws**. A foreign id now
yields no row and is refused, rather than valued off someone else's land status.
Checked before changing it — the same predicate on a gate that failed *open*
would have quietly widened it.

### `landCredit.getScoreHistory` — correct, and correct in the wrong place

It fetched the property by bare id and then compared `prop.orgId` to the
caller's, returning `[]` on a mismatch. That is a real check, which is why rule 2
flagging it looked like a false positive. It still read another org's row to
reach its conclusion, and the check sat far enough from the fetch that a later
edit could separate them. The predicate is in the `WHERE` now; the foreign row is
never returned.

### `acquisitionRadar.saveOpportunityScore` — verified safe, left alone

Its flagged predicate is `.where(eq(opportunityScores.id, existing[0].id))`,
where `existing` came from an **org-scoped select two lines above**. Category (b).
Stays in the register, because the check cannot see the difference and the
register is honest about holding both kinds.

### The triage heuristic is wrong in both directions, and that is recorded

It asks whether a route passes `req.params`/`req.body` into the method. That
**over-reports** — it flagged `saveOpportunityScore`, where the caller's data
reaches the method but the flagged predicate does not — and it **under-reports**,
since an id arriving through two hops is invisible to it. BLOCKERS B14 now says
so, and says to re-derive the list after each fix rather than working down a
frozen copy.

The 28 with no external caller are named there as the cheapest remaining win:
scoping a helper nothing outside its service calls is nearly risk-free, and each
one shortens a register whose length is what stops people reading it.

Rule-2 baseline 63 → **61**.

### Verification

Two mutations, each verified to apply, each caught: the AVM parcel fetch
unscoped again, and `landCredit` reverted to the post-fetch comparison.

`npm run check` EXIT=0 · `tests/unit` 686 files, 9010 passed, 1 skipped.

---

## Unit 63 — The outcome of lead #42 was written onto prediction #42 · this commit

**Files:** `server/services/sellerIntentPredictor.ts`,
`server/routes-seller-intent.ts`,
`server/services/negotiationOrchestrator.ts`,
`scripts/check-org-scoped-fetch.mjs`,
`tests/unit/sellerIntentOutcomeIdentity.test.ts` (new, 8 tests),
`tests/unit/orgScopedFetchCoverage.test.ts`.

Closing the caller-supplied-id half of rule 2's register. Unit 62 handled three;
these are the last three, and **the triage had one of them in the wrong bucket.**

### The triage said "founder-only". It was a customer route.

`sellerIntentPredictor.recordOutcome` was filed under the founder plane because
the heuristic matched `.recordOutcome(` in two `/founder/*` route files — which
belong to `trustEnforcementService` and `adaptiveStrategyService`, different
services entirely. Its real caller is `POST /api/seller-intent/:leadId/outcome`,
mounted with `isAuthenticated, getOrCreateOrg`.

B14 already recorded that the heuristic over- and under-reports. This is the
first case where believing it would have left a customer-reachable write open —
so the rule stands: **re-derive, don't work down a frozen copy.**

### Two defects on one line

```ts
// recordOutcome(predictionId, outcome). finalPrice/notes are not accepted…
await sellerIntentPredictorService.recordOutcome(leadId, outcome);
```

1. **Wrong entity.** The route reads `req.params.leadId` and passes it where a
   `predictionId` is expected — under a comment that names the right parameter.
   Two ids of different entities share a numeric space, so nothing threw:
   `seller_intent_predictions` row #42 had its `actualOutcome` and
   `predictionAccurate` overwritten with lead #42's result. That column is the
   model's own accuracy record.
2. **No organization at all**, so the write was cross-tenant.

**They were the same line, and the first had to be settled to fix the second:**
the method could not be scoped without deciding which of the two entities the
caller meant. It takes a `leadId` honestly now and resolves that lead's *latest*
prediction within the caller's org — which answers both.

The agent event recorded `predictionId` bound to the leadId value, so the audit
trail agreed with the bug. Both ids are named explicitly now.

### The other two

`negotiationOrchestrator.recordOutcome` took an `organizationId` **and** a
caller-supplied `threadId` and never checked they belonged together — an outcome
could be filed against another org's thread and its `strategyId` read back.
Scoped.

`autonomousAgentEngine.recordAction` is **verified safe**: its flagged predicate
uses `config.id`, and `config` comes from an org-scoped `getAgentConfig`. Left in
the register, like `saveOpportunityScore`.

### An assertion that a second query satisfied

Mutation M2 stripped the org from the prediction SELECT and **the suite stayed
green**: the assertion read a fixed 1,400-character window that also contained
the UPDATE, whose org predicate satisfied it. Now bounded at the SELECT's own
`.limit(1);`, with the UPDATE asserted separately so neither can stand in for the
other.

Third window-bound defect this session (unit 59's `});`, unit 60's lazy regex,
this). The pattern is the same each time: **a window that reaches past the thing
under test finds the right string in the wrong place.**

Rule-2 baseline 61 → **59**. Every caller-supplied-id entry is now closed; the
remainder are internal helpers and derived ids, recorded in B14.

### Verification

Six mutations, each verified to apply, each caught after the window was
tightened: `recordOutcome` taking a `predictionId` again; the SELECT dropping the
org; the prediction picked arbitrarily rather than latest-first; the route
passing a constant org; and the orchestrator's thread lookup unscoped.

`npm run check` EXIT=0 · `tests/unit` 687 files, 9018 passed, 1 skipped.

---

## Unit 64 — The prompt's header stated a rule the prompt did not implement · this commit

**Files:** `client/src/lib/outcome-measure.ts` (new),
`client/src/components/today/OutcomePrompt.tsx`,
`server/services/decisions/decisionStore.ts`,
`tests/unit/outcomeMeasureIsPredicted.test.ts` (new, 8 tests),
`tests/unit/canonicalLoopAdoption.test.ts`.

Back to Thread B (the canonical loop) after eleven units on tenancy. NEXT_UP's
own §4 recorded this as a known imprecision; checking it against HEAD found it
worse than recorded.

### The claim

`OutcomePrompt.tsx` has said since it shipped that it asks for an amount:

> only for a metric the deciding engine actually **PREDICTED**, so the variance
> it produces is a genuine comparison rather than two unrelated numbers

It did not. The amount was keyed to the **answer kind** — `acquired` →
`total_cost`, `sold` → `profit` — under a comment justifying that with *"both
ids below are produced by the flip engine that records these decisions."* True
when the flip analyzer was the only recorder; false from the moment a second
surface started recording decisions. **Five do.**

Fifth load-bearing false claim this session, and the first inside the mission's
own learning loop rather than beside it.

### What it cost, precisely

The subdivision lot-pricing lock records **no Scenario at all** — deliberately;
a per-lot price grid carries none of the shared metrics and adding an engine so
it could would be gaming the adoption ratchet. Ask that decision *"what did you
actually make?"* and the customer's answer is stored as a real measurement whose
variance comes back `unpredicted`.

**Not corruption.** `buildOutcome` refuses unregistered metrics, and the
variance layer keeps `unmeasured` and `unpredicted` distinct exactly so this
stays legible. The cost is honesty: a number asked for that nothing can be
compared against, then filed as though it could be.

Nothing was broken **today** only because the lock passes `reviewDueAt: null`,
so the prompt has still only ever seen flip decisions. A latent defect waiting on
one field.

### The data was already frozen for this

`decision_snapshots.scenarios` exists, per its own column comment, so that *"a
forecast can never be lost between the engine and the outcome, **which is how a
real prediction came to read as unpredicted**."* Each `FrozenScenarioRef` carries
`predicted: ScenarioMetric[]` — every metric the engine produced.

So the fix reads the frozen snapshot rather than adding anything:
`listDecisionsDueForOutcome` now returns `predictedMetricIds`, and the prompt
offers the amount only when the answer's metric is in that set. A test asserts
the derivation is **not** a live scenario read — re-querying the scenario table
would reintroduce the exact loss the column was created to prevent.

### The rule moved into its own module so it could be tested by calling it

`client/src/lib/outcome-measure.ts`. The alternative was a source scan over a
React component, or a test that re-implements the logic it checks — the
anti-pattern in `investorVerification.test.ts`, which mirrors the state machine
locally and therefore proves nothing about the service.

One assertion is about identity rather than truthiness: `measurableFor` returns
the candidate **unchanged**, so a later refactor cannot pair *"what did you
actually make?"* with `total_cost`.

### An existing assertion was rewritten, not deleted

`canonicalLoopAdoption.test.ts` pinned `if (a.measures) {` under the heading
*"an answer with nothing to measure still submits in one click"*. The invariant
is unchanged and now covers **more** cases — a decision with no Scenario submits
in one click too — so the assertion moved to the new condition with a note
saying why. `CLAUDE.md`'s rule: when a wave makes a stubbed thing real, rewrite
the assertion to the new truth.

### Verification

Five mutations, each verified to apply, each caught: the rule not checking what
was predicted; the rule rebuilding the measure (copy/metric drift); the prompt
reverting to kind-keyed gating; `predictedMetricIds` no longer derived from the
snapshot; and duplicates across scenarios not collapsed.

`npm run check` EXIT=0 · `tests/unit` 688 files, 9026 passed, 1 skipped.

---

## Unit 65 — A deletion-ledger verdict is a founder decision, so it takes the strict gate · this commit

**Files:** `server/routes.ts`,
`tests/unit/frozenSurfaceGates.test.ts` (new, 11 tests),
`docs/implementation/BLOCKERS.md`.

Closes **B13**, recorded in unit 53 and deliberately deferred so that commit
stayed one subsystem.

FREEZE and KILL verdicts are founder rulings — *"reactivate at G2's liquidity
proof"*, *"reactivate when note securitization is a real revenue line (H4)"*,
*"education revenue stays dead"* — and three of them were still gated by
`featureGate`, which carries an **enterprise-tier bypass** (a subscription tier
overriding a founder decision) and **fails OPEN on a flag-store error** (a
database blip reactivating a frozen surface).

`/api/capital-markets`, `/api/certification` and `/api/deal-rooms` now take
`requireLadderFlag`, joining `/api/marketplace` (unit 51) and its two satellites
(unit 53). Six mounts, one gate.

### The exception is the point

**`/api/white-label` keeps `featureGate`, deliberately.** That bypass exists,
per `featureGate`'s own header, *"for legacy reseller / white-label routes that …
are part of the enterprise contract"*, and the ledger's reactivation criterion
for white-label is *"the first enterprise/white-label contract"*. **The bypass is
that criterion, encoded.**

So the test asserts the exception as loudly as the rule, and the *reason* is
written at the mount — not only in the test. A test explaining an exception the
code does not is a test nobody finds while standing in `routes.ts` about to fix
the inconsistency. This is the mirror of the founder-bypass note inside
`requireLadderFlag`, which exists so a "tighten everything" pass does not read a
deliberate keep as an oversight.

A third assertion pins `featureGate`'s own justification: if it stops describing
the bypass as back-compat for reseller / white-label routes, the exception has
lost its anchor and should be re-argued rather than maintained.

### Verification

Five mutations, each verified to apply, each caught: capital-markets and
certification back on `featureGate`; white-label "tightened" for consistency; the
white-label explanation deleted; and the strict gate growing an enterprise
bypass.

The explanation mutation needed a second attempt — removing the block's first
line left "deliberate" and "enterprise" in the remaining prose, so the assertion
held, correctly. Removing the whole block failed it. A partial mutation of a
multi-line claim tests nothing.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9037 passed, 1 skipped.

---

## Unit 66 — An absolute rule enforced by a sample of three files, one of which was deleted · this commit

**Files:** `tests/unit/accessibility.test.ts`.

`CLAUDE.md` states it without qualification: *"Every icon-only button must have
`aria-label`."* What enforced it:

```ts
it("icon buttons have aria-labels (sample check)", () => {
  const files = [
    "components/pax-copilot-rail.tsx",
    "components/floating-assistant.tsx",
    "pages/founder-dashboard.tsx",
  ];
  for (const file of files) {
    try {
      const iconButtons = content.match(/size="icon"/g) || [];
      const ariaLabels  = content.match(/aria-label="/g) || [];
      expect(ariaLabels.length).toBeGreaterThanOrEqual(iconButtons.length);
    } catch { /* File may not exist in test environment */ }
  }
});
```

Weak in three separate ways:

1. **One of the three no longer exists.** `pages/founder-dashboard.tsx` is the
   monolith `CLAUDE.md` records as fully deleted. The `catch` swallowed the
   ENOENT, so a third of the sample had been checking nothing for as long as the
   file has been gone — and reporting success for it.
2. **It compared counts.** Five icon buttons and five `aria-label`s on five
   *other* elements passed.
3. **Three files out of 728.**

### The measurement first, and it is good news

**207 icon buttons across 728 files, and every one is labelled.** The rule has
been followed throughout. No code needed fixing, and saying so plainly is better
than manufacturing a change: what was broken is the *gate*, so nothing would
have noticed the first button that was not labelled.

### `asChild` is handled, not exempted

Two of the 207 have no label on the `<Button>` itself, and both are correct:
`<Button asChild size="icon">` renders **as** its child, so the accessible name
belongs on the `<Link>` inside — which is where `activity-content.tsx` and
`TasksDueWidget.tsx` put it. A checker that flagged those would report the right
pattern as a violation; one that skipped `asChild` would stop looking exactly
where the name lives. The check follows to the child.

### An assertion that could never pass

A second test was written here — *"this file no longer NAMES
founder-dashboard.tsx"* — and deleted: the regex testing for the string
contained the string, so it matched its own source. Same family as
`lint-reachability`'s `SELF` exemption, where a file documenting dead symbols
resurrects them. **A check whose subject includes the check is not a check.**

What replaced it is stronger: the walk covers all 728 files, so there is no
hardcoded list left to rot, and its vacuity guard (`checked > 150`) is what
notices if the walk stops finding anything — the exact failure the old sample
suffered silently.

### Verification

Three mutations, each verified to apply, each caught: a real icon button losing
its label; an `asChild` **child** losing its label; and the walk finding nothing.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9038 passed, 1 skipped.

---

## Unit 67 — Security tests that passed when the security did nothing · this commit

**Files:** `tests/unit/securityMiddleware.test.ts`.

Unit 66 found a test reporting success for a file that no longer existed, so the
class was enumerated: **catch blocks in `tests/**` that contain no `expect`, no
`throw` and no `fail`.** Thirteen, across 696 test files.

Ten are legitimate — error capture before asserting on the error
(`abilityToRepayGate`, `aiCostRates`), drizzle mock plumbing (`byok`,
`etlOrchestrator`, `financial-ledger`, `unitEconomicsFromLedger`,
`reconciliationLedgerDivergence`), a directory walk skipping unreadable dirs, and
a schema-drift allowlist that degrades to *empty* on a parse error, which fails
**stricter** rather than looser.

**Three were in `securityMiddleware.test.ts`, and they were the worst kind.**

### What they asserted

Each imported its middleware inside a `try`, fell back to `null`, and then — if
null — asserted `fs.existsSync("server/middleware/csrf.ts")` and returned. A
relative path resolved against the runner's CWD, and "the file exists" is not a
security property.

**The serious half is that the real assertions accepted the failure:**

| test | assertion | what it accepted |
|---|---|---|
| "CSRF protection blocks requests without token" | `expect([200, 403]).toContain(status)` | **200 — CSRF did not block** |
| "prompt injection middleware sanitizes malicious input" | `expect([200, 400, 403]).toContain(status)` | any status; the middleware never changes it |

The prompt-injection middleware **never blocks** — it rewrites the listed body
fields and calls `next()`. Its observable property is the **body**, which a
status-only assertion cannot see. A no-op middleware passed both tests.

A test named for a security control that passes when the control does nothing is
worse than no test, because it reports coverage.

### What they assert now

Both modules exist and have precise behaviour, so the imports are plain and
static — if a module disappears this file fails to load, which is the correct
outcome and exactly what the `try` was suppressing.

- prompt injection: the phrase is **redacted** (`[content removed by safety
  filter]`) and the original does not survive — **and** ordinary text is left
  byte-identical, so a filter that redacted everything fails.
- CSRF: no token → **403**; matching cookie+header → **200**; **mismatched pair →
  403** (double-submit is worthless if the two sides are not compared); a safe
  method → 200 **and issues the cookie**; an exempt webhook path → 200, with
  `isCsrfExemptPath` asserted directly rather than "verified by convention".

Each negative has its positive beside it. A middleware that refused everything
would satisfy "blocks without a token" and break every write in the product.

### Verification

Five mutations, each verified to apply, each caught: CSRF made a no-op (the exact
shape the old test accepted — **2 failures**); CSRF checking presence but not
equality; CSRF refusing exempt paths; the injection filter not redacting; and the
filter redacting everything.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9042 passed, 1 skipped.

---

## Unit 68 — The third accessibility rule, and the checker that manufactured 75 findings · this commit

**Files:** `tests/unit/accessibility.test.ts`,
`client/src/components/parcels/arv-calculator.tsx`.

`CLAUDE.md` states three accessibility rules absolutely. Unit 66 gave the first
one a real gate. This is the third: *"Every form input must have an associated
label."*

**The word doing the work is "associated."** The common failure is not a missing
label — it is a visible one that is not connected:

```tsx
<Label className="text-xs">Subject sqft</Label>
<Input type="number" value={subjectSqft} />
```

Sighted users see a label. A screen reader announces the input with **no
accessible name at all**.

### The first measurement was wrong, and how it was caught

A naive scan reported **191 violations**. Sampling one before believing it found
shadcn `<FormField>` forms: `<FormControl>` is a Radix `Slot` that injects
`id={formItemId}` into its child, and `<FormLabel>` emits the matching `htmlFor`
— **the association is generated at runtime and never appears in the JSX.**

75 of the 191 were that. The real number is **116**.

> A checker that does not know the framework's own labelling mechanism
> manufactures three-quarters of its findings — and a register nobody trusts
> gets deleted rather than worked through.

Recorded next to unit 62's triage heuristic (over- and under-reported) and unit
60's truncating matcher. Same failure, third form: **read a sample before
believing a count.**

### The codebase comes out well

723 `Input`/`Textarea` elements; **607 are correctly named** — 458 by `id` + a
matching `htmlFor`, 74 by `aria-label`, 75 inside `<FormControl>`. Zero have an
`id` with no matching `htmlFor`, so nobody half-applied it. The rule is
understood and was followed 84% of the time.

### What landed

- `components/parcels/arv-calculator.tsx` fixed completely as the worked example
  — 9 pairs, `useId()` prefix so two calculators on one page cannot collide.
- The remaining **107 across 44 files** frozen as a **per-file, down-only
  register**, so a fix is attributable and a regression cannot hide behind a fix
  elsewhere.
- The register is enforced in **both** directions: a count above its entry fails
  ("a new unlabelled input"), and a count *below* it fails too ("lower it in the
  commit that fixed the file"), so it cannot drift into fiction.

Rule 2 of the three — *every interactive element must have visible focus state*
— is handled globally by `*:focus-visible` in `index.css` and is a different
shape (the risk is a component removing it, not omitting it). Not covered here;
recorded in NEXT_UP rather than half-built.

### Verification

Four mutations, each verified to apply, each caught: a new unlabelled input; a
**stale register entry** claiming debt that is fixed; the `FormControl` exemption
dropped (which reproduces the 191-findings state); and the walk finding nothing.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9043 passed, 1 skipped.

---

## Unit 69 — Working the label register down, and a mislabel caught by re-measuring · this commit

**Files:** `client/src/pages/leases.tsx`, `client/src/pages/contractors.tsx`,
`client/src/pages/command-center.tsx`, `tests/unit/accessibility.test.ts`.

Unit 68 landed the gate at **107**. This works the top of the register:

| file | fixed | how |
|---|---|---|
| `pages/leases.tsx` | 7 | `htmlFor`/`id` pairs, literal ids — the file already used that convention in two places |
| `pages/contractors.tsx` | 5 | same |
| `pages/command-center.tsx` | 6 | `aria-label` — these six have **no visible label at all**, so there is nothing to pair to |

**107 → 89**, 44 files → 41.

### The convention follows the file, not a preference

`arv-calculator.tsx` (unit 68) got a `useId()` prefix because it renders a
repeating comps list and could appear twice on a page. `leases.tsx` and
`contractors.tsx` got literal ids, matching the `htmlFor="lease-unit-label"`
already in `leases.tsx`. Introducing a second convention inside a file is how a
codebase ends up with two ways to do one thing and no reason recorded for either.

### A mislabel, caught by re-measuring rather than by reading

Two dialogs in `command-center.tsx` have byte-identical `<Textarea>` markup —
"Run Due Diligence" and "Get Price Recommendation", both `placeholder="Enter
property ID…"`. A string replacement aimed at the second landed on the first, so
after the pass the **pricing** dialog carried
`aria-label="Property ID for due-diligence analysis"` and the due-diligence
dialog carried nothing.

The count caught it: 11 fixes applied, register moved 10. Re-running the
measurement after the edit — not re-reading the diff — is what surfaced it.

**A wrong accessible name is worse than none.** A screen-reader user in the
pricing dialog would have been told they were running due diligence. Both now
name their own dialog.

### Verification

Two mutations, each verified to apply, each caught: a fixed file regressing
(`lease-rent` losing its pair), and an `aria-label` removed from a labelled
textarea.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9043 passed, 1 skipped.

---

## Unit 70 — Sixteen more labels, and a re-anchor that clobbered its neighbour · this commit

**Files:** `client/src/components/workflow-builder.tsx`,
`client/src/pages/lot-pricing.tsx`, `client/src/pages/tenants.tsx`,
`scripts/no-fabrication.allowlist.json`, `tests/unit/accessibility.test.ts`.

Register **89 → 73**, 41 files → 38.

| file | fixed | shape |
|---|---|---|
| `components/workflow-builder.tsx` | 6 | 2 `aria-label` on condition rows (no visible label, repeated per index), 2 on the dynamic action-config fields (`aria-label={field.label}` — the label is data), 2 `htmlFor`/`id` pairs |
| `pages/lot-pricing.tsx` | 5 | 2 literal pairs, 3 indexed (`lot-rule-${idx}-…`) inside the rules map |
| `pages/tenants.tsx` | 5 | literal pairs |

`workflow-builder` is worth noting: it **already used** `htmlFor={\`input-email-to-${action.id}\`}` for its email/task action fields. The six unlabelled ones were the
condition rows and the generic config renderer — the parts added later, by the
same shape this program keeps finding: a convention applied where someone was
looking and not where they were not.

### The re-anchor clobbered its neighbour

Inserting `aria-label` lines moved a `Math.random` in `workflow-builder.tsx` from
866 to 868, and the no-fabrication allowlist is line-anchored. Re-anchoring is
the rule (unit 59) — but the script matched **by file** and set *both* of that
file's entries to 868, including the one at line 103 that had not moved. The
gate immediately failed on line 103 as a new unallowlisted hit.

Fixed by matching on the entry's **note** rather than its file, so each anchor
follows its own occurrence. Small, and worth recording: **a bulk re-anchor keyed
on the file is a bulk overwrite** when a file has more than one entry — and this
one does, which is exactly why the allowlist stores a line at all.

### Verification

The three files are individually re-scanned to zero, and the register is
regenerated from the code rather than hand-edited — so a fix that did not
actually land cannot be recorded as one. The gate's own both-directions check
(unit 68) then requires the lowered entries to match reality.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9043 passed, 1 skipped.

---

## Unit 71 — Sixteen more, and a component that now REQUIRES its label · this commit

**Files:** `client/src/components/note-assignments-card.tsx`,
`client/src/components/parcels/subdivision-tab.tsx`,
`client/src/pages/rehab-detail.tsx`,
`client/src/pages/reseller-dashboard.tsx`,
`tests/unit/accessibility.test.ts`.

Register **73 → 57**, 38 files → 34. Four files, four different correct answers —
which is the argument against a codemod for this.

| file | shape |
|---|---|
| `note-assignments-card` | one `<Label>` over a **four-field address group**. Pairing it to the street line and leaving city/state/ZIP bare would satisfy a naive checker and still leave three fields unnamed — so each gets its own `aria-label`. |
| `subdivision-tab` | three indexed pairs inside the draft-lots map, one `aria-label` on a bare plan-name field |
| `rehab-detail` | see below |
| `reseller-dashboard` | two `htmlFor`/`id` pairs; two `aria-label`s on the hex field beside each colour swatch, where the swatch is the labelled control and the text field is its twin |

### `CellInput` now requires a label

`rehab-detail.tsx` renders budget / committed / spent as an editable table cell
through a shared `CellInput`. The fix is not an `aria-label` on the component —
that would name all three columns identically. The prop is **required, not
optional**:

```tsx
label: string;  // required, not optional
```

so the type system asks the question at every call site, and each answers with
its own row and column: `Budget for ${it.scope}`, `Committed for ${it.scope}`,
`Spent on ${it.scope}`.

A bare number in a table cell is where an accessible name matters most — "1,250"
announced with no context tells a screen-reader user nothing about which line
item or which column. An optional prop would have made this a lint finding
forever; a required one makes it impossible to add a fourth column without
answering.

### Verification

Each file is individually re-scanned to zero, and the register is regenerated
from the code rather than hand-edited. The gate's both-directions check requires
the lowered entries to match reality, so a fix recorded but not made fails.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9043 passed, 1 skipped.

---

## Unit 72 — Twenty-four more, and the shapes stop being new · this commit

**Files:** `client/src/components/ab-tests-content.tsx`,
`client/src/components/rehabs/draws-section.tsx`,
`client/src/components/settings/autonomy-panel.tsx`,
`client/src/components/template-editor.tsx`,
`client/src/pages/county-detail.tsx`,
`client/src/pages/inspection-detail.tsx`,
`client/src/pages/maintenance.tsx`,
`client/src/pages/tax-optimizer.tsx`,
`tests/unit/accessibility.test.ts`.

Register **57 → 33**, 34 files → 26. Eight files, three each.

By this batch the shapes have stopped being new, and that is the useful
observation — the work is now mechanical because the *decision* in each case is
one of four already-established answers:

1. **A visible `<Label>` beside one field** → `htmlFor`/`id`, literal ids.
2. **The same inside a `.map()`** → indexed ids (`deficiency-${idx}-amount`,
   `variant-${index}-subject`, `tpl-field-${index}-name`).
3. **No visible label, one field** → `aria-label`.
4. **No visible label, a ROW of fields sharing a heading** → `aria-label` each,
   naming the row: `Inspection date for draw ${d.sequence}`,
   `Clerk contact phone`.

Case 4 keeps being the one a naive fix gets wrong. `county-detail`'s clerk
contact is three bare inputs under a `<p>Clerk contact</p>` — pairing the
paragraph to the first and leaving phone and email bare passes a per-element
checker while leaving two fields unnamed.

### What is left

33 across 26 files: mostly one or two apiece, and the last of them are single
inputs in panels and mobile views. No new decision types are expected — the four
above cover every remaining site inspected so far.

### Verification

Every file individually re-scanned to zero; the register regenerated from the
code, never hand-edited. `tsc` clean, so the indexed template literals all
resolve against a real `idx`/`index` in scope — the one way this batch could
have gone silently wrong.

`npm run check` EXIT=0 · `tests/unit` 689 files, 9043 passed, 1 skipped.

---

## Unit 73 — Fourteen inputs the framework was labelling, onto a div · this commit

**Files:** `client/src/components/deal-calculator.tsx`,
`client/src/pages/deals.tsx`, `client/src/pages/finance.tsx`,
`client/src/pages/listings.tsx`, plus seven files finishing unit 72's tier,
`tests/unit/accessibility.test.ts`.

Found while clearing the last of the label register: `pages/deals.tsx` looked
like a false positive — the input **is** inside `<FormControl>` — and it was not.

### `<FormControl>` is a Radix `Slot`

It forwards `id={formItemId}`, `aria-describedby` and `aria-invalid` to its
**immediate child**, and `<FormLabel>` emits the matching `htmlFor`. So:

```tsx
<FormControl>
  <div className="relative">
    <DollarSign … />
    <Input {...field} />     ← gets NO id
  </div>
</FormControl>
```

The `id` lands on the `<div>`. The label's `htmlFor` points at that `<div>`. The
input has no accessible name — in a form that uses the framework's own
primitives correctly everywhere else, which is why it is invisible on review.

**14 sites across 4 files**, all of them a currency or icon wrapper. Fixed by
moving `<FormControl>` inside the wrapper so it wraps the control directly;
renders identically, because a Slot renders **as** its child either way.

### My own gate had exempted all fourteen

Unit 68's label check exempts anything inside `<FormControl>`, on the correct
general ground that the framework names it. All 14 passed under that exemption.

> **A gate's exemption is an assumption, and this one needed its own check.**

Same lesson as the rule-2 register that could not tell a caller-supplied id from
a freshly inserted one — arriving from the other side. There the exemption was
missing and the register carried noise; here the exemption was present and the
register was missing real findings. Both are the checker's model of the code
being wrong, and only a sample tells you which way.

### Also in this commit

The remaining two-per-file label sites (7 files, 14 fixes) — search boxes,
message composers, a merge-field map, partner rows. Register **33 → 18**.

And the register caught me: I fixed those seven and ran the suite before
lowering the entries, and the both-directions check failed with *"now 0, entry
says 2"*. The half of the ratchet that most registers omit is the half that
fired.

### On tooling

`prettier --write` was tried to repair indentation after the hoist and reverted:
it reformatted 366 lines of a file where 24 had changed. The repo does not run
it over these files, so it is not a formatter here — it is a 350-line unrelated
diff. Indentation was fixed with a targeted pass instead.

### Verification

Three mutations on the new gate, each verified to apply, each caught:
`FormControl` wrapping a div again; the controls list emptied (so every wrapper
is flagged — the noise direction); and the scan's subject removed (the vacuity
direction).

`npm run check` EXIT=0 · `tests/unit` 689 files, 9044 passed, 1 skipped.

---

## Unit 74 — The label register reaches zero, and becomes an absolute · this commit

**Files:** 17 client files (one input each), `tests/unit/accessibility.test.ts`.

Register **18 → 0**. `LABEL_DEBT` is now an empty map, and the check is an
absolute like the icon-button one beside it — 116 unlabelled inputs at unit 68,
none now.

The seventeen were the long tail: search boxes, message composers, note drafts,
a project-name field, an inline editable amount. All took `aria-label`, because
none has a visible label to pair to.

### The one that is exempt, and why it is COUNTED rather than skipped

`components/ui/sidebar.tsx`'s `SidebarInput` spreads `{...props}` — it renders
whatever the caller passes, including the accessible name. An `aria-label` there
would name every instance identically and silently override the call site.

The exemption is scoped to `components/ui/**` **and** requires a prop spread. But
two mutations that widened it — dropping the directory scope, dropping the
prop-spread requirement — **survived**, so the assertion now pins exactly what
the exemption skips:

```
).toBe("components/ui/sidebar.tsx:328");
```

**Why those mutations survived is the honest part.** Checked rather than assumed:
`<Input` appears in `components/ui/` exactly once, and **zero** non-ui inputs sit
within 400 characters of a `{...props}`. So both widened rules open a door
nothing currently walks through — they are inert *today*, not undetected.

That is a fourth kind of no-op mutation, distinct from the three this session
already recorded (an inserted marker, a partial string replace, a partial comment
deletion): **an empty input space.** The mutation applies, the diff is real, the
logic genuinely changes — and nothing in the repo exercises the changed branch.
The count assertion is the strongest behavioural check available: it fails the
moment the widened exemption starts skipping something real.

### A wrong field name, caught by tsc

`aria-label={\`Notes for ${item.label ?? item.id}\`}` — `ChecklistItem` has
`name`, not `label`. The `?? item.id` fallback made it *look* defensive while
being a type error. Corrected to `item.name`. Worth noting because 17 files were
edited mechanically and this is the one thing that went wrong; the compiler
caught it, not review.

### Verification

Two mutations, each verified to apply, each caught: a labelled input regressing
in two different files (zero tolerance now — no register to absorb it).

`npm run check` EXIT=0 · `tests/unit` 689 files, 9044 passed, 1 skipped.

---

## Units 75–78 — four founder decisions, executed · `f4270b0` `6d61ac3` `05f2518` `c53d082`

The founder answered four of the six open blockers in one sitting. These four
units execute those answers. What makes them worth reading together is that
**every one of them found something the blocker had not recorded** — the blockers
were written from a correct reading of the code, and each was still incomplete.

### Unit 75 — B15: the beta waitlist, deleted

`POST /api/beta/waitlist` was public and unauthenticated, appended to a
module-level array — no table, no migration — and answered with a queue position
and a referral code. Both died at the next deploy and were split across machines
before that.

**What the blocker had not settled: how much goes.** It framed the question as
the public half. But the six founder-gated admin endpoints read ONLY what that
public POST wrote, so deleting the writer would have left a console over a
permanently empty set. The whole rail went, plus `compass_pm`'s `betaProgram` /
`/api/beta` ownership entries (the `transactionFeeService` precedent).

`GET /waitlist/status` is worth naming separately: it answered whether an
arbitrary email address was on the list — an enumeration oracle — and called
`getWaitlist()` with no arguments, whose default is `limit = 50`, so anyone past
position 50 was told `found: false` even within a single process. It was wrong
before it was unsafe.

`founderGateSingleOwner.test.ts` kept its invariant and lost its subject: the
sweep for a local founder-identity shim across every router and middleware is
untouched; the beta case became *"the beta rail stayed deleted"*; and the vacuity
guard was re-anchored to `routes-admin.ts`. **Anchoring a vacuity guard to the
file a check was written about is how it fails the day that file is right to
remove.**

`colon-any` 3011 → 3009.

### Unit 76 — B12: the standalone negotiation copilot's KILL, executed

The deletion ledger had carried a KILL verdict since it was written. The client
door was frozen; `/api/negotiation` was mounted and reachable by any
authenticated user of any org, with no flag check.

**What the blocker had not recorded: the ledger's premise was incomplete.** It
named three artifacts and assumed `/api/negotiation` was the service's only rail.
`routes-ai-operations.ts` carried three more copilot endpoints on the same
service — `POST /negotiation/session`, `POST /negotiation/objection`,
`GET /negotiation/:id` — with no client caller. Deleting only what the ledger
named would have removed a door and left a window open beside it.

Kept, deliberately: `negotiationOrchestrator` behind
`POST /api/ai/negotiation/script`, called by the deal detail view from inside the
Deals door. That is the founder's ruling and the shape the no-new-AI-destinations
rule asks for.

**Two deliberate departures from the blocker's own instructions**, both because
the repo already knew better:

1. `/negotiation` KEEPS its `FROZEN_ROUTES` entry. Removing it reads as
   *unfrozen*, and the list is served to clients still on an older bundle.
   `/vision-ai` had already set that precedent; the reasoning now lives in
   `shared/feature-freeze.ts` instead of one blocker note.
2. `negotiation_sessions` was NOT dropped — customer rows, founder-only hard
   stop. Allowlisted in `reachability.json` for both writer and reader with that
   reason, so it shows in every gate run rather than vanishing into a baseline.

`paxStaysAmbient.test.ts` kept its invariants and lost its example: the
exempt-destination set is asserted EMPTY where it asserted exactly
`"/negotiation"`, and the vacuity guard stopped proving the component-name
detector by pointing at a live offender — **an anchor to an offence dies when the
offence is fixed** — and exercises it against samples instead, positive and
negative.

Also deleted: `tests/unit/negotiationCopilot.test.ts`, 293 lines that imported
nothing from the service and re-implemented its objection patterns locally.

`colon-any` 3009 → 3006. `openai-bypass` 89 → 85: the copilot held four direct
`chat.completions.create()` calls outside the aiRouter chokepoint — spend no
per-org quota or platform daily ceiling could see, on a surface nothing called.

### Unit 77 — B11: paid advertising is a founder instrument, permanently

The blocker asked *platform activity or customer feature*. The founder answered
neither of its two options: *"this was meant for me as the founder to run ads for
this AcreOS only. Never for a customer to be able to run their own ads."*

**Why the platform ad account is correct here and fatal for payments** — worth
stating because it looks like an exception to the money-custody ban and is its
mirror image. One platform `ACTUM_MERCHANT_ID` for all orgs meant CUSTOMER money
on AcreOS's account: banned. One platform `META_AD_ACCOUNT_ID` spending AcreOS's
own money on AcreOS's own advertising is AcreOS being its own customer. The
question the ruling asks is *whose money is it*. **The only thing keeping the two
apart is that no customer path exists** — so that is what the test asserts,
rather than asserting something about ad accounts.

**What the blocker had not caught:** `GET …/campaigns/:id/stats` had NO founder
gate at all. It returns spend, impressions, clicks and cost-per-lead for any
campaign id on the platform ad account, so any authenticated member of any org
could read AcreOS's own marketing performance by iterating ids. **Gating the
spend and leaving the reads open is B11's own finding, one layer down.**

**A security fix found on the way in.** The public
`POST /api/webhooks/meta-lead-ads` verified its Meta signature inline and was
fail-open twice over: no `META_APP_SECRET` meant no verification at all, and a
caller who simply OMITTED the `X-Hub-Signature-256` header skipped the check even
when the secret WAS set — an attacker never had to forge anything. It also
compared with `!==` (a timing oracle) and hashed `JSON.stringify(req.body)`
rather than the raw bytes Meta signed, so a VALID delivery could fail to verify
too. **That endpoint CREATES LEADS**: an unsigned POST wrote rows into a real
pipeline, indistinguishable downstream from real ones. Replaced by
`server/middleware/metaWebhookSignature.ts` — fail-closed on both, constant-time,
raw-body — matching `twilioSignature.ts` and `inboundEmailSignature.ts`, because
three verifiers that behave differently under a missing secret is how one of them
ends up being the wrong one.

Registered as `hard-stop.ads-founder-only-rail`: the **sixth** hard stop and the
second outright ban, recorded next to the money-custody ban on purpose.

### Unit 78 — B9: the VA persistence layer, built

`vaManagement.ts` declared its storage as two string constants — `VA_TASKS_KEY`,
`SOP_LIBRARY_KEY` — and never read either. `createTask` was a pure function;
`POST /api/va/tasks` answered 200 with a record that existed only in that
response; metrics and audit-trail computed over
`organizations.settings.va_tasks`, an array with no creator anywhere in the repo,
and returned zeros that READ AS MEASUREMENTS.

Built: `va_tasks` + `va_sops` (migration 0235, mirrored in `scripts/migrate.mjs`),
an org-scoped service layer, and the routes wired. `GET /api/va/tasks` and
`GET /api/va/tasks/:id` are new — a subsystem that can store a task and never
show it back is the same dead end in a different place.

**A type error that would have 500'd on deploy, caught by checking rather than
trusting.** The original `VaTask` interface declared `assignedToUserId: number`,
and nothing ever contradicted it *because there was no column to check it
against*. `users.id` is a **varchar**. An integer column would have failed at
`CREATE TABLE` with *"Key columns are of incompatible types"* — exactly the class
CLAUDE.md names. The schema was written against the real `users` table, not
against the interface that described it.

**The audit trail was fabricating the assistant's own account of the work:**
`reasoning: t.completionNotes || "Task completed as assigned"` — a default
sentence presented as what the VA said they did. Removed.

**Recurring tasks deliberately NOT built.** `GET /api/va/scheduled` refuses with
501: a schedule table with no runner is the built-but-unwired defect this repo
keeps finding, and one refusal is cheaper to remove later than a half-built
scheduler is to trust.

**Three tests rewritten to the new truth, none deleted.** `vaTaskPersistence`
pinned the 501 refusals; its invariant — *a write endpoint must not report a
success it did not perform* — is now satisfied by storing rather than refusing,
so the assertions flip to requiring the persisting call, the org predicate and
the derived lifecycle stamps. `vaWorkflowBounds` held a deliberately INVERTED
assertion listing the settings collections still read through `as any` and
requiring them to still be broken; **it fired on this change, which is exactly
what it was built to do**, and with the list empty it flips to the plain form.
`vaManagement.test.ts` was 232 lines that imported nothing from the service and
re-implemented it locally — including four helpers that never existed in the
service at all — so every test passed against a copy; rewritten to call the real
pure layer.

`as-any` 1396 → 1391 · `colon-any` 3006 → 2992 · `unreached-exports` 654 → 653 ·
`table-count` 761 → 763 with the founder ruling as the sign-off.

### What these four units have in common

**Every blocker was written from a correct reading of the code and every one was
still incomplete.** B15 did not say the admin half must go with the public half;
B12's ledger row named three artifacts and missed a second rail; B11 gated the
spend and left the reads open; B9 described a missing layer but its own interface
carried a type that could not have compiled against the table. In each case the
gap was found by **re-verifying the premise against HEAD before executing** —
which is the program's own rule, and the reason it exists.

### Verification

`npm run check` EXIT=0 · `tests/unit` 689 files, 9038 passed, 1 skipped ·
14 mutations across the four units, every one verified to apply and every one
caught.

---

## Units 79–83 — five findings from one question, asked five ways · `961f35b` `0572aff` `a083ed1` `887428f` `9440fc6`

The founder's four decisions (units 75–78) closed the blockers. These five came
from following the residue those decisions exposed, and they share a shape worth
naming: **a control or a claim that survives the thing it refers to.** A gate can
be perfect and the ADVERTISEMENT beside it still wrong; a page can be deleted
thoroughly and the LINK to it still shipped; a subsystem can be killed and its
SWITCH still on the wall.

### Unit 79 — the reseller feature set advertised four dead subsystems

`whiteLabelService.createTenant` seeded every new reseller tenant with
`marketplace: true, academy: true, dealHunter: true, visionAI: true`. Three of
those have no code left at all. Unit 77 fixed `negotiationCopilot` because it was
deleting that subsystem; this is the same defect four more times.

**Flipping the defaults would not have fixed it.** A config written before a
verdict landed still says `true`, and `isFeatureEnabled` — the API a reseller
calls to decide what to show THEIR customers — reads that stored row. So
`RETIRED_FEATURES` is a **floor at the read**, covering every row ever written.

The fail-open for orgs with no white-label config is deliberately preserved and
now asserted: such an org is not a reseller tenant, and reading that as a bug
would hide real features from every ordinary organization.

**A mutation survived the first draft**, and the fix is the interesting part:
deleting `visionAI` from the register passed everything. The register could
silently SHRINK. The added check derives the requirement from EVIDENCE — a flag
must be registered exactly while the repo still shows its subsystem retired (file
absent, mount missing, or route behind `requireLadderFlag`) — plus a guard that
fails if every evidence check ever evaluates to "not retired".

### Unit 80 — accessibility rule 2, and the obvious check for it is backwards

CLAUDE.md states three accessibility rules; rules 1 and 3 are absolutes with zero
debt and rule 2 had no gate. NEXT_UP warned not to freeze the ~50 `outline-none`
hits without sampling, and sampling is what made the unit worth doing.

`index.css` carries `*:focus-visible { @apply outline-none ring-2 … }`. **It
removes the outline from EVERYTHING** and substitutes a ring. So
`focus-visible:outline-none` in a component agrees with a decision the stylesheet
already made — 241 occurrences, dominant form `outline-none` + `ring-2`, correct.
Freezing those would have produced a register of 241 non-defects.

The dangerous pattern is the inverse and it is rare: **zeroing the ring**. There
were exactly two, plus one `contentEditable` region with neither. All three
fixed, no register — two occurrences is a bug, not a debt.

The premise is asserted too: if `index.css` stops removing the outline globally,
`outline-none` becomes a real defect and `ring-0` becomes survivable, and the
reasoning has to be re-derived rather than quietly going stale.

### Unit 81 — two founder flag toggles wrote a column nothing reads

`platform_feature_flags` carries `enabled` ("back-compat — derived from state")
and `state` ("canonical post-port"). `rowToFlag` reads `state`, falling back to
`enabled` only when `state` is NULL — which no row written since the migration
is. Three founder-facing write surfaces existed; **two wrote `enabled` only.**

A founder flipped a flag, got a 200 showing `enabled: true`, and nothing changed
for any customer. **The direction that matters is the other one:**
`enabled: false` on a flag whose `state` is `"on"` left the feature ON for every
customer while the console reported it off — and `feature_marketplace` /
`feature_capital_markets` are governance flags behind `requireLadderFlag`. *"No
marketplace before ~25 customers"* was enforced by a flag the founder's own
console could not turn off.

The read had the same split: `getEnabledFeatureFlags` filtered on `enabled`, so a
flag in a targeted state (`beta`, `tier:pro`) — genuinely on for somebody — read
as off.

### Unit 82 — a KILL is not finished while its switch is on the wall

Three seeded flag keys name subsystems whose code is deleted, and **unit 76
created one of them**: executing the negotiation copilot's KILL thoroughly enough
to find a rail the ledger had never recorded, and still leaving
`feature_negotiation_copilot` in the catalogue, because nothing was looking there.

**Unit 81 raised the stakes on this by fixing the writes.** Before that, flipping
any flag was inert; afterwards a dead row is a live control that reports success
and changes nothing, on a console whose whole job is telling the founder what is
on.

`RETIRED_FLAG_KEYS` hides them from `getAll`, makes `getByKey` answer ABSENT (not
"off", so a stored `state: "on"` can never be honoured), and makes `setFlag`
throw — 404 at both write surfaces. The rows stay: deleting platform rows is the
class of action the 2026-08-01 table drops took an explicit founder ruling for
(recorded as B16, which nothing waits on).

**A mutation survived here too, from a new direction.** Deleting the filter from
`getAll` passed, because the comment above it named `RETIRED_FLAG_KEYS` and the
assertion only looked for the symbol. Seventh time prose has satisfied a check
meant for code — and the first where a comment describing the FIX satisfied the
check for the fix, rather than a comment describing a DEFECT tripping the
detector for that defect.

### Unit 83 — the server sent people to pages that do not exist

Six emitted destinations had no `<Route>`. Two are on `GET /api/today`, the
customer's first screen, and both are FALLBACK cards — they fire when the
customer has nothing else going on, so the quietest, newest accounts got the
broken buttons. `/evening-review`'s page was deleted in the Lens-4 sweep *because
"neither was linked from any nav surface"*; **this card was the link nobody
found.**

On the founder plane: two in the weekly digest email, one action-card deeplink,
and — the one that matters — `/founder/intelligence` as the URL an **on-call push
notification** opened. A founder woken at 3am by a critical alert tapped through
to NotFound.

**Why the class recurs:** deleting a page is a client-side change done
thoroughly — route, lazy import, file, comment. Nobody greps the server, where
the link lives in a job, a briefing builder or a push payload that nothing
type-checks against the router. Six accumulated across three separate,
individually careful deletions.

Each fixed on its own merits, not by one rule. The digest's two severity-keyed
links became a CATEGORY map, because one link per severity was the wrong shape as
well as a broken one: an AI-cost spike, a failing job and a churn cliff are looked
at in three different places, and sending all three to one page is re-pointing a
broken link at an approximation — **which looks fixed and is not.**

### Verification

`npm run check` EXIT=0 · `tests/unit` 693 files, 9,073 passed, 1 skipped ·
20 mutations across the five units; 18 caught on the first pass, 2 survived and
both survivals are recorded above with the assertion that now catches them.

---

## Units 84–88 — the second picker, and the fallback path · `dfac17d` `225d691` `b060c76` `ed4480d`

### Unit 84 — an auth flow the app does not have

Authentication is Clerk; AcreOS never receives a credential. Four surfaces said
otherwise, in four registers: two client pages lazy-imported and **never routed**
(the only two of 211 in that state), five dead-mounted rate limiters, a public
OpenAPI contract for `POST /auth/login`, and a security report claiming
*"Passport.js with bcrypt, 2FA available"* — the sentence someone quotes in a
questionnaire.

**The limiter fix had already been made in that file, twice, on either side of
the offending lines.** `/api/register` twenty lines below: *"those middleware
were dead-mounted (correct logic, never invoked)"*. The legacy OAuth limiters one
line above: *"removed with the standalone social-login OAuth — Clerk owns
login/OAuth now"*. The reasoning was applied to both neighbours and not to these.

**A naive sweep reported 16 of 23 OpenAPI paths missing and 14 were false** —
router-mounted paths whose sub-paths live in the router file. Checked before
claiming; no gate was built on that scan, and only the two verified exhaustively
against `server/auth/routes.ts` were touched.

### Units 85–87 — the second picker's four rulings

**B16 — delete the dead flag rows.** A `DELETE FROM platform_feature_flags` in
the deploy path. **The register stays after the rows go**, and the test now says
so: `RETIRED_FLAG_KEYS` is not bookkeeping for three rows, it is the only thing
looking at the flag catalogue, and it is what catches the NEXT kill's leftover
switch.

**B8 — keep deferring the webhook rail choice.** The ruling has exactly one
consequence for today's code, and B8 had already written it: do not wire the five
uncalled convenience wrappers. That is now an INVERTED assertion pinning the
derived emitter set at `["lead.created"]` — wiring `webhookDealCreated`, a
two-line change that looks like an improvement, fails CI with the reasoning
attached. Two assertions hold the premise: the wrappers must STAY (the rule is
about calling them), and `registerPublicApiV1` must stay unmounted — if it is
mounted, the deferral has ended and the block should be revisited.

**B10 — the cents family is canonical.** Deleted `POST /api/notes/:id/record-payment`:
no caller, float principal/interest math, not transactional, escrow credited
before the payment insert, **a note UPDATE with no organization predicate on
money**, and `updateData: any`. Under the ruling, fixing those five would have
been work thrown away.

**The migration list is a RATCHET, not a document.** Five legacy writers, derived
from source, strictly down-only: a new one fails, migrating one must lower the
list in the same commit. A hand-maintained migration list is exactly the artifact
that goes stale between a decision and its execution — this program watched that
happen to a deletion ledger, a feature-flag catalogue and a reseller feature set
in the same week.

**A correction to B10, found while checking it.** It claimed three of four
payment recorders call `splitPaymentCents`, naming `paymentApplication`. Against
HEAD that is three CALL SITES in TWO files: `paymentApplication` deliberately
accepts a PRE-SPLIT so the module stays pure and testable. True in spirit, not a
call — now pinned as the distinction it is.

### Unit 88 — the fallback path is the broken one, twice

Unit 83's gate asked *does App.tsx declare this path*. Thirteen paths are
declared through `<FlaggedRoute>`, which renders `NotFound` when its flag is off
— and the flags are seeded FALSE. A link could pass every assertion and still end
at a 404.

One did: `autonomousDealMachine.ts` linked its **default** action card at
`/market-intelligence`. Default cards fire when there is nothing else to show.

**That is the second time in two units that a FALLBACK path was the broken one**
— unit 83 found the same on the Today screen's fallback cards — and it is worth
stating as a rule rather than a coincidence: **the happy path gets exercised and
the empty state does not.** Both units' defects were invisible to every customer
with an active pipeline and guaranteed for every customer without one.

### Verification

`npm run check` EXIT=0 · `tests/unit` 695 files, 9,098 passed, 1 skipped ·
14 mutations across the five units, every one verified to apply and every one
caught. `colon-any` 2992 → 2990.
