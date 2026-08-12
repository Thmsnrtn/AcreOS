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
