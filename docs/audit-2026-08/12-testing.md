# 12 — Testing (Dimension 12)

*Slice 12. Read-only. Charge: assess test DISTRIBUTION, name tautologies, rank untested paths by blast-radius × churn, and grade the suite that must catch the three documented wave failures.*

**State of the region:** 801 `.test.ts/.tsx` files, ~173K test LOC, running under Vitest with `pool: forks`, no real Postgres (`tests/setup.ts` sets a dummy `DATABASE_URL` and mandates "Actual DB calls should be mocked"). Coverage is **bimodal**: dense, genuine unit coverage of *pure functions* (compliance classifiers, finance/amortization math, solene/pax audit logic) sitting on top of a **~18% global floor** where the actual send / route-handler / engine glue lives. The tautology problem is small; the *hole* problem is large.

**The single defect class that survives the gates here:** **honesty-critical glue code that is reachable, churned, and load-bearing but has zero tests** — the send-decision engine, the diligence engine, and route handlers — because the coverage ratchet floors are *per-file on a hand-picked money list* and *18% everywhere else*, so a file at 0% coverage is fully compliant. The three "own selected" wave failures are now gated, but all three gates are **static/regex with named escape hatches** and none run against a real database.

---

### F-12-1 — The campaign send-decision engine (`sequenceProcessor.ts`) has zero tests, including the exact "skipped-recorded-as-sent" logic a past incident added
**Severity:** P1 serious
**Surfaced by:** slice 12
**Survives which gates:** `vitest` coverage ratchet has NO per-file floor for `sequenceProcessor.ts`, so it falls under the 18% global floor and 0% passes. Reachability ratchet counts it as reached (it IS imported at runtime), so "unwired" gates stay green. No lint targets it.
**Evidence:** `grep -rln "sequenceProcessor\|SequenceProcessor" tests/` → **empty**. Runtime callers: `server/jobs/runScheduledJobs.ts`, `server/services/smsService.ts`, `server/services/campaigns/index.ts`. The honesty-critical logic is documented at `server/services/sequenceProcessor.ts:19-27`: *"`sendStep` used to return void, which meant the caller … wrote a campaign_delivery_events row with status 'sent' even when the channel helper had bailed out (no phone, quiet hours, TCPA block). A skipped send must never be recorded as sent."* That fix (the `StepSendResult` discriminated union, `sequenceProcessor.ts:27-49`) is untested.
**What's wrong:** The service that decides, per step, whether a real marketing message was `sent | skipped | deferred | failed` — and writes the `campaign_delivery_events` audit row from that verdict — has no test pinning the mapping. A regression that re-collapses "skipped" to "sent" (the original bug) writes a fabricated delivery record and re-passes every gate.
**Impact:** Burns trust after sale (and fabrication-adjacent): a customer's campaign report would show messages "sent" that TCPA/quiet-hours/frequency gates actually blocked. Hits the first paying customer the first time they run a sequence.
**Fix:** Add `tests/unit/sequenceProcessor.test.ts` exercising `sendStep`/`processEnrollment` with the channel helpers stubbed to each bail-out (no phone, quiet hours, TCPA block, frequency skip) and assert (1) the returned `StepSendStatus` and (2) that a `skipped`/`deferred` outcome writes a delivery row whose status is NOT `sent`. Pure-mapping, no DB needed.
**Gate it:** Add a per-file coverage floor `"server/services/sequenceProcessor.ts": { lines: 60 }` to `vitest.config.ts` thresholds (same list as `smsService`/`dunning`). Measured baseline today: 0%.
**Effort:** M
**Blast radius:** every SMS/email/mail campaign send; `campaign_delivery_events` integrity.
**Confidence:** high — the zero-test claim is a clean grep; the honesty logic is in the file's own header.

---

### F-12-2 — The wave-failure suite is real but every one of its three gates is static/regex with a named escape hatch; none touches a database
**Severity:** P1 serious
**Surfaced by:** slice 12
**Survives which gates:** these gates ARE the gates — the finding is that they are weaker than their headers imply, so the *next* instance of each wave class can still ship.
**Evidence:**
- **(a) schema table with no migration** → `tests/unit/schemaMigrationDrift.test.ts`. Scanner is `CREATE TABLE (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?` (line 44) matched against the *raw text* of `migrations/*.sql` + `migrate.mjs`. It is existence-of-string, not existence-of-live-table: a table named in a SQL **comment** (`-- CREATE TABLE foo …`) or in a later-dropped block counts as "created". The companion column gate `schemaDrift.test.ts` carries a **599-entry allowlist** (`schemaDrift.allowlist.json`, counted). Neither runs SQL — a migration with valid `CREATE TABLE` syntax but a wrong column type, missing `NOT NULL`, or broken index passes and 500s on first query.
- **(b) selected DNC provider, no credentials, passes every number** → `tests/unit/searchbugDncProvider.test.ts` + `dncScrub.ts:163-170`. This one is **strong**: it asserts a selected-but-uncredentialed adapter returns UNAVAILABLE and that marketing traffic fails *closed* (`gateAsMarketing` with `hasConsent:true` still blocked). Good.
- **(c) `as any` widening `leads.organizationId`** → fixed by RE-TYPING (`as-any.json` lastBumpNote: "leads … organizationId read straight off the Lead row (organizationId is notNull, so the old `as number | undefined` was actively lying)"). But the `as-any` ratchet counts occurrences (baseline 1417) and does not distinguish a tenant key from a benign cast — a NEW `as any` on a tenant/money field consumes headroom silently. Its ungated sibling `: any` (~3,731 per slice 06) is the live hole.
**What's wrong:** Two of the three "own selected" regression tests are static text scanners with explicit allowlists/escapes and no DB execution, and the third relies on a count-only ratchet blind to *which* symbol was cast. The repo has proven each class can ship; the gates reduce, but don't close, recurrence.
**Impact:** Blocks first sale (a) — a fresh-DB deploy still 500s if the CREATE TABLE has a syntax-valid but semantically wrong body. Neither/burns-trust (c) — a future tenant-key widening is one silent ratchet-headroom cast away.
**Fix:** (a) Add ONE integration test that applies `migrate.mjs` + `migrations/*.sql` to a throwaway Postgres (PGlite or a CI service container) and runs `SELECT 1 FROM "<table>" LIMIT 0` for every `pgTable` name — this catches syntax-valid-but-broken DDL that the regex cannot. (c) Extend the `as-any`/`: any` lint with a **symbol denylist** (`organizationId`, `orgId`, `amountCents`, `userId`) that fails on ANY cast touching those identifiers regardless of the numeric baseline.
**Gate it:** the migration-apply integration test above; measured baseline: 0 such tests exist (`grep` for testcontainers/pg-mem/PGlite over `tests/` returns only two files, both of which mock `db`). Tenant-key denylist lint, baseline 0 protected symbols.
**Effort:** L (real-DB harness) + M (denylist lint)
**Blast radius:** every deploy (a); every tenant-scoped read (c).
**Confidence:** high for the regex/allowlist/no-DB facts (all cited); medium that a broken-DDL case exists today — I did not enumerate all migrations for one.

---

### F-12-3 — Coverage floors protect a hand-picked money list; the tenant-boundary + route-handler surface rides the 18% global floor, so 0%-covered handlers are compliant
**Severity:** P2 real
**Surfaced by:** slice 12
**Survives which gates:** by construction — `vitest.config.ts` sets `thresholds.lines: 18` globally (comment: "measured global coverage was 18.22%") with per-file floors only on ~12 money/send/compliance files. Everything else is green at any coverage ≥ its share of 18%.
**Evidence:** `vitest.config.ts:40-73`. Per-file floors exist for `creditPool`, `webhookHandlers`, `smsService`, `dunning`, `tcpaCompliance`, `dncScrub`, `featureGate`, `roleScope`, `permissions` (floored at **25** with the comment "async getUserPermissionContext + middleware (263-395) are still untested"). `orgScopedDb.ts` — the tenant-scoping DB wrapper — is referenced by exactly **1** test file (`grep -rl orgScopedDb tests/`). The largest route files carry no handler-level unit tests: `routes-organization.ts` (2,497 loc, the org/tenant admin surface), `routes-campaigns.ts` (2,293 loc), `routes-va-engine.ts`, `routes-communications.ts` each match only 1-2 test files by loose string grep, most of which merely name the route rather than mount and exercise it.
**What's wrong:** The coverage ratchet is honest (floors sit just under measured, direction-locked up) but its shape encodes "money is tested, tenancy and handlers are not." `permissions.ts` — the code that computes what a user may see across orgs — is self-documented as untested in the exact range that matters (263-395).
**Impact:** Burns trust after sale — a cross-org read introduced in an untested handler surfaces to whichever customer signs up second. This is the substrate that trace-slice T4 hunts vertically; here it is the *why*: nothing forces those handlers under test.
**Fix:** Raise `permissions.ts` floor after landing tests for `getUserPermissionContext`; add per-file floors for `orgScopedDb.ts` and the top-5 route files once handler tests exist. Order by tenant-blast-radius, not size.
**Gate it:** the existing coverage ratchet — the mechanism is right, the *set* is incomplete. Baseline: global 18, `permissions.ts` 25, `orgScopedDb.ts` unfloored.
**Effort:** L
**Blast radius:** tenant isolation, permissions, all large route files.
**Confidence:** high.

---

### F-12-4 — `dueDiligenceEngine.ts` (1,570 loc) — the deal-analysis engine — has no test of the engine; only an IDOR route test and a mention exist
**Severity:** P2 real
**Surfaced by:** slice 12
**Survives which gates:** no per-file coverage floor; reachability green (it is imported). Its output feeds the deal-evaluation surface a first customer would use to decide on a parcel.
**Evidence:** `grep -rln dueDiligenceEngine tests/` returns `dueDiligenceTemplateIdor.test.ts` (tests IDOR on a *template* route, not the engine's computation) and `selfHealingDataPlane.test.ts` (a mention); everything else is `tests/e2e-intelligent/*` markdown journey notes, not executable tests. The engine's scoring/finding-generation logic is unexercised.
**What's wrong:** A 1,570-line engine whose numeric output is shown to the user as diligence findings has no unit test on the computation. If it fabricates or miscomputes a finding, only manual QA catches it — and slice 22 (number-provenance) exists precisely because that class is invisible to the fabrication lint.
**Impact:** Burns trust after sale — a wrong or invented diligence number is exactly the "fabrication shown as real" P0 class if it reaches render from an empty/failed input set; here I rate P2 because I did not trace a specific fabricating input (that is T3's job).
**Fix:** Golden-file tests: feed representative parcel inputs, assert the finding set and scores; add an empty-input case asserting it refuses rather than emits `0`/placeholder.
**Gate it:** per-file coverage floor once tests land; baseline 0%.
**Effort:** M
**Blast radius:** deal-evaluation surface.
**Confidence:** medium — "engine untested" is grounded; the fabrication-risk severity is deferred to T3.

---

### F-12-5 — Tautology rate is low, but ~107 files assert on mocked return values; the concentrated smell is "mock the DB, assert the shape you fed in"
**Severity:** P3 minor
**Surfaced by:** slice 12
**Survives which gates:** none — no gate scores test *quality*; coverage counts a tautological line as covered.
**Evidence:** 107 test files use `mockResolvedValue/mockReturnValue`; 226 use `vi.fn()`. Sampling the large AI tests refutes the worst fear: `server/services/pax/continuousAudit.test.ts` (966 loc) mocks `db`/`dispatchQueue`/`drizzle-orm` (lines 15-339) but its **assertions are on real pure logic** — `randomSample` distribution (`:396-410`), severity classification and citation matching (`:460-506`, e.g. `expect(out!.matchedPatterns).toContain("$42,000")`). That is a good test. The residual smell is the subset of the 107 where the DB is stubbed to return row `X` and the test asserts the handler returns `X` — verifying the mock, not the query/filter. I did not enumerate which of the 107 are pure tautologies; the honest characterization is "low rate, not zero, and invisible to every gate."
**What's wrong:** Nothing enforces that a mocked dependency's return isn't the thing being asserted. The risk is a false sense of coverage on org-scoping: a test that stubs `db.query` to return only in-org rows can never catch a missing `WHERE organizationId = ?`.
**Impact:** Neither directly — but it inflates the coverage numbers that F-12-3's floors rest on.
**Fix:** For tenant-scoped queries specifically, prefer a real-DB integration test (see F-12-2 harness) over a mocked-`db` unit test, so the `WHERE` clause is actually executed.
**Gate it:** none possible via static analysis (tautology is semantic). Best proxy: route tenant-boundary tests through the real-DB harness so the mock can't launder the assertion.
**Effort:** covered by F-12-2's harness.
**Blast radius:** confidence in the coverage metric itself.
**Confidence:** medium — the good-test sample is cited; the tautology subset is estimated, not enumerated.

---

## The 10 highest-risk UNTESTED paths (blast-radius × reachability, ranked)

Ranked by consequence-if-wrong × runtime-reach. "Tests" = test files that actually import/exercise the symbol (loose grep, verified zero where marked ✗).

| # | Path | LOC | Tests | Why it ranks |
|---|------|-----|-------|--------------|
| 1 | `server/services/sequenceProcessor.ts` | 676 | **0 ✗** | Decides sent-vs-skipped for every real campaign send; writes the delivery audit row. F-12-1. |
| 2 | `server/utils/permissions.ts` (263-395) | — | self-documented untested | Cross-org permission computation; floor pinned at 25% *because* it's untested. |
| 3 | `server/storage/orgScopedDb.ts` | — | 1 | The tenant-scoping wrapper; a bug here is cross-tenant leakage. |
| 4 | `server/services/dueDiligenceEngine.ts` | 1,570 | **0 (engine) ✗** | Deal-analysis numbers shown to the buyer. F-12-4. |
| 5 | route handlers in `routes-organization.ts` | 2,497 | ~1-2 (named only) | Org/member/tenant admin surface; no handler-level tests. |
| 6 | `server/services/achAutopay.ts` | 1,562 | 4 (money path partially) | Pulls borrower money; money custody constitution surface. |
| 7 | `server/services/etlHandlers.ts` | 1,602 | 3 | Ingests external data that later renders as "real" numbers (T3 class). |
| 8 | `server/services/workflow-engine.ts` | 2,705 | 8 (churned 4×) | Fires the automations that send/act; high churn, glue-heavy. |
| 9 | `server/services/autonomousDecisionExecutor.ts` | 1,473 | 4 (churned 4×) | Executes agent decisions with side effects; honesty/spend surface. |
| 10 | fresh-DB migration apply (whole `migrations/` set) | — | **0 real-DB ✗** | No test applies migrations to a live PG; the wave-(a) 500-on-deploy class. F-12-2. |

Rows 1, 4, 10 are clean zero-test findings above. Rows 2, 3, 5-9 have *some* string-matching test presence but no test that exercises the load-bearing branch; I mark them by consequence, not by proven zero, and flag that distinction rather than overclaim.

---

## Coverage ledger

**Examined exhaustively:** `vitest.config.ts` (full thresholds block, lines 1-95); `tests/setup.ts`; `tests/unit/schemaMigrationDrift.test.ts` (full); `tests/unit/schemaDrift.test.ts` (header + parser); `tests/unit/searchbugDncProvider.test.ts` (first 130 lines + gate helpers); `dncScrub.ts` credential-fallback region; `sequenceProcessor.ts` header/exports/callers; `as-any.json` lastBumpNote (the organizationId re-typing record). Counted: 801 test files, 599 schemaDrift allowlist entries, 107 mock-return files.

**Examined by sampling:** solene/pax large tests for tautology (`continuousAudit.test.ts` read at assertion level; `selfAudit.test.ts`/`verifyQueue.test.ts` sizes noted, contents not read line-by-line); route-file test presence via loose string grep (NOT verified as real imports — stated as such in the ranking table); churn via `git log --since 2026-02-01` (shallow history — churn counts are low-confidence and used only for tie-breaking).

**Did NOT examine:** the `tests/e2e*/`, `tests/load/`, `tests/perf/`, `tests/simulation/`, `tests/personas/` suites (Playwright/journey — out of unit-charge scope); whether the suite actually passes at HEAD (did not run `npm test`); coverage was NOT re-measured (the 18.22% figure is quoted from the config comment, not independently reproduced); the precise membership of the ~107 mock-return tautology subset; per-migration DDL correctness. The route-handler "no real test" claims (rows 5-9) are consequence-ranked, not proven-zero — raising them to findings requires opening each cited test to confirm it doesn't mount the handler.

## Constitution Collisions

None. Every recommendation adds tests or tightens existing gates; none adds a nav entry, an AI destination, a marketplace/API surface, or moves money. The tenant-key denylist lint (F-12-2) and the real-DB migration test (F-12-2) reinforce existing constitutional invariants (tenant isolation, no-500-on-deploy) rather than relitigate any DO-NOT-DO decision.
