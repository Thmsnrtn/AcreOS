# AcreOS Platform Audit — Phase 0

**Date:** 2026-08-02 · **Branch:** `claude/acreos-audit-charter-dyddxb` · **Commit at audit:** `5ca0f29` (HEAD)
**Method:** nine parallel specialist auditors over the full repository (4,485-commit history, un-shallowed),
each told to verify every claim against code, cite `path:line`, and treat repo docs as leads not truth.
The governance test suite was executed live (`constitution.test.ts`, `moneyCustodyHardStop.test.ts`,
`founderFourDoors.test.ts`, `ratchet.mjs --measure`), and the full 10,290-test vitest gate was run end to end.
Supporting artifacts: `docs/INVARIANTS.md`, `docs/data/DATA-DICTIONARY.md`, `docs/audit/BLAST-RADIUS.md`,
and the per-lens detail files preserved in the audit scratchpad.

**How to read this:** the charter said *"where this brief and the repo disagree, the repo wins, and you say
so explicitly."* Section 1 does exactly that. The short version: **the charter's picture of AcreOS is a
snapshot from roughly mid-April 2026 — four months and ~3,400 commits stale.** Almost every debt it names as
open has been closed or superseded; the debts that actually matter are ones the charter does not mention. The
platform is further along, larger, and better-governed than the brief believes — and its real risks are more
specific.

---

## 1. Reality reconciliation (charter §3, §4.1)

Verdict key: **confirmed** · **stale** (was true, since fixed — with when/what) · **partially-true** ·
**refuted**.

| # | Charter claim | Verdict | What the repo shows |
|---|---|---|---|
| a | Stack is TypeScript **/ Bun** | **refuted** | Node.js 22 + `tsx` (dev) + esbuild/Vite (build) + `node dist/index.cjs` (prod), npm lockfile. Zero Bun artifacts in the tree or in 4,485 commits of history. (`Dockerfile:7,15,17`, `package.json`, `script/build.ts`) |
| b | **~470,000 lines** | **stale** | **1,039,751** TS/TSX lines (server 558K / client 272K / tests 150K / shared 44K). 470K was accurate ~mid-April 2026; the repo has more than doubled since. |
| c | **350+ services** | **partially-true (understated)** | ~550 top-level modules in `server/services/` (~890 counting subdirectories). The sprawl is worse than remembered — which *strengthens* the standing shrink program. |
| d | **400+ database tables** | **partially-true (understated)** | **748** `pgTable` definitions (500 in `shared/schema.ts` + 244 in `shared/schema/` + 4 in `shared/models/`), matching the repo's own down-only table-count ratchet baseline. 66% above the deletion ledger's own ≤450 H2 target. |
| e | **900+ commits** | **stale** | **4,485** commits; ~990 by 2026-04-01. Cadence: ~1,950 commits in the last three months, shifting from bulk agent-waves to reviewed PRs in July. |
| f | **7,379-line `founder-dashboard.tsx` monolith, refactor deferred** | **stale** | Decomposed 2026-05-08, retired 2026-06-01 (`f2801428`), file deleted. The four-door successor doctrine is machine-enforced (`FOUNDER_ROUTE_BASELINE=82`, ratchet green). Any roadmap item to refactor it is a duplicate. |
| g | **Onboarding v2 on 100% mock data, never validated** | **stale** | The mock survives only as *unreferenced* static JSX at the repo root. The live `/onboarding-v2` is server-backed, rebuilt 2026-07-29 (`594d9e86`) for 15 verticals with honest skip/re-run and a `noMockWidgets` ratchet, exercised end-to-end in launch week. What remains unvalidated is validation *by real customers* — of which there are zero. |
| h | **Prior `users`-table schema drift broke auth in production** | **confirmed** | Reconstructed precisely (see §3). The founder may not know the **structural cause is still load-bearing.** |
| i | **Thin test coverage** | **partially-true** | 872 test files / 10,290 tests, but ~18% measured line coverage — thin *by lines*, enormous *by count*, and strategically floored on money/compliance paths. The deeper problem is quality bimodality (see §5). |
| j | **Multiple partially-reconciled agent/persona systems** | **partially-true** | Several layers remain, but converging *by plan*: a canonical 13-member roster + alias bridge, SCP's 12 personas archived 2026-07-14, five SCP engines deleted at HEAD. Not drifting. |
| k | **Pre-revenue, driving toward first users** | **confirmed** | `customers.md` 0/0/0; Stripe unkeyed. Sharper point: **launch-cleared (AMBER-GO) since 2026-07-09** — every remaining blocker is a founder credential or the release tap. |
| l | **Compliance defined-not-executed; LLC before first customer; CAN-SPAM address before first email; DNC vendor before first cold SMS** | **partially-true** | LLC ordering **contradicts founder memory** — the recorded runbook triggers LLC at $200 MRR (*after* first customers). CAN-SPAM and DNC are further along than remembered: both code-complete and fail-safe, awaiting only founder-provided values. |

### What the founder believes that is no longer true

- **"I owe a dashboard refactor."** Done three months ago; the file is gone and its replacement is ratcheted.
- **"Onboarding is an unvalidated mock."** The shipped onboarding is real; only customer validation is missing.
- **"The app runs on Bun."** It has never run on Bun.
- **"The codebase is ~470K lines / ~400 tables."** It is 1.04M lines / 748 tables — past the deletion ledger's own shrink targets, not approaching them.
- **"LLC comes before the first paying customer."** The founder's own runbook says the opposite ($200-MRR trigger).
- **"DNC/CAN-SPAM are unbuilt."** Both are built and fail-safe; they need secrets, not code.

### The one thing the charter got most right, and most wrong at once

Right: *"nothing in this document is verified ground truth; the repo wins."* That instinct was correct — the
repo won on nearly every claim. Wrong: the charter was written from memory **while the machine maintains exactly
the instruments that would have made it accurate** — `shared/governance/constitution.ts`, the table-count ratchet
with per-drop rationales, `customers.md`, the dated founder-ruling files. The single highest-leverage process fix
in this whole audit is in §8's recommendation: **charters and roadmaps should open with a generated
state-of-the-company preamble, never a hand-typed one.**

### Standing decisions the charter would relitigate (do not)

The repo carries a machine-readable decision ledger. Four charter asks collide with settled founder decisions:

| Charter ask | Standing decision it violates | Source |
|---|---|---|
| "Marketplace scaffolding" | No marketplace before ~25 customers **and** marketplace is FREEZE / "Do NOT polish" (already built, feature-gated) | constitution `expansion-gate`; `deletion-ledger.md:23` |
| "New personas / persona verticals" | No new persona verticals — restated verbatim inside ruling #11 | `founder-decisions-2026-07-28.md:143-147` |
| "A separate AI workspace" | No new AI destinations — Pax stays ambient; nav ratchets structurally forbid a new top-level surface | constitution `ai-surface`; `founderFourDoors.test.ts` |
| "Bind the review board to the SCP persona set" | SCP personas archived 2026-07-14 ("no new consumers"); 5 SCP engines deleted at HEAD | `sovereign-protocol/agents/ARCHIVED.md`; `5ca0f29c` |

**On the SCP binding specifically** (the charter's own §1 conditional): bind the board's *rules* to the live
constitutional layer (`sovereign-protocol/immutables.json`, hash-pinned, + `shared/governance/constitution.ts`),
and the board's *seats* to the canonical 13-member roster via the existing `agentCodenameAlias` bridge
(`iris`→eng, `beatrice`→legal, `lena`→CFO, `maren`→CPO, `soren`→growth). **Add zero files under
`sovereign-protocol/agents/`** — instantiating archived personas would recreate the exact fourth-persona-system
disease the alias bridge was built to cure.

### One unadjudicated conflict *between* standing decisions (needs the founder)

Two founder decisions now point in opposite directions and neither ledger admits it:
- **Deletion ledger H2 target:** ≤600K LOC / ≤450 tables by end of H2.
- **Ruling #11 (2026-07-28):** build ALL registered verticals fully — which drove the repo to **1.04M LOC / 748
  tables** with zero customers.

Both are founder decisions; both cannot be honored. Whichever wave runs next silently resolves a strategic
conflict the founder never explicitly made. **This belongs on a decision card** (see §10, decision 3).

---

## 2. Codebase map & risk concentration (charter §4.2)

AcreOS is a **modular-monolith-in-progress**: genuinely excellent boundary tooling (17 bespoke CI gates, a
compiler-enforced 28-file autopilot kernel seam, tenancy-by-construction lints, down-only size/table ratchets)
aimed mostly at *second-order* concerns, while *first-order* layering is unenforced. The result is a small number
of spine files carrying almost all the risk.

### Top-20 risk files (lines × change-frequency × blast-radius)

Risk is pathologically concentrated: **`shared/schema.ts` scores ~200× the #2 file.**

| # | File | Lines | Commits | Imported by | What it is |
|---|---|---|---|---|---|
| 1 | `shared/schema.ts` | 18,524 | 438 | 977 | Drizzle god-barrel; 500 inline tables + re-exports of 77 slices that import values *back* (real cycle) |
| 2 | `server/storage.ts` | 1,682 | 118 | 188 | God-facade over 34 `*Repo` mixins; `DatabaseStorage` god-type; re-exports `db` |
| 3 | `server/services/aiRouter.ts` | 1,934 | 31 | 94 | Single AI funnel; had a cross-tenant cache-key bug fixed 2026-06-10 |
| 4 | `client/src/lib/queryClient.ts` | 605 | 28 | 279 | React Query client for the whole SPA |
| 5 | `server/utils/logger.ts` | 396 | 11 | 887 | Most-imported server file; in a cycle with `sentry.ts` |
| 6 | `server/db.ts` | 253 | 12 | 883 | pg pool + Drizzle + `withTransaction` |
| 7 | `server/services/emailService.ts` | 1,190 | 26 | 59 | Purpose-laned platform mail sender |
| 8 | `client/src/components/layout-sidebar.tsx` | 2,259 | 145 | 5 | The five customer doors; most-churned UI file |
| 9 | `server/middleware/getOrCreateOrg.ts` | 480 | 21 | 124 | Tenancy bootstrap; every authed request crosses it |
| 10 | `server/routes.ts` | 2,882 | 430 | 1 | Composition root mounting ~275 routers (147 `app.use`) |
| 11 | `server/jobs/runScheduledJobs.ts` | 5,848 | 94 | 2 | Autopilot heartbeat; ~150 jobs in one file; ~70 once ran dark in prod |
| 12 | `client/src/pages/properties.tsx` | 3,450 | 103 | 3 | Map-door page monolith |
| 13 | `server/services/workflow-engine.ts` | 2,705 | 21 | 17 | Workflow/trigger engine (Wave-B incident territory) |
| 14 | `server/ai/tools.ts` | 2,813 | 37 | 9 | Pax AI tool definitions + executors |
| 15 | `client/src/pages/leads.tsx` | 2,507 | 78 | 4 | CRM page monolith |
| 16 | `server/routes-deals.ts` | 2,521 | 62 | 5 | Deals routes; exports consumed by other route files |
| 17 | `server/utils/errors.ts` | 269 | 10 | 279 | Mandated `Errors.*` helpers |
| 18 | `client/src/App.tsx` | 2,267 | 346 | 1 | SPA route table; 226 lazy mounts |
| 19 | `server/services/data-source-broker.ts` | 2,459 | 15 | 19 | Tiered external-data broker; overlaps the provider registry |
| 20 | `server/services/solene/continuousLoop.ts` | 1,651 | 51 | 8 | Solene COO tick loop; in a 3-cycle |

The high-churn composition files (`schema.ts` 438, `routes.ts` 430, `App.tsx` 346, `layout-sidebar.tsx` 145)
are exactly the shape that **serializes a fleet of parallel agents on merge conflicts** — the fleet's own
throughput ceiling.

### Bounded-context seam quality

Of the charter's 12 target contexts, only five have clean seams today:

| Context | Seam | Biggest blocking coupling |
|---|---|---|
| Identity & Tenancy | **clean** (best in repo; 2 dedicated lints) | `getOrCreateOrg` imports the storage god-facade |
| Billing & Entitlements | **clean** (`shared/billing`) / smeared (server) | `routes-billing`→`routes-subscription`; Stripe webhook at top level |
| Outreach & Deliverability | **clean** (mail/comms routers) / smeared (email) | `emailService` imported by 59 files, no policy/transport split |
| Intelligence & Agents | **clean** (28-file kernel, CI-enforced) / smeared elsewhere | `continuousLoop`↔`operator`↔`cognitionContext` cycle; Pax→`routes-ai` |
| Note & Servicing | smeared (**strongest domain discipline**) | `form1099Batch.ts` imports servicing math *from* `routes-notes.ts` |
| Parcel & Property / Valuation / List / Lead / Diligence / Transaction | **smeared** | tables live in the `schema.ts` barrel (977 importers); all types flow through it |
| **Control Plane** | **nonexistent server-side** | client got four doors; ~40 `routes-founder-*` files never consolidated; `oncall`→founder-route inversion |

### True seams vs false seams

- **True (cuttable today):** the autopilot kernel↔domain-pack boundary (CI-enforced, baseline 0); the provider
  registry; the mail/comms send lanes; the deliberately-unmounted `api-v1`; `shared/billing`.
- **False (look like seams, are not):** the schema barrel (slices import values back — an 18-file cycle); the
  storage facade (god-type spans all 34 repos); `packages/solene` (paper barrel re-exporting server code);
  domain `index.ts` barrels; and the `routes-*.ts` file granularity itself.

### Import cycles (Tarjan SCC over the resolved graph)

- **71 files** across routes↔services↔jobs↔ai, fused by only **~12 inverted edges** (a service importing 1099
  math from a route; `oncall` importing alerting from a founder route; Pax nudges reaching into `routes-ai`).
  Cheap to break: extract the functions, add one layering rule at baseline 0.
- **27 files** solene↔autopilot (value-level governance tangle) · **18 files** schema↔slices (the load-bearing
  false seam) · **37 files** storage↔repos (type-only, runtime-safe).

### Dead weight for the agent fleet

~190 files of unimported satellites (`acreos/` JSX prototypes, `acreos-landing/`, `acreos-onboarding/`,
`handoff/`, the parallel `design-system/` Storybook, `apps/remotion`, self-archived `oz/`) pollute every
glob/grep and offer three wrong "onboarding" trees to edit. **Spare `sovereign-protocol/immutables.ts`** — ~20
live server files import it via `@sovereign/`.

**Blind spots worth naming:** ESLint ignores `server/**` wholesale (`eslint.config.js:44`) — 54% of the code
gets only regex ratchets, no AST-level linting; and no CI gate detects import cycles or server-internal layering
violations, which is how the 71-file SCC formed despite 17 other gates.

---

## 3. Schema forensics & the drift class (charter §4.3)

Full per-table inventory is in `docs/data/DATA-DICTIONARY.md` (748 tables with columns, org column, FK, index,
DDL presence, liveness). Headlines:

- **748 tables; 714 live; 1 test-only; 33 dead.** 372 (49.7%) declare zero FK constraints; 86 org-scoped tables
  lack even the FK to `organizations.id`.
- **Heavy duplication:** `conversations` and `messages` are each defined **twice** with the same SQL name and
  different shapes; 6 conversation tables, 16 message tables, 11 memory tables (three design generations), 17
  audit tables, 6 task tables. A large never-created "AI company simulation" cluster (`war_rooms`,
  `board_meetings`, `ceo_briefings`, ~50 tables) is still referenced by live-looking services — a
  deletion-ledger candidate an order of magnitude larger than the 7-table drop already executed.
- **One genuinely excellent piece:** a real transactional outbox (`outbox` + `outbox_dlq`, claim/orphan-reaper,
  dedicated Fly worker) for accounting ops.

### The `users`-table drift incident, reconstructed

On **2026-05-29**, a commit added `users.acquisition_utm` with a migration file on disk but **not mirrored into
`scripts/migrate.mjs`**. Because Drizzle issues a full column-list `SELECT`, every login/hydrate began issuing
`SELECT`s for a column production didn't have — **a 500 on every authenticated request, roughly every 3 seconds**,
for a ~67-minute window until the hotfix. It was not the first (notes columns, 2026-04-19, created the
`release_command` pattern) and not the last (organizations missing 32 columns).

### Is the drift class still possible today? **Yes.**

The structural cause is intact. Production's **only** DDL path is `scripts/migrate.mjs` — an ~8,700-line
hand-appended idempotent SQL array run as the Fly `release_command`. The 224 files in `migrations/` are applied
by nothing; the Drizzle journal was abandoned at `0017`. Three specific holes:

1. **The migrate-mirror CI check is presence-only** — any touch of `migrate.mjs` passes; it has a
   `[no-migrate-mirror]` bypass; and it fires only when a `migrations/*.sql` file changes, so a `schema.ts`
   change with no migration trips nothing. Proof the door is open: **91 live tables have no CREATE statement in
   either path** (they exist in prod only from Replit-era `drizzle-kit push`; a rebuilt staging/DR environment
   lacks all 91).
2. **`migrate.mjs` downgrades "relation/column does not exist" to a non-fatal skip** on every deploy — a
   statement with a missing prerequisite silently *never applies*, forever, while the release stays green.
3. **All three schema guards are blind to `shared/models/auth.ts`** — i.e. to the `users` table, the incident's
   own table. The runtime drift detector, the CI column validator, and the org-index lint each parse a different
   subset and none watches `users`. The detector, when it does fire, files a *medium* inbox item up to 24h later.

The audit's fix (charter-aligned, agent-automatable with one founder-supervised prod window): execute the
migration-guide's own cutover — snapshot prod, `drizzle-kit introspect`, regenerate the journal, switch the
release command to generated migrations with `migrate.mjs` kept one release as fallback, delete the
expected-failure patterns the same day — then add a CI job that boots a clean Postgres, runs the real migration
path, and `SELECT`s one row per `pgTable`, failing on any orphan. **This is the single most important Phase 1
item; it closes the incident class permanently.**

### Charter data demands — current state

- **Postgres RLS:** none anywhere. Tenant isolation is 100% application-layer WHERE clauses across ~400
  org-scoped tables. (Aspirational — ASP-1.)
- **Bitemporal modeling:** none on parcel/valuation/assessment data. `parcel_observations` is a genuine
  single-axis observation ledger; "what did we believe parcel X was worth on date Y" is unanswerable. (ASP-5.)
- **Transactional outbox:** present and well-built for accounting ops; not the universal pattern (ASP-2).

---

## 4. Invariants (charter §4.4)

Extracted in full to **`docs/INVARIANTS.md`** — 20 current invariants (money, rails, hard stops, nav, truth,
tenancy, audit, ledger, schema, expansion) each with statement, enforcement kind + file refs, and gap; plus 5
aspirational invariants the charter demands that do not yet exist (RLS, universal outbox, universal idempotency,
enforced audit coverage, bitemporal parcel truth), clearly marked.

The governance spine is unusually strong and **real** — all five constitutional hard stops are machine-enforced
and the enforcement tests pass when executed (140 governance/ratchet tests green). The weakness is uniform:
**enforcement is lane-scoped and opt-in at the edges.** The strongest single pattern in the repo is the
bidirectional ratchet (count-above-baseline fails *and* count-below-baseline fails, with dated justification
ledgers) — it is the template to extend to layering, schema-migration parity, and audit coverage.

---

## 5. Test-reality assessment (charter §4.5)

"Thin coverage" is stale in volume, half-true in substance, and the real finding is **quality bimodality**.

- **The blocking gate runs green with zero infrastructure.** The full vitest suite — **754 files / 10,290 tests**
  — passes in ~301s with **no database, no network, no credentials** (`tests/setup.ts` hard-codes a dummy
  `DATABASE_URL`; CI runs it with no Postgres service). Measured server+shared line coverage is ~18%.
- **Modern money/send/tenancy tests are genuinely strong** — real modules, port-injected I/O: ACH autopay
  idempotency, credit-pool fail-closed, DNC scrub, TCPA quiet-hours math, note amortization (1,000 randomized
  schedules, zero mocks), the money-custody chokepoint. These are the best-covered paths in the repo.
- **But ~88 unit files and 14 of 16 "integration" files are tautologies** — they import *no app code* and
  re-implement the logic inside the test (`multiTenantIsolation`, `stripeWebhooks`, `acreOSValuation`,
  `encryption`, `accountLockout`, `gdprService`, `doddFrankChecker`). They pass forever regardless of product
  behavior. `tests/integration/` is a directory that **lies to the fleet**: any agent judging refactor safety by
  enumerating test files will be deceived by the names.

### Load-bearing gaps

- **The production migration mechanism (`migrate.mjs`) is executed by no test or CI job** — CI provisions schema
  via a *different* mechanism (`drizzle-kit push --force`). Every deploy bets prod on an untested script that has
  already 500'd prod once.
- **Cross-tenant isolation is never attacked against real SQL in CI.** The only real IDOR harness
  (`tests/security/idorFuzz.ts`) covers 8 of ~89 org-scoped `:id` routes and runs in **no** workflow. Isolation
  — the company-ending failure mode — is unverified before deploy.
- **The core AVM comps math is untested** (the real service is touched only on its refusal branch; the mirror
  test re-implements a *better* algorithm than what ships).
- **The AI eval gate exits 0 without an API key**, so a prompt regression can merge behind a green check.
- **The real Clerk auth funnel is untested everywhere** (all CI uses the `E2E_TEST_AUTH` bypass).
- **`client/` has zero test files** and is excluded from coverage.

### Ratchets

All 13 tracked ratchets are at baseline with **zero stale** (the factory is bidirectional, denying stale-high
headroom): table-count 748, founder routes 82, unenforced hard-stops 0, unreviewed statutes 29, orphan tables
95, `as-any` 1417, coverage floor 18 + 12 per-file money/send floors. The risk is *stall*, not staleness —
`runScheduledJobs.ts` sits unmoved at 5,848 lines under its shrink ratchet.

The one real-infrastructure CI layer that *does* meet the charter's "no mock-only validation" bar is
`e2e-mobile` + `customer-surface-monitor` (real pgvector Postgres, a genuinely realistic seeded two-org fixture,
really-signed webhooks). **Refactors of `storage.ts` and `runScheduledJobs.ts` are currently unverifiable** and
must wait for characterization coverage.

---

## 6. Blast-radius inventory (charter §4.6)

Full inventory in **`docs/audit/BLAST-RADIUS.md`**. 18 paths graded against the five-part standard (idempotency,
dry-run, cap, approval, audit). Most are **complete** — ACH autopay and admin recovery are reference-grade. Five
confirmed bypasses, ranked, are the highest-priority Phase 1 work. The single **critical** one:

> **The customer-facing support LLM holds an uncapped platform-Stripe money tool.** `apply_billing_fix` can apply
> arbitrary customer credits (`stripe.customers.update(balance: -amount_cents)`, no bound), pay invoices, and void
> invoices, reachable from customer-authenticated support chat that exposes the full tool catalog. The only
> "approval gate" is the sentence "Requires customer confirmation" in the tool description. It writes `paxMemory`,
> not `audit_events`, and bypasses `checkHardGuardrails` and `financialAuthorityGate` entirely — a prompt-injection
> surface directly on money. The autonomous resolver variant correctly excludes these tools; the interactive lane
> does not.

This is the constitution file's own opening cautionary tale — doctrine in prose while code says otherwise — now
living inside an LLM.

---

## 7. Domain-truth gaps & moat readiness (charter §4.7, §7)

The charter's thesis is correct: the two ceiling-changing capabilities are **citable land valuation** and
**pre-spend screening**. Both sit on an excellent honesty chassis (refuse-not-fabricate is genuinely implemented,
the free open-data plane is the strongest moat asset present) but **both are demo-grade today.**

### Land-attribute checklist (modeled / populated / surfaced / used-in-logic)

| Attribute | Modeled | Populated | Surfaced | **Used in valuation or screening** |
|---|---|---|---|---|
| Legal vs physical access / landlocked | physical only | OSM 500m proxy | yes | value ±; "dealbreaker" off a **physical proxy with no legal-access data** |
| Road frontage (linear feet) | **no** (distance hardcoded to search radius) | no | no | boolean only, in an untrained model |
| Acreage-bracket price nonlinearity | **no** | n/a | no | implicit 0.5–2.0× comp band only |
| Slope / topography | yes | **yes (real 3DEP)** | yes | barely — text field only; real slope never reaches valuation |
| FEMA flood zone | yes | **yes (live)** | yes | partial (property-id route only; bulk passes `undefined`); **never screens spend** |
| Wetlands % | yes | **yes (live)** | yes | **no** (not a valuation field) |
| Zoning | yes | config-dependent | yes | yes (substring adjustments) |
| Utilities | yes | owner/provider | yes | yes; but `utilities.water` mis-proxied as `waterRights` (+15%) |
| Perc/septic | yes | **yes (SSURGO)** | yes | **no** |
| Encumbrances / easements | jsonb only | no pipeline | manual | **no** |
| Back taxes / liens | richly | partial (real scraper) | yes | as a *buy* signal, never a value screen |

The pattern is stark: **8 of 11 attributes are modeled and honestly surfaced on a genuinely working free
open-data plane, but only 4 touch valuation (via hardcoded nudges) and 0 gate any spend.** The data is already
there; it isn't wired to the two decisions that matter.

### Valuation: demo-grade

Comp selection is state + 24-month + acreage-band only — **no geography** (the training table has no lat/long, so
every comp ships a hardcoded `distance = 0` that automatically earns a +15 "nearest comp <5mi" confidence bonus —
quantified confidence inflation, and a live violation of the no-fabrication doctrine). A GPT-4o call silently
moves the final figure up to ±20% while the label stays `comps_model` and its reasoning is discarded. The
flagship unit test never imports the production service. The "trained model" has no artifact on disk and its
retrain job was deleted 2026-08-01, while deal-close comments still cite the "weekly retrain flywheel" as live.
The comps-ingest job that would feed the corpus **was written but never registered** — the moat's data plane
never runs.

### Pre-spend screening: parcel-quality screening does not exist

Spend *hygiene* is real and well-built (pre-mail dedupe at both campaign chokepoints, DNC, $500/mo fail-closed
stop-loss, county-level screen). But **zero flood/wetlands/landlocked checks run before mail or skip-trace spend**
— the single deal-killer engine is single-parcel-only and never runs across a list. There is no projected-
spend-saved metric beyond a duplicate-overlap estimate. `preMailDedupe` already has the exact bucket/breakdown
shape needed; the disqualifier pass is a bolt-on.

### Note servicing: closest to defensible, two verified gaps

Two well-modeled books, exemplary acquired-note refuse-not-fabricate scheduling, an ATR DB-gate, Reg-Z statements,
RESPA early intervention wired. But **late-fee assessment has no production call site** (built, unwired) and
**there is no forfeiture/contract-for-deed lifecycle** even though the platform generates land-contract
instruments.

### Shortest path to defensible (all on data that already exists)

1. Turn on the comps corpus already written, **with geography**: persist lat/long + attributes on
   `transaction_training` (the ingest fetches then drops them), register the ingest job, promote the test file's
   haversine+attribute `selectComparables` into the production service. Unblocks everything else. **(S–M)**
2. Bolt a parcel-quality disqualifier onto the two existing chokepoints: batch cached free enrichment (flood,
   wetlands %, road proximity, slope) over campaign lead IDs inside `runPreMailDedupe` and the skip-trace batch;
   add a `parcelDisqualified` bucket + `spendSavedCents`. Delivers charter capability (2) in one wave on free
   data. **(M)**
3. Make every figure citable: remove the ±20% GPT-4o nudge from the comps path (or downgrade its label), compute
   real distances, delete the fake-distance confidence bonus, persist adjustment rationale, render per-comp
   provenance chips. **(S–M)**

---

## 8. The 30 critiques (charter §4.8)

Each attributed to the seat that raised it, most-severe first. Effort: **S** <1wk · **M** 1–4wk · **L** 1–3mo ·
**XL** 3mo+ (calibrated for a solo founder driving a fleet of coding agents).

| # | Seat | Critique | Remedy | Effort |
|---|---|---|---|---|
| 1 | Principal Security Engineer / CISO | The support-chat LLM executes uncapped `stripe.customers.update(balance:-amount)`, `invoices.pay`, `voidInvoice` from a customer-driven loop; the "confirmation" is prose in a tool description; no cap, no gate, no `audit_events`. Every hard guardrail is scoped to a different lane and never sees this call. | Remove the mutation tools from the interactive catalog (the `paxSupportResolver` subset shows the shape); if credits stay, route through `financialAuthorityGate` with a per-ticket cap + chained audit; ratchet the interactive tool set ⊆ an allowlisted read/draft set. | **S** |
| 2 | Staff SRE | The prod migration mechanism (`migrate.mjs`) is executed by no automation; CI uses a different mechanism; 95 tables have no CREATE anywhere; the script downgrades missing-relation errors to skips. Every deploy bets prod on an untested script that already 500'd prod once. | One CI job: boot clean pgvector, run `migrate.mjs`, boot server, `SELECT` one row per `pgTable`, fail on any orphan — converting the 95-orphan baseline into a burn-down list. | **M** |
| 3 | Staff Data Engineer | Prod's only DDL path converts "relation does not exist" into a warning and can silently never-apply a statement forever; the cutover plan has sat unexecuted since 2026-05-06, and its blocker (no staging DB) is gone. | Execute the migration-guide cutover: snapshot, introspect, regenerate journal, switch `release_command`, keep `migrate.mjs` one release as fallback, delete expected-failure patterns same day. | **M** |
| 4 | Principal Security Engineer / CISO | The BYO counterparty-mail hard rule is an *optional parameter defaulting to the violating lane*; ~8 of 42 callers opt in; the agent-skills `sendEmail` skill (example: `seller@example.com`) is a live bypass fronting the platform identity for deal mail. | Make `purpose` required at the type level (or default `counterparty`); fix the skill same commit; add the source ratchet the constitution already marks owed. | **S** |
| 5 | Staff Backend Engineer (Platform) | Zero RLS with ~400 org-scoped tables means one missed WHERE in ~700 handlers is a cross-tenant leak; the repo's own history has IDOR fixes and an AI-cache cross-tenant leak. | Pilot RLS on the 10 hottest tenant tables via a per-transaction `SET LOCAL` GUC in the db wrapper (additive, no query rewrites), with a down-only "tables without RLS" ratchet. | **L** |
| 6 | AI Evals Lead | 88 unit files + 14/16 "integration" files import no app code and pass forever; `tests/integration/` deceives any agent judging refactor safety — the exact self-report failure CLAUDE.md's wave discipline warns about. | Land a meta-test failing any `tests/unit` file that imports no app module (allowlist the ~19 fs-based ratchets); rewire the top ~15 by risk; rename/delete the integration fiction. | **M** |
| 7 | Staff ML/AI Engineer | The AI guardrail plane is opt-in: 23 non-test files hold a raw model client and perform zero cost/guard/telemetry calls — per-org caps, output guards, tracing, and margin attribution are convention, not construction. | Finish the `routeAITask` migration (the repo's own doc calls it mechanical) and add a no-new-bypass ratchet failing on any raw client outside `aiRouter.ts`. | **M** |
| 8 | FP&A Lead | Bypass AI spend is invisible to the only fail-**closed** cost ceiling (it sums a telemetry table the bypasses never write) — the one gate that "always holds" cannot see the runaway-loop spend it exists to stop. | Before the full migration lands, wrap `requireOpenAIClient` itself with a metering+ceiling shim so even unmigrated callsites are counted and capped — one file at the existing chokepoint. | **S** |
| 9 | General Counsel | The consent-evidence chain **fabricates a fact**: absent a client value, `lead_consent_events` records `checkboxChecked:true` — manufactured evidence in the table built for plaintiff discovery, against the no-fabrication hard rule. | Record `null` when absent (schema allows it), mark backfilled rows "defaulted," add the consent path to `lint:no-fabrication`. | **S** |
| 10 | General Counsel | Revocation is frozen in 2024: two divergent exact-match STOP keyword sets (neither includes "revoke"), no any-reasonable-means fallback, an advertised `mailto:unsubscribe@` no code reads — against FCC rules tightened April 2025. | Unify into one keyword constant with all FCC per-se words; route ambiguous refusals to a suppress-by-default triage queue; wire or stop advertising the mailto; pin with a test deriving honored keywords from the single constant. | **M** |
| 11 | VP Acquisitions | The platform meters spend beautifully yet will still pay postage and skip-trace on a parcel its own free data already knows is 80% wetlands in Zone VE with no road within 500m — `preMailDedupe` has the exact shape and screens none of it. | Add an enrichment-backed disqualifier pass inside `runPreMailDedupe` and the skip-trace batch; add a `parcelDisqualified` bucket + `spendSavedCents` on the send dialog. | **M** |
| 12 | Staff Appraiser (land) | Nothing in the valuation would survive appraisal review: county-level comps with no location, hardcoded `distance=0` inflating confidence +15 every run, similarity awarding 30 pts for two empty zip strings, invented adjustment %, a silent ±20% GPT-4o move under a "comparable sales" label — while the test suite green-lights a better algorithm that exists only in the test. | Persist lat/long+attributes (ingest already fetches then drops them), promote the test's `selectComparables` into production and convert the mirror test to a real one, remove/relabel the LLM adjustment, derive coefficients from paired sales as the corpus fills. | **L** |
| 13 | Distinguished Engineer / Chief Architect | The schema barrel is the system's center of gravity, not a schema: 18,524 lines, 744 tables, 977 importers, 438 commits, and a value-level cycle making the 77-slice decomposition cosmetic — no context can own its tables and every wave contends on one file. | Create `shared/schema/core.ts` for the FK-target tables, repoint slice imports to it, make `schema.ts` a pure re-export DAG, add a ratchet forbidding slice→barrel imports. | **M** |
| 14 | Note Servicing Lead | The best-modeled domain still can't do the two things a note servicer is hired for: assess a late fee (module unwired — its own header admits it) and run a default through the correct remedy (no forfeiture/CFD lifecycle in `notes.status`) — while the platform generates the very land-contract instrument that requires it. | Wire `assessLateFee` from the aging job behind per-org config with the existing 1026.36(c)(2) guard; add a CFD/forfeiture state machine from the per-state cure data already present — or explicitly refuse CFD origination until it exists. | **M** |
| 15 | Group PM (Acquisition) | The moat's learning-loop is fiction in three places the team believes it: deal-close comments cite a "weekly retrain flywheel" deleted 2026-08-01, the comps ingest that would feed it was never registered, the GBM artifact doesn't exist — each wave verified only its own part. | Pick one corpus strategy (register the ingest or delete it), reconcile the stale comments, add a ratchet asserting every exported queue/worker has a registration call site. | **S** |
| 16 | Staff Backend Engineer (Platform) | The 71-file routes↔services↔jobs↔ai cycle hangs on ~12 inverted edges — each a function born in a route file and never moved. | Extract those functions into services (hours each), then add a layering rule to `check-boundaries.mjs` at baseline 0: services/jobs may never import `routes-*`; routes may not import routes. | **S** |
| 17 | Staff SRE | Idempotency is opt-in where someone was scared enough: ACH got a dual-layer guard, but the mail pool debit keys on `Date.now()` (retry double-debit), phone purchase has no key, the middleware fallback is per-process on multi-machine Fly, and the public-webhook retry worker is an unwired scaffold. | Derive the mail debit key from content + client key; make Redis mandatory for idempotency in prod (fail loud at boot); register or delete the webhook retry poller. | **M** |
| 18 | Chief Data Officer | 33 dead tables, 91 live-but-never-created, a `marketIndicatorsDuplicate`, and two physically-competing definitions mean no trustworthy data dictionary exists — so every wave re-learns the schema by grep and sometimes re-invents tables. | Commit the generated inventory as a CI-regenerated artifact with a ratchet (dead + no-create counts may only shrink); run the 33 dead tables through the deletion-ledger drop process. | **M** |
| 19 | Head of Customer Success & Support | Support debugs every ticket blind: the impersonation endpoint writes an audit row into the *target's own* activity log and returns `readOnly`/30-min claims no middleware enforces and no client calls — fabricated guarantees against the no-fabrication constitution. | Build real read-only impersonation on the scaffold: short-lived signed token (founder id + org + expiry), a middleware branch that swaps `organizationId` and hard-blocks mutations, founder-visible audit on start/end, a persistent banner, a "View as" button in `inspector/org`. | **M** |
| 20 | Principal Frontend Engineer | Every map view ships two complete WebGL engines (`mapbox-gl` + `maplibre-gl` both statically imported and chunked together) while the 600KB bundle gate sits in no workflow and exits 0 when `dist/` is absent — the perf fence for the core surface is decorative. | Make the engine import dynamic behind `getMapEngine()`, split per-engine chunks, add `test:bundle-size` to CI after build, fail (not skip) when `dist/` is absent. | **S** |
| 21 | Developer Experience Lead | ESLint is blind to 54% of the codebase (`server/**` ignored), so 558K LOC of Express gets only regex ratchets — which can't express scoped import bans or per-directory layering. | Extend the flat config to `server/**` with `no-restricted-imports` (layering + deep-import bans), gated through the existing eslint-ratchet so legacy violations baseline instead of block. | **M** |
| 22 | Design Systems Engineer | Token primitives are hand-duplicated: each of 10 theme blocks carries a raw-hex set and an "HSL parallel — keep in sync" twin with no generator and no parity test; the hex ratchet patrols only `pages/` while `components/` holds 187 of 228 raw literals. | Author one DTCG-shaped token source, generate the theme blocks from it, add a hex↔HSL parity test, extend the hex ratchet to `components/` with chart/map palettes baselined. | **M** |
| 23 | Head of Design | Accessibility measurement is theater: the axe e2e spec silently no-ops (`@axe-core/playwright` never installed), `.pa11yci.json` is referenced by nothing, and `accessibility.test.ts` still "samples" the deleted `founder-dashboard.tsx` in a try/catch — three green-looking layers asserting nothing, hiding genuinely good fundamentals. | Install the dep and fail on missing; wire the 10-URL pa11y set into the e2e workflow; rewrite the unit test to fail on missing files and glob its icon-button list. | **S** |
| 24 | AI Evals Lead | The eval gate can be walked around three ways (not a required check, exit-0 on missing key, deploys gate on tests only) while `DATA_GROUNDING_EVAL_GREEN` — which authorizes cheap-model routing on customer turns — is a hand-set `true` constant, and the golden set is 80% uncurated since May. | Make eval-gate a required check; fail (not skip) on missing key for same-repo PRs; derive the flag from the latest eval-run row; schedule curation of the 40 entries. | **S** |
| 25 | Principal Product Designer (data-dense) | The field-capture loop loses revenue data at its moment of use: DriveMode fires a bare POST and discards the GPS point on network failure, while the purpose-built `useOfflineSync` idempotent queue is consumed by nothing but the offline indicator — same built-but-unwired pattern strands `VirtualTable` and `bulk-action-bar` while three pages hand-roll bulk toolbars. | Route DriveMode quick-add/photo (and CourthouseMode bids) through `queueMutation` with optimistic echo; in the same wave wire or delete `VirtualTable` + `bulk-action-bar`. | **M** |
| 26 | Licensed Broker / Compliance Advisor | The assignment-*document* gate is best-in-class, but the act regulators police — *marketing* property you don't own — is warn-tier only: FL §475.42 → warn, and buyer-blasts / disposition / marketplace never call the gate, so a FL wholesaler can blast an un-closed parcel with no equitable-interest disclosure. | Call `checkAssignmentCompliance` from buyer-blasts and disposition/marketplace keyed on contract state; auto-inject the state's equitable-interest disclosure into generated copy; add wholesaling entries to the statute register so the gate is ratcheted. | **M** |
| 27 | Note Servicing Lead | Dwelling-secured — the master switch for the whole residential regime — defaults to "no duties" on both books: originated notes accept `atrExemptionCode='raw_land'` with no cross-check against the linked property (a mobile-home parcel can be exempted undetected); acquired notes default `collateralIsDwelling=false` pending a manual backfill no ratchet tracks. | Derive collateral class from the linked property record and refuse contradicting exemptions at create/update; nightly reconciler surfacing dwelling-contradicted exemptions as a shrink-only count on the founder letter. | **L** |
| 28 | CFO | Spend controls are strong per-lane but there is no single ledger where every dollar of COGS and every AI-forgiven dollar of revenue lands — provider lookups, agent spend, Solene, and support-agent credits post to four different places, so the cost door can be green while an LLM quietly rebates revenue. | Route every autonomous money effect through `financial_ledger` with a lane tag; add one cross-lane monthly ceiling check summing all lanes in `getBudgetSummary`. | **M** |
| 29 | Staff Backend Engineer (Platform) | The storage decomposition is measured by the wrong ratchet: line count falls but the `DatabaseStorage` god-type still spans all 34 repos (every repo type-imports the facade back) and `storage.ts` re-exports `db` — 178 importers, the seam can never finish under a line-count metric. | Give each repo its own interface so repos stop importing the facade; reduce `storage.ts` to composition-only; add a ratchet counting files importing storage merely for the `db` re-export. | **M** |
| 30 | Chief Data Officer | The stated moat — longitudinal parcel truth — stops one axis short: observations record *when a fact was seen* but valuations have no valid-time, so "what did we believe this parcel was worth on date X" (the query that defends a vendor dispute) is unanswerable. | When the valuation surface is next touched, add `validFrom/validTo` + a supersedes chain to `valuation_predictions` and derive current as a view — do not attempt bitemporality across 748 tables. | **L** |

**Where the board split:** the Chief Architect and the CPO disagree on sequencing the schema-barrel split (#13)
vs. leaving it frozen. The architect wants `core.ts` early because it unblocks every context extraction and
reduces fleet merge-contention; the CPO notes it touches the 977-importer spine with thin characterization
coverage and would rather spend Phase 1 capital on the drift fix (#2/#3) and the money bypasses (#1/#4) that
have *live* exposure. **Recommendation: CPO wins the ordering** — barrel surgery is a Phase 1 *tail* item behind
the safety fixes, gated on the migration cutover landing first (so a schema mistake can't silently reach prod).
The architect's objection is recorded, not overruled: `core.ts` stays in Phase 1, just not first.

---

## 9. Sequenced roadmap (charter §4.9, §12)

Gates are **hard**: do not start a phase whose entry gate has not passed. Every phase ends with the platform
better-tested than it started, deployable at every commit, strangler-fig only.

### Phase 1 — Foundation & Safety `[entry: this audit accepted]`
The theme is **make enforcement structural, not opt-in**, and **close the drift class**.
- Close the confirmed money/rails bypasses: support-agent Stripe tools (#1), counterparty-mail default (#4),
  mail idempotency (#17), impersonation enforcement (#19).
- Kill the drift class: migration cutover (#3) + the boot-and-SELECT CI job (#2); point all three schema guards
  at one discover-schema-files helper.
- Meter every AI call: the chokepoint shim (#8) now, the full `routeAITask` migration + no-bypass ratchet (#7)
  behind it.
- Characterization coverage where refactors are blocked: kill the tautology tests (#6), run `idorFuzz` in CI and
  extend it, cover `migrate.mjs` and the AVM comps math.
- Compliance-as-code that runs in parallel from here (charter mandate): consent no-fabrication fix (#9),
  revocation modernization (#10), marketing-gate wiring (#26).
- **Exit:** the drift class is provably impossible (fresh-DB CI job green; zero orphan tables added); no
  outbound/spend path lacks its five gates (blast-radius re-audit clean); the AI cost ceiling sees 100% of spend;
  cross-tenant isolation is attacked in CI. **Revisit trigger:** any new confirmed bypass, or an orphan-table
  count increase.

### Phase 2 — Valuation & Screening `[entry: Phase 1 exit]`
The moat, on data that already exists.
- Turn on the geographic comps corpus (shortest-path #1); make every figure citable (#12, remove the ±20% nudge,
  real distances, provenance chips).
- Bolt parcel-quality screening onto the two existing chokepoints with a `spendSavedCents` metric
  (shortest-path #2 / #11).
- **Exit:** valuation carries full comp lineage + honest confidence and beats incumbent comp quality in blind
  domain-expert review; pre-spend screening demonstrably reduces wasted contact spend on a real list. **No AI
  number ships without provenance; no valuation feature ships without a passing eval gate** (#24 first).
  **Revisit trigger:** the parcel-licensing decision card (ruling #14) if the nationwide layer is needed.

### Phase 3 — Surface Transformation `[entry: Phase 2 exit]`
- One DTCG token source + parity test + `components/` hex ratchet (#22); dynamic map engines + real bundle gate
  (#20); accessibility measurement made real (#23); wire `VirtualTable`/offline-sync/bulk-bar or delete them
  (#25); the schema-barrel `core.ts` split (#13, gated behind Phase 1's cutover).
- **Exit:** p75 INP <200ms held; WCAG 2.2 AA on refactored surfaces (measured, not asserted); zero raw style
  literals outside baselined palettes.

### Phase 4 — Intelligence & Control Plane `[entry: Phase 3 exit]`
- Cross-lane cost ledger (#28); server-side founder-route consolidation mirroring the four-door ratchet; the
  missing control-plane panels (compliance console, cohort/NRR retention, dead-letter replay, real impersonation
  #19 if not already done, metric tree).
- **Exit:** per-tenant gross margin observable including previously-bypassed spend; every founder door genuinely
  phone-usable.

### Phase 5 — Commercial Readiness `[entry: Phase 4 exit + founder release decision]`
- Pricing/entitlements finalized, activation instrumentation, support surface, compliance gates armed (DNC/
  CAN-SPAM secrets, LLC per the runbook's $200-MRR trigger), expansion vectors scaffolded **only** as their
  standing ladder triggers fire — not before.
- **Exit:** the expansion ladder's own criteria, honored.

**Standing dependency:** compliance work (§10) runs in parallel from Phase 1, never at the end.

---

## 10. The three decisions that most change this product's ceiling

### Decision 1 — Wire the free data plane to the two decisions that matter (valuation + spend screening)
**Why it's the ceiling:** the charter's own thesis, confirmed by the audit — land valuation and wasted
mail/skip-trace spend are the category's unsolved problems, and AcreOS *already has* a genuinely working free
open-data plane (FEMA, NWI, SSURGO, 3DEP) feeding 8 of 11 land attributes with provenance. Today that data
reaches neither the valuation nor a single spend gate. This is the rare high-ceiling move that is also
low-effort and low-risk because the hard part (the data plane) is built. **What I need from the founder:**
nothing to start (it's all on existing free data) — but a decision on the **valuation confidence bar** for
launch: is a comps-based figure with honest "insufficient data" refusals acceptable for first customers, or must
the geographic corpus fill first? That gates whether Phase 2 ships behind a "beta valuation" label.

### Decision 2 — Make AI-money and AI-output enforcement structural before the first customer touches it
**Why it's the ceiling:** the platform's whole promise is autonomy the founder can trust. One prompt-injection
on the uncapped support-agent Stripe tool, or one cross-tenant leak through a missed WHERE clause, is a
company-ending event *and* a trust-ending one — and both are live today. Closing them (bypass fixes + the AI
metering shim + an RLS pilot) converts "trust by convention" into "trust by construction," which is the only
kind that survives contact with real money. **What I need from the founder:** a ruling on the support-agent
credit tool — should support ever be able to apply a customer credit autonomously at all, and if so, at what
hard per-ticket ceiling? (My recommendation: remove it from the interactive lane entirely; credits go through
the founder-gated spend path.)

### Decision 3 — Resolve the LOC/table target vs. build-all-verticals conflict, and adopt generated state preambles
**Why it's the ceiling:** this is the meta-decision that keeps every other one honest. Two standing founder
decisions are in direct conflict (≤600K LOC / ≤450 tables vs. ruling #11's build-everything, which produced
1.04M / 748), and the entire charter was mis-scoped because it was written from a four-month-old memory while the
machine held the true numbers. Until the target conflict is adjudicated, every wave silently picks a side; until
planning inputs are generated, every plan starts wrong. **What I need from the founder:** (a) a decision-card
ruling — reaffirm, rescind, or re-scope the H2 shrink targets against ruling #11, recorded in the deletion ledger
and CLAUDE.md the same day; and (b) a yes on making a generated state-of-the-company preamble mandatory at the top
of every future charter/roadmap (small script; the instruments already exist).

---

*Phase 0 ends here. Per the charter (§4, §15, §16): no production code has been written. The next step is founder
acceptance of this audit and roadmap before any Phase 1 implementation begins.*
