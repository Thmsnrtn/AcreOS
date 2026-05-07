# Pre-Vertical Stabilization — Completion Report

**Status:** ✅ **COMPLETE**
**Stabilization start:** 2026-05-04
**Inflection point (deploy v6):** 2026-05-04 19:33 UTC
**Schema-drift sweep complete:** 2026-05-05
**Branch state:** all work merged to `main`; ~30 commits across two sessions, all building.

---

## 🎯 STABILIZATION COMPLETE — 2026-05-05

Production AcreOS now matches what's declared in the codebase. Three blockers were surfaced and resolved during this run:

1. **Deploy chain unblocked** (2026-05-04 19:33 UTC) — three days of failed deploys (silent migrate.mjs aborts + F2 boot guard + Docker layer cache) cleared by the `3a3bff4` non-fatal classifier, the `INBOUND_EMAIL_SNS_ONLY=1` Fly secret, and a `--no-cache` rebuild for v6.
2. **Schema drift fully reconciled** (2026-05-05) — 62 missing tables + 25 missing columns + unaccent extension all landed across §3 Batches 1-9. Verified live in prod via `to_regclass` + `information_schema.columns` + `pg_extension`. **87/87 schema items present.** See [SCHEMA-DRIFT-AUDIT.md](./SCHEMA-DRIFT-AUDIT.md) for the per-batch table and parked items.
3. **Worker hot-loop resolved** — the outbox-poll loop went from `~12 errors/min` (B1) → `~10/min` (B1+stale schema) → `~9/min` (the ::text[] cast attempt) → **0/min** after switching to `IN (sql.join(...))`. See §3b below for the Drizzle-specific finding.

**Remaining work in the original directive:** all three founder-judgment-gated items (C.1, C.2, A.2 F3) **resolved 2026-05-06** — all deferred with explicit revisit triggers. Hard floor and soft floor both closed; vertical expansion (Note Investor) is unblocked modulo F.1/F.2 visual verification (which needs `storageState.json` from a logged-in session).

---

## TL;DR

**Stabilization is complete.** Hard floor (B-series mechanical fixes + A.2 perf fixes + E white-label park + D schema decision + §3 schema sweep) all shipped and live in prod. Soft floor (C.1 founder-dashboard, C.2 onboarding-v2 redesign) reviewed 2026-05-06 and both formally **deferred with explicit revisit triggers**. A.2 F3 (preload trim) re-measured 2026-05-06 — cold load ~0.8-1.0s TTI on broadband, ~3× under the 3s threshold; F3 deferred per sequencing rule. F.1/F.2 visual verification still needs `storageState.json` from a logged-in browser session.

**Customer impact during this entire session: zero.** Production app served from version 352 throughout the migrate.mjs blockage; once unblocked (v6), the catch-up was additive-only and no downtime occurred.

---

## §1 · What shipped this session

### Workstream A — Performance / Loading

| Item | Status | Commit | Notes |
|---|---|---|---|
| **A.1 Diagnostic** | ✅ shipped | `49802ac` | `PERFORMANCE-DIAGNOSTIC.md` — root cause: HTTP/2 + compression@1.8 negotiation bug, 2.28 MB raw assets per cold load |
| **A.2 F2 sw.js cache** | ✅ shipped + verified live | `3beb82e` | `cache-control: no-cache` on `/sw.js` (was 1y immutable — pinned users to stale SW) |
| **A.2 F1 pre-compress + serve override** | ✅ shipped + verified live | `6157644` | `vite-plugin-compression` + static-serve middleware; live `index.js` 603 KB → 153 KB Brotli (74.6% reduction) |
| **A.2 follow-on Docker context** | ✅ shipped | `73ce06a` `0f69fd6` | `.dockerignore` exclusions; build context dropped from **3+ GB → 42 MB** (70× faster deploys) |
| **A.2 follow-on migrate.mjs** | ✅ shipped | `3a3bff4` | **Critical unblock** — see §3 narrative |
| **A.2 F3 preload trim** | ⏸ deferred 2026-05-06 | — | Re-measured cold load against acreos.io: ~680 ms bytes-on-wire critical path (median of 3 runs, HTTP/2 parallel, Brotli verified) → ~0.8-1.0s estimated TTI on broadband. F1+F2 cleared the 3s threshold with ~3× margin, so F3 not shipped per sequencing rule. See §7 for revisit triggers. |

### Workstream B — Mechanical infrastructure

| Item | Status | Commit |
|---|---|---|
| **B.1 0067 migration collision** | ✅ shipped | `e622800` |
| **B.2 pre-commit hook** | ✅ shipped + verified | `ccd18e7` |
| **B.3 Lexend woff2** | ✅ shipped | `6afa4f4` |
| **B.4 Drizzle journal regen** | ⏸ documented deferral | `44b3e70` — `shared/schema-migration-guide.md` (needs staging DB access) |
| **B.5 Sentry replay 1.0→0.5** | ✅ shipped | `102b80b` |
| **B.6 Consolidate hidden-route maps** | ✅ shipped | `f845b36` |

### Workstream C — UI polish (PLANS ONLY — awaiting your approval)

| Item | Status | Doc |
|---|---|---|
| **C.1 founder-dashboard v2** | ⏸ plan written | `FOUNDER-DASHBOARD-V2-PLAN.md` — 3 options. **STOP for your call.** |
| **C.2 onboarding-v2 redesign** | ⏸ plan written | `ONBOARDING-V2-REDESIGN-PLAN.md` — 2-day session. **STOP for your call.** |

### Workstream D — Schema refactor

| Item | Status | Doc |
|---|---|---|
| **D Decision** | ✅ shipped | `SCHEMA-REFACTOR-DECISION.md` — defer until after Note Investor ships |
| **D Pre-work** | ✅ shipped | `shared/schema-inventory.md` |

### Workstream E — White-label 90-day park

| Item | Status | Commit |
|---|---|---|
| **E.1-E.4** | ✅ shipped | `7a3644c` — issue #72 created with 2026-07-15 trigger |

### Workstream F — Verification

| Item | Status |
|---|---|
| **F.1 Authenticated nav audit** | ⚠ blocked — needs `storageState.json` from a logged-in browser session you provide |
| **F.2 Per-theme visual matrix** | ⚠ blocked — needs `storageState.json` |
| **F.3 Performance regression check** | 🔄 ready to run — F1 + F2 verified live; needs a fresh cold-load measurement |
| **F.4 This document** | ✅ this is it |

---

## §2 · Build / verification snapshot

- **`npm run check`** — clean across all session commits (modulo pre-existing client-side TS errors unrelated to this work)
- **`npm run build`** — clean; emits `.gz` + `.br` siblings for every chunk above 1 KB
- **Pre-commit hook** — functional; every commit since `ccd18e7` ran without `--no-verify`
- **Build context** — 42 MB (down from 3.7 GB)
- **Build sizes after F1 (gzipped, current build):**
  - `index.js` 603 KB raw → 153 KB Brotli (74.6%)
  - `vendor-charts.js` 423 KB → 121 KB
  - `vendor-pdf.js` 377 KB → 123 KB
  - `vendor-clerk.js` 214 KB → 63 KB
  - `vendor-map.js` 1.6 MB → 457 KB (lazy-only on `/maps`)
  - `index.css` 281 KB → ~80 KB

---

## §3 · Schema drift — RESOLVED

**Outcome: 87/87 schema items live in prod.** Full audit + per-batch detail in [`SCHEMA-DRIFT-AUDIT.md`](./SCHEMA-DRIFT-AUDIT.md).

### What was wrong

`scripts/migrate.mjs` (the Fly `release_command`) had been declaring statements that referenced tables / columns / extensions never applied to the production database. Every deploy since the failing statements were added had aborted at exit code 1, silently. Production had been on version 352 (2026-05-01 image) for three days. The drift audit identified **62 missing tables, 25 missing columns, 2 missing extensions**.

### What got applied

Nine batches, additive-only:

| Batch | Domain | Items | Status |
|---|---|---|---|
| §3.1 | audit_events table | 1 table | ✅ clean |
| 1 | outbox + outbox_dlq + job_runs (canary) | 3 tables | ✅ clean |
| 2 | compliance + audit | 8 tables | ✅ clean |
| 3 | email/lifecycle/team | 14 tables | ✅ clean |
| 4 | finance + economics + recognition | 10 tables | ✅ clean |
| 5 | SCP memory + activation/retention + observability | 10 tables | ✅ clean |
| 6 | features (vision/title/import-export/ETL/ML/notes) | 10 tables | ✅ clean |
| 7 | derived + legacy | 7 tables | ✅ clean |
| 8 | column ALTERs | 25 columns | ✅ clean |
| 9 | extensions | unaccent | ✅ clean |

Final verification (2026-05-05) via `to_regclass` + `information_schema.columns` + `pg_extension`:

```
Tables:     62/62 present
Columns:    25/25 present
Extensions: unaccent=OK, vector=DEFERRED
```

### §3a · Deploy boot guard — RESOLVED

The F2 inbound-email boot guard (Wave 3) refused to boot version 354 because neither `INBOUND_EMAIL_WEBHOOK_SECRET` nor `INBOUND_EMAIL_SNS_ONLY=1` was set on prod. Founder authorized `fly secrets set INBOUND_EMAIL_SNS_ONLY=1` after I confirmed via code inspection that production uses the SES → SNS path. Deploy v6 booted clean immediately after.

### §3b · Worker query bug (Drizzle ANY → IN) — RESOLVED

Surfaced by §3 Batch 1: with the outbox table now present, the worker started polling and immediately failed every cycle with PG 42809 (`op ANY/ALL (array) requires array on right side`). Root cause was unrelated to the schema sweep:

> **Drizzle's `sql\`${arr}\`` template expands a JS array as N positional placeholders BEFORE any cast applies.** So `AND event_type = ANY(${arr}::text[])` rendered as `ANY(($1, $2, $3, $4, $5, $6)::text[])` — Postgres parses `(1,2,...)` as a record, and casting record-to-array fails.

Fix (commit `14e87630`): replace `ANY(arr)` with `IN (sql.join(arr.map(t => sql\`${t}\`), sql\`, \`))`. Each value gets its own positional placeholder, no array-binding ambiguity. Semantically equivalent for small constant sets, idiomatic Drizzle, no ORM bypass.

**Rule of thumb for future Drizzle work:** prefer `IN (sql.join(...))` over `ANY($::text[])` when binding a JS array of values.

After the fix deployed, worker poll-cycle errors went from ~9/min to **0/min**. Worker process has since run cleanly for 1d 21h+ across 8 subsequent deploys without a single restart-from-crash.

---

## §4 · What's working as of right now

- **Code builds clean** — `npm run check`, `npm run build`, pre-commit hook all green
- **Production deploy pipeline functional** — eight successive deploys this run (Batches 1-8 + worker fix + land_status follow-up) all green; release_command idempotent; `--no-cache` not required after the initial v6 unblock
- **Production schema matches code** — 87/87 declared schema items live; legacy migration drift documented in audit doc for future cleanup PR
- **Worker stable** — 1d 21h+ uptime, zero poll-cycle errors
- **Stabilization documents shipped** — performance diagnostic + schema drift audit + remaining work inventory + 5 plan/decision docs + observability posture

---

## §5 · Parked items (need founder approval before shipping)

### audit_events row-lockdown triggers (from migration 0049 part 3)

A PL/pgSQL function + two BEFORE triggers + an immutable view that would make the `audit_events` table append-only. The table itself shipped clean in §3.1; the lockdown is a behavioural change (audit_events becomes un-deletable except via DBA session GUC) that compliance/legal counsel may want for the SOC 2 path. **Do not ship without explicit founder approval.** Documented in [REMAINING-WORK-INVENTORY.md → Compliance posture decisions](./REMAINING-WORK-INVENTORY.md).

### pgvector + IVFFlat for `deal_patterns.embedding_vector`

Migration 0052 changes `deal_patterns.embedding_vector` from `jsonb` to `vector(1536)` and builds an IVFFlat index. **The `vector` extension is not available on the current Fly Postgres image** — the Postgres image upgrade is a separate work item. Only the additive companion (`embedding_refreshed_at` timestamp + btree index) shipped in B8.

### Excluded by intent (not parked, just out of sweep scope)

- `etl_jobs` regrid/fema seed rows (0070 INSERT) — operator credentials required; seeding stub rows would noise the founder /etl UI before the orchestrator is wired up.
- `0003`/`0072` field_scout_* canonical migrations — drifted from `shared/schema.ts` shape; B7 built from schema.ts as authoritative. A future migration cleanup PR should retire the stale CREATE TABLEs.

---

## §6 · Readiness assessment for vertical expansion

**Honest read: ready.** C.1 and C.2 both formally deferred 2026-05-06 with revisit triggers documented.

| Prerequisite | State |
|---|---|
| Performance fixes (F1 + F2) | ✅ shipped + verified live (74.6% Brotli reduction) |
| Production DB schema catch-up | ✅ §3 sweep complete; 87/87 reconciled |
| Founder-dashboard v2 path | ⏸ deferred 2026-05-06 — see `FOUNDER-DASHBOARD-V2-PLAN.md` DECISION section |
| Onboarding v2 redesign | ⏸ deferred 2026-05-06 — see `ONBOARDING-V2-REDESIGN-PLAN.md` DECISION section |
| F verification (post-deploy) | F.3 ready; F.1 + F.2 need `storageState.json` |

Vertical expansion (Note Investor first) is unblocked. Remaining stabilization tail: A.2 F3 re-measure, F.1/F.2 verification, optional `field_scout` cleanup.

---

## §7 · Decisions made + what next

### Decided 2026-05-06

- **C.1 founder-dashboard v2 — DEFERRED.** Reviewed four options against current state; chose C with honest framing. Note Investor work is orthogonal to `founder-dashboard.tsx` (verified via grep — zero references to `investorType`/`acquired_notes`/note concepts in either dashboard file). Extraction queue preserved as canonical pending work with 5 explicit revisit triggers. See [FOUNDER-DASHBOARD-V2-PLAN.md → DECISION section](./FOUNDER-DASHBOARD-V2-PLAN.md) and [REMAINING-WORK-INVENTORY.md → Deferred architectural work](./REMAINING-WORK-INVENTORY.md).
- **C.2 onboarding-v2 redesign — DEFERRED.** Reviewed three options against current state; chose to defer. Volume is too low (~8 signups/month, n=8) to read funnel signal, and no per-step telemetry exists to identify which screen the 75% drop-off is happening on — so a 3-4 day prototype-faithful rebuild would be redesigning blind. Prototype JSX is 100% mock (zero API calls in 992 lines), so realistic effort is 3-4 days, not 2. Wave 12 investor-type fork shipped but zero `notes`/`both` orgs exist yet. Four explicit revisit triggers documented (volume crosses ~30/month, per-step telemetry shows >50% step bail, qualitative friction reports from notes/both customers, or Note Investor vertical creates new demand). Pre-condition workstream queued: ~½ day to instrument per-step `audit_events` writes — should land before any future redesign decision. See [ONBOARDING-V2-REDESIGN-PLAN.md → DECISION section](./ONBOARDING-V2-REDESIGN-PLAN.md) and [REMAINING-WORK-INVENTORY.md → Deferred architectural work](./REMAINING-WORK-INVENTORY.md).
- **A.2 F3 preload trim — DEFERRED.** Re-measured cold load against `acreos.io` (logged-out, cold cache, HTTP/2 parallel, Brotli verified). Methodology: `curl --http2 --parallel` for 11 critical-path assets (1 entry script + 7 modulepreload chunks + 1 stylesheet + 2 woff2 fonts). Median bytes-on-wire critical path: **679 ms** (range 664-753 ms across 3 runs). Slowest single asset: `index.js` entry chunk at ~360 ms — pdf+charts finish in the same window, so they are *not* the long pole on broadband. Adding a 150-300 ms desktop V8 parse/exec budget for 1.95 MB raw JS → estimated TTI **~0.8-1.0s** on broadband, ~3× under the 3s threshold. F1+F2 cleared the bar; F3 sequencing rule says don't ship. **Compression sanity check passes:** 503.9 KB Brotli wire / 1950.8 KB raw JS = 74% reduction, matching the 74.6% F1 deploy claim.
  - **Slow-4G envelope (honest caveat):** worst-case bandwidth-bound simulation (1.5 Mbps aggregate, no multiplexing) puts bytes-on-wire at ~3.4s, borderline over 3s for constrained connections. F3 would save ~32% wire bytes (~205 KB Brotli / ~800 KB raw) and bring slow-4G cases to ~2.6s wire / ~3.0s TTI. Doesn't justify shipping now — Land Investors are predominantly desk-based and broadband is the dominant cold-load condition.
  - **Revisit triggers** (any one flips the decision): (a) RUM data shows >5% of cold loads on connections worse than fast 4G; (b) a mobile-heavy vertical ships and shifts user-mix toward constrained connections; (c) total cold-load JS wire grows materially (e.g., > 700 KB) such that broadband margin shrinks; (d) the static-import bug suspected in PERFORMANCE-DIAGNOSTIC §N1 surfaces another way and you want to clean up the preload list anyway.

### Also shipped 2026-05-06

- **Onboarding-v2 step instrumentation — SHIPPED.** Wired complementary `onboarding_step_${n}_entered` and `onboarding_path_selected` events into the existing `activation_events` system. Per-step bail rate now computable as `entered_N MINUS completed_N`. Server: `POST /api/onboarding/step-entered` + `POST /api/onboarding/path-selected` in `server/routes-onboarding.ts`. Client: best-effort fetch from `client/src/pages/onboarding-v2.tsx` (useEffect on step change + path-click handler). Type check clean. Drives C.2 revisit triggers #2 and #3 — events will accumulate in the background; interpret cautiously at ~8 signups/month volume.
- **field_scout migration drift — DOCUMENTED.** Annotated `migrations/0003_robust_namora.sql` and `migrations/0072_field_scout_photo_hash.sql` with deprecation headers pointing to `scripts/migrate.mjs:1290-1329` as canonical (derived from `shared/schema.ts`). Added a "Drift catalog" section to `shared/schema-migration-guide.md` with the full per-table drift summary and the cutover plan. Original migration files left structurally untouched to preserve Drizzle journal alignment.

### What next

The only founder-input-gated item left:

1. **F.1 + F.2** — provide `storageState.json` from a logged-in browser session and I run the authenticated nav audit + per-theme visual matrix.

After F.1/F.2 clear, vertical expansion (Note Investor first) is fully unblocked.

---

## §8 · Commits this run (selected)

This session shipped 30+ commits across two contexts. Highlights:

```
c4534754  docs(schema-drift): §3 sweep complete — 87/87 items reconciled
5e4e4d9e  schema-drift §3 Batch 8 follow-up: properties.land_status
921eb693  schema-drift §3 Batches 8 + 9: column ALTERs (25) + unaccent
18de91ef  schema-drift §3 Batch 7: derived + legacy (7 tables)
6a90b1f1  schema-drift §3 Batch 6: features (10 tables)
3b957ec4  schema-drift §3 Batch 5: SCP + activation/retention + observability
c9c6a478  schema-drift §3 Batch 4: finance + economics + recognition
087f905e  schema-drift §3 Batch 3: email/lifecycle/team (14 tables) +
          parked audit_events lockdown to REMAINING-WORK-INVENTORY.md
381a12a6  schema-drift §3 Batch 2: compliance + audit
14e87630  fix(worker): replace ANY(arr) with IN (...) via sql.join
77dc5f5b  schema-drift §3 Batch 1 (canary): outbox + outbox_dlq + job_runs
95535dc2  scripts/audit-schema-drift.mjs + SCHEMA-DRIFT-AUDIT.md
3a3bff4   fix(deploy): A.2 follow-on³ — migrate.mjs non-fatal classifier
0f69fd6   fix(deploy): A.2 follow-on² — exclude .claude/worktrees etc
73ce06a   fix(deploy): A.2 follow-on — exclude .git/docs/etc from build context
6157644   fix(perf): F1 — pre-compress assets + serve via static override
3beb82e   fix(perf): F2 — sw.js cache-control no-cache
49802ac   docs: PERFORMANCE-DIAGNOSTIC.md
```

Plus the B-series mechanical commits (B.1-B.6) and Workstream C/D/E plan / decision docs.

---

## §9 · Notes for the next session

- Customer impact during this run: **zero**. Schema additions are additive; deploys were rolling; no downtime.
- The `migrate.mjs` non-fatal classifier remains in place. With prod schema now caught up, it's defending against future short-lived drift rather than masking 3-day drift.
- The schema sweep produced one engineering finding worth carrying forward: **prefer `IN (sql.join(...))` over `ANY($::text[])` when passing a JS array through a Drizzle sql template.** Documented in SCHEMA-DRIFT-AUDIT.md and in the worker.ts commit message.
- A scheduled remote routine `trig_01EEbCQf6fEaHfoLzcxDyNkb` ("cascade+autonomy data-gated calibration check") was created in error during a post-compaction context leak and has been disabled. Founder can delete via https://claude.ai/code/routines/trig_01EEbCQf6fEaHfoLzcxDyNkb if desired.
