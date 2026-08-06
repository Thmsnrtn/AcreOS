# 00 — Orientation & Regression Check

*Phase 0, primary lane. Read-only. This is the run's only human checkpoint.*

---

## TL;DR (read this on your phone)

- **The immune system is real and mostly honest.** 8 ratchets, 22 lints, 6 ESLint rules, a machine-readable constitution, ~661 test files. All 12 P0 defects from the registry **still hold at HEAD** — I re-verified each against code, not the report.
- **The naive findings are found and gated.** `(req as any)`=0, monolith deleted, routes split, `console.log` clamped. Reporting any of that would mean I didn't read the priors.
- **Value is in three gaps** (unchanged from the brief's thesis, now confirmed): (1) defect classes that survive *every* gate — the `sql.raw` class and the `: any` class are the two clearest, both ungated; (2) ledger rows that have gone stale — I already found one resolved defect still marked OPEN and one schema file mislabeled; (3) the path to the first paying customer, which no gate measures at all.
- **The shrink campaign has a long way to go.** ~1.04M LOC vs ≤600K target (**gap ~440K**); 748 tables vs ≤450 (**gap 298**). Improvement here means *shrink faster and verify the shrink*, not add.
- **Unenforced hard-stops: 0.** All 5 constitutional hard-stops are code-invariant + tested. The 2 prose-only items are not hard-stops (expansion ladder, Pax-ambient).

**Recommendation: approve, and I run the 21-slice fan-out + gate analysis to the finish.**

---

## Ground truth, re-measured at HEAD (`5ca0f29`)

Section 1 was compiled by another instance and warned it had "already been wrong twice." Here is what I measured myself:

| Metric | Section 1 claim | Measured at HEAD | Verdict |
|---|---|---|---|
| Repo TS/TSX LOC | ~1.04M | **1,039,751** | ✅ exact |
| `server/` LOC | ~558K | **558,070** | ✅ |
| `server/services/` | ~366K / 991 files | **366,284 / 991** | ✅ |
| `client/` LOC | ~272K | **272,222** | ✅ |
| `shared/` LOC | — | **43,635** | — |
| `solene/` / `autopilot/` | 49.7K / 19K | **49,703 / 18,992** | ✅ |
| `pgTable` count | ~745–748 | **748** (500 in schema.ts + 248 across 77 files in schema/) | ✅ |
| Route files | 276 | **275** (`routes-*.ts`) | ✅ ~ |
| Ratchet baselines | as-any 1417, res-status 507, table 748, console 6, req-as-any 0 | **all confirmed** in `scripts/ratchets/*.json` | ✅ |
| `console.log` in server | ~7 (ratchet 6) | ratchet baseline **6**, direction down | ✅ |

**Section 1 is trustworthy on the numbers.** Its one framing error is the marketplace-churn claim (below).

### The marketplace-churn puzzle — solved

Section 1 flagged: "`shared/schema/marketplace.ts` churns *despite marketplace being FREEZE-verdicted* — understand why." **Answer: the churn is deletion, not construction.** At HEAD, marketplace.ts *lost* 88 lines — it was where the dead `voiceCalls` and `satelliteSnapshots` table definitions physically lived, and the KILL wave removed them. The file is a **grab-bag**, not a marketplace module: it also holds `courses`, `courseModules`, `courseEnrollments`, `regulatoryChanges`, `complianceAlerts`, `whitelabelTenants`, `stripeProcessedEvents`, `processedWebhookEvents`, `esignWebhookEvents`, `photoAnalysis`, `transactionTraining`, `valuationPredictions`, `landCreditScores`. So "27 tables in marketplace.ts" overstates the frozen surface. **No FREEZE violation — marketplace is being shrunk, not polished.** (Handed to slice 05 + ledger reconciliation.)

---

## What the immune system covers

**Ratchets (`scripts/ratchets/`, bidirectional — exceeding *or* beating a baseline fails until re-locked):**
- `as-any` (1417), `res-status-raw` (507), `table-count` (748), `req-as-any` (0), `console-in-server` (6), two god-file line counts (`runScheduledJobs.ts` 5848, `storage.ts` 1682), and an **external reachability** ratchet (4 counts: unreachedExports 655, tablesNoWriter 45, tablesNoReader 57, unregisteredRoutes 1).
- The reachability ratchet is the repo's answer to its own most-common defect ("built but unwired") — it converts a recurring manual audit into CI. **This is the single best gate in the repo.**

**Constitution (`shared/governance/constitution.ts` + `constitution.test.ts`):** 5 hard-stops, all code-invariant + tested; test pins `hardStops().length === 5` and `unenforcedHardStops ≤ 0`. Mirrors the CLAUDE.md DO-NOT-DO list into a checkable form.

**22 lints in `npm run check`** (verified in package.json): `lint:no-fabrication`, `lint:org-fetch` (org-scoped-fetch), `lint:reachability`, `lint:boundaries`, `lint:kernel-boundary`, `lint:contract-adoption`, `lint:schema`, `lint:zindex`, `lint:translucency`, `lint:css-hover`, `lint:page-hex`, `lint:prefetch-authority`, `lint:date-format`, `lint:browser-safe-shared`, `lint:route-order`, `lint:eslint-ratchet`, etc.

**~661 test files**, an eval harness (`evals/`, LLM judge scoring one 0–1 tone score for Pax), a defect registry (72 audit files / 150 lenses → `DEFECT-NNNN`), a deletion ledger, a design-gap inventory (`handoff/GAPS.md`).

## What it demonstrably does NOT cover (early — full analysis in Phase 1)

1. **The `sql.raw` class.** 38 `sql.raw(` sites repo-wide, gated by *nothing*. DEFECT-0002's two specific sites are gone (maintenance route deleted; supportAgent uses a hardcoded field whitelist + parameterized term). But the *pattern* recurs: `archival.ts` interpolates `ids.join(",")`, `investorStatementBatch.ts` hand-escapes quotes, `founder-chat/db-ops.ts` executes assembled SQL. Most look controlled; none are gated. → slice 07 + T4.
2. **The `: any` class.** ~3,731 annotations in server/shared/client (excl. tests) — the uncounted sibling of the ratcheted `as any` (1417). A `: any` on a tenant key or money value is exactly the `leads.organizationId`-widening class the ratchet exists to stop, and it walks straight through. → slice 06 proposes the follow-on ratchet.
3. **The eval matrix is ~1 cell of ~40.** One surface (Pax) × one dimension (tone) × one judge (Haiku). Factual grounding, tool-call correctness, refusal, and injection resistance are unjudged across Sophie/Solene/support/executive. → Phase 1 + slice 08.
4. **No gate sees "fabrication from empty sets."** `lint:no-fabrication` is a regex; it cannot see an aggregate over zero rows rendered as `0`, a default shown as data, or an integration failing open into empty success. → Phase 1 (deepest analysis) + T3.
5. **Nothing measures the first-customer path.** Acquisition and week-one trust are defect classes no ratchet touches. → T1, T5.

---

## Regression check — every FIXED P0, re-verified at HEAD

Method: grep the evidence pattern + read the resolving ground. **All hold.**

| Defect | Was | At HEAD | Holds? |
|---|---|---|---|
| 0001 — 381 unauth founder/SCP handlers | 377c4db | `scp-v2` mounts `isAuthenticated+requireFounder`; sovereign-integration handlers covered by path-prefix guards at routes.ts:1848–1857 (registered before the handlers) | ✅ |
| 0002 — SQL injection via `sql.raw()` | 377c4db | `routes-maintenance.ts` deleted; supportAgent `sql.raw(f)` uses hardcoded whitelist + parameterized term | ✅ (but class ungated) |
| 0003 — tsc no-op (`noResolve`) | 1c49712 | `npm run check` runs real `tsc --noEmit` + 17 lints | ✅ |
| 0004 — recursive logger shadow | 9354168 | zero `const logger` shadows in the 4 files | ✅ |
| 0005 — payment race | 53d38f5 | `createPayment` wraps `withTransaction` + `SELECT FOR UPDATE` + optimistic version lock | ✅ |
| 0006 — Stripe webhook TOCTOU | 377c4db | `INSERT … onConflictDoNothing().returning()` atomic claim | ✅ |
| 0007 — credit allowance TOCTOU | 377c4db | `onConflictDoNothing` on both `applyMonthlyAllowance` | ✅ |
| 0008 — unsigned webhooks | 377c4db | Meta `x-hub-signature-256`; inbound-email `verifyInboundEmailSignature` (SNS+HMAC) | ✅ (Dropbox Sign path: verify in T2/07) |
| 0009 — SSRF missing await | f8c476d | `await validateUrl(...)` | ✅ |
| 0010 — unbounded LLM loops | 19e942c | `MAX_TOOL_ITERATIONS=10` in vaService, supportAgent, executive | ✅ |
| 0011 — chargebacks dropped | 377c4db | `charge.dispute.created/updated/closed` handled | ✅ |
| 0012 — destructive migration | 377c4db | `0020` now `IF EXISTS` + `TRUNCATE` guarded behind "no Clerk users" check | ✅ |
| 0019 — tenant isolation in storage | 5cfbf6e | + `lint:org-fetch` gate live | ✅ |
| 0020 — Twilio sig | — | `verifyTwilioSignature` on all 3 webhooks | ✅ |
| 0022 — WS cross-org | 29462e0 | org-scoped channels | ✅ (deep re-check in T4) |
| 0026 — ioredis missing | d7b855b | `"ioredis": "5.10.1"` in deps | ✅ |
| 0030 — support agent cross-org | 646489a | `apply_bulk_fix` rejects org IDs ≠ `org.id` | ✅ |
| 0032 — provider_cache unused | 4c27079 | `attom-provider.ts` reads+writes `provider_cache` | ✅ |
| 0071 — deal-room org scope | b6f27e4 | `getDealRoomOrFail` filters `organizationId` | ✅ |

**No P0 regressions.** The gate discipline is working.

### v7 "Known Caveats" — status at HEAD

| v7 caveat (2026-04-19) | Status now |
|---|---|
| No Sentry error tracking | **RESOLVED** — `Sentry.init` + `expressErrorHandler` wired in `server/index.ts:704` (gated on `SENTRY_DSN`). Reliability slice verifies it's *provisioned*, not just installed. |
| No structured logging | **RESOLVED** — `server/utils/logger.ts` mandated + `console-in-server` ratchet. |
| Two onboarding wizards (DEFECT-0059) | **RESOLVED** — `/onboarding-v2` canonical since 2026-05-11; V1 unmounted. **Registry still says P2 OPEN → stale (slice 17).** |
| No public API docs | Still true — deliberate (constitution: no public API <50 customers). |
| No mobile app | Capacitor + Tauri configs present; do they build? → slice 14. |
| AI degrades without OpenRouter key | Still true by design. |

---

## Distance to the H2 targets (the strategic frame)

| | Now (HEAD) | H2 target | Gap |
|---|---|---|---|
| TS/TSX LOC | 1,039,751 | ≤600,000 | **−439,751** |
| Tables | 748 | ≤450 | **−298** |

The campaign is real and active (`as-any.json` / `table-count.json` churn constantly) but **less than halfway** to either target. The single highest-leverage improvement lever in this repo is *executing the ledger's own KILL queue and finding what it hasn't adjudicated* — not adding gates, not adding features. Slice 04 (service sprawl) + Phase 3 (ledger reconciliation) carry this.

---

## Planned slice map (21 fan-out slices + 3 primary-lane files)

**Primary lane (I write these, sequentially):**
`01-gate-coverage.md` (the load-bearing six gates — highest-judgment work, not delegated) → dispatch fan-out → cross-slice verify + dedupe → `03-ledger-reconciliation.md` → `99-master.md` → adversarial pass.

**Fan-out (parallel, one file each, every dispatch carries the binding SLICE BRIEFING):**

*Traces (defects live vertically):*
- **T1** `20-trace-money-in.md` — signup→checkout→webhook→access→limit→dunning→cancel. Verdict: can a stranger pay and reliably get the product?
- **T2** `21-trace-message-out.md` — import→campaign→CAN-SPAM/unsub/DNC→BYO rail→send→audit row. Verdict: what legally/reputationally happens if a customer runs a campaign today?
- **T3** `22-trace-number-provenance.md` — five displayed numbers traced render→…→source table. The fabrication class the lint can't see.
- **T4** `23-trace-tenant-boundary.md` — adversarial cross-org: raw SQL, dynamic tables, jobs, webhooks, exports, singletons, **AI tool-calls**. Any breach = P0.
- **T5** `24-trace-day-one.md` — signup→first useful moment in clicks; empty-account state; GAPS.md Tier-0 surfaces on the path.

*Dimensions:* `04-service-sprawl` · `05-schema` · `06-type-safety` · `07-security` · `08-ai-systems` · `09-correctness` · `10-performance` · `11-frontend` · `12-testing` · `13-reliability` · `14-ux-mobile-a11y` · `15-compliance` · `16-cost` · `17-documentation-drift` · `18-solo-operator`

*Cosmetic:* `02-cosmetic-gates.md` — one table row per cosmetic lint (zindex, translucency, css-hover, page-hex, date-format), covers/misses.

**Depth allocation:** exhaustive for T4 (tenant), T1 (money), T3 (fabrication), slice 08 (`server/ai/`). Stratified elsewhere (every file >1,500 lines + churn top-30 + random 5%), each slice records what it did NOT examine for the coverage ledger.

---

## ⛔ FOUNDER CHECKPOINT

This is the only human gate in the run. **On your approval I proceed autonomously through Phase 1, the 21-slice fan-out, verification, ledger reconciliation, synthesis, and the adversarial pass — producing the full finding set and `99-master.md` with The Ten as ready-to-paste implementation briefs.**

Nothing touches production code. If you want the slice map re-cut (fewer/more slices, different depth), say so now; otherwise I run to the finish.
