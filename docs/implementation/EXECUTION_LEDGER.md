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
