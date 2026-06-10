# Elevation Blueprint — 2026-06-10

Seven-lens cold fresh-eyes review of the entire system (platform architecture, product/UX,
AI ensemble, reliability/security, growth/conversion, data moat/economics, meta-system).
Each lens read code independently, with prior roadmap docs excluded. This doc is the
synthesis and the execution plan.

Baseline at review time: prod = local = origin = `cf07017f`. ~465 tables, 271 route files,
118 scheduled jobs, ~6,350 tests.

---

## The meta-diagnosis

All seven lenses converged independently on two patterns:

**1. Architecture ahead of wiring ("built but dark").** Machines are built to a high
standard, then stop one step short of actuation:
- 14-message lifecycle email engine — zero call sites (`lifecycleProgram.ts`)
- Parcel-observation graph fed by 2 of ~5 paths, 4 of 7 fields; `tax_status` never written
  so the strongest seller-likelihood drivers can never fire
- Calibration grader ends at `logger.info`; threshold never adjusts
- Critical domain-audit findings write rows that never page
- Eval harnesses (3 of them) gate no deploy
- Learning-loop RAG built + tested, dispatchRunner never calls it ("5-line follow-up")
- Constitutional system-prompt block exported, never wired
- Transparency reports aggregate nightly, none ever published
- Bundle-size budget script in zero workflows; `migrate --dry-run` never invoked
- Sentry sourcemaps skipped (token never minted) — prod stack traces minified
- db_backup no-ops cleanly (bucket unset) while marked critical and reporting alive
- Referral system server-complete, zero client wiring; `?ref=` never captured
- Redis rate-limit store exists, not wired to the hot-path limiters

**2. Invariants by convention, not construction.**
- Tenancy = per-route discipline across 270 files → live IDOR found (E-SEC1)
- Witnessed-send = call-site blocks → two bypass paths found (E-SEC3)
- Import boundary (@sovereign/immutables incident) = a comment; the live landmine import
  is still inside shared/ (`solene-constitutional-violations.ts:122`)
- Server code: 100% unlinted (`eslint.config.js` ignores `server/**`); 741 raw
  `res.status()`, 87 `(req as any)`, 34% zod coverage — CLAUDE.md standards unenforced
- All watchers live inside the blast radius they monitor (worker monitors itself;
  external GHA watchdogs mute because DEPLOY_ALERT_WEBHOOK unset)

**Corollary:** the highest-leverage work is overwhelmingly *closing loops*, not building
new machinery. The reimaginings (Tier 3) only pay off after the wiring debt (Tiers 0–2).

---

## TIER 0 — Trust violations & live customer-visible bugs (immediate)

| # | Item | Evidence | Class |
|---|------|----------|-------|
| T0-1 | `send_sms` bypasses the autonomy kernel entirely (no autonomy level check, no draft gate, no envelope); `vaService.ts:663` executes approval-required tools with no gate; model can emit `_approved:true` itself (nothing strips undeclared args) → **unwitnessed-send pathways** | `tools.ts:1688-1732`, `vaService.ts:663-667` | Policy violation |
| T0-2 | IDOR: `GET /api/due-diligence/templates/:id` — no org check (PUT/DELETE have it); sweep storage.ts for other unscoped `get*(id)` called from routes | `routes-deals.ts:649-653`, `storage.ts:2010` | Security (M) |
| T0-3 | MCP endpoint: single static key, non-constant-time compare, arbitrary `organizationId` param on every tool, mounted outside the limiter | `server/index.ts:504-528`, `server/mcp/index.ts:412+` | Security (H if key leaks) |
| T0-4 | AI cache has no org dimension — semantic layer (Jaccard ≥0.72 over ALL entries) can serve one org's answer to another | `aiRouter.ts:23-32,107-124` | Security/privacy |
| T0-5 | `checkTcpaBeforeSend` looks up lead by bare id across all orgs | `autonomyGuardrails.ts:90-114` | Security (latent) |
| T0-6 | Approve-and-send accepts client-resupplied subject/message (approval ≠ that draft) and is not idempotent (double-tap = double send) | `routes-pax-insights.ts:525-552` | Correctness |
| T0-7 | `animate="show"` vs defined `hidden/visible` variants → sections stuck at opacity 0 on **Today** (ParcelAlerts), **Finance** (ledger list), **Pax** (suggested prompts) + 7 more files | `components/today/ParcelAlerts.tsx:206`, `FinanceBook.tsx:244`, `pax.tsx:713`, `lib/animations.ts:73-91` | Live UI bug |
| T0-8 | `/glossary` sitemap-promised soft-404 (prerendered head, archived SPA route) | `public-routes.ts:48`, `App.tsx:477,712` | SEO bug |
| T0-9 | Nested full app shell on Finance door — finance.tsx + portfolio.tsx render their own PageShell inside money.tsx: duplicate sidebar/topbar/H1, duplicate `id="main-content"` | `money.tsx:80`, `finance.tsx:202`, `portfolio.tsx:303` | Live UI bug |
| T0-10 | Deals header KPIs computed from one 25-row page of a paginated result — "Pipeline value" lies for >25 deals | `deals.tsx:124,349-365` | Live UI bug |
| T0-11 | Webhook job handler fetches `job.payload.url` with no SSRF validation (from the worker, which holds FIELD_ENCRYPTION_KEY) | `runScheduledJobs.ts:484-507` | Security (conditional) |
| T0-12 | Fabricated TX/FL/GA "industry benchmarks" hardcoded in credit benchmarking — collides with truth-immutable ratchet | `creditBenchmarking.ts:8-35` | Honesty violation |
| T0-13 | Raw 500s leaking `error.message` to customers | `routes-acquisition-radar.ts:17+`, `routes-avm.ts:166`, `routes-pax-insights.ts:604` | Info disclosure (L) |

## TIER 1 — Invariants by construction

**1A. One approval kernel (AI R1).** `pending_actions` table: tool proposes a row
(tool + frozen args + content hash + expiry) → UI renders → approve endpoint executes
*that row* with idempotency → append-only `pax_sends` audit (replacing the mutable
agent_memory JSON blob). `APPROVAL_REQUIRED_TOOLS` enforced inside `executeTool` itself.
Kills `_approved`, the dead `__paxPendingApprovals` global map, and the natural-language
"Confirmed, please proceed" client approval. Witnessed-only becomes structurally
unbypassable. Generalizes to SMS/Gmail/Stripe/future sends.

**1B. Untrusted-data envelope on tool results (AI R2).** Tool results (lead notes,
browse_web content, recalled memories) currently re-enter the model as trusted-channel
JSON. Wrap customer-originated/external string fields with the existing `<<USER_DATA>>`
discipline; unify with founder-side `<untrusted_data>` into one shared module + one eval
proving resistance. Also: domain policy + private-IP block on `browse_web`.

**1C. Boundary + standards enforcement.**
- dependency-cruiser (or no-restricted-imports): shared/ imports nothing server-only;
  client/ never resolves server aliases. Move the live `@sovereign/immutables` import out
  of shared/.
- `npm run build` (client) added to the deploy **gate** job, not just the deploy job.
- Generic ratchet factory (`scripts/ratchet.mjs --config ratchets/*.json`): raw
  res.status (741), `(req as any)` (87), console.* in server, hardcoded palette colors,
  schema-drift allowlist (642 — count may only decrease), eslint-ignore list length.
- Port flat-config lint to `server/**` at current-count ratchet, not big-bang.

**1D. One alert spine (meta R1).** `recordFinding(severity:"critical")` ⇒ pages through
the deadman's throttled channel. All four nervous systems (notifyOnCall, sendSolenePage,
findings, system_alerts) become transports behind one policy layer. Wire in:
reconciliation divergence, external-status outages (founder side), calibration-grader
verdicts, transparency-draft staleness (>30d unpublished = finding).

**1E. Off-platform last line of defense (SRE R1/R2).**
- 🔑 FOUNDER: set `DEPLOY_ALERT_WEBHOOK`; workflows FAIL (not silently skip) when unset.
- 🔑 FOUNDER: external uptime probe on `/api/healthz` + `/api/health/worker-heartbeat`.
- Backups: provision bucket (🔑), then weekly automated restore-verification job
  (scratch DB, count/checksum asserts, `backup_verified` row the deadman watches).
  Config-dormant critical jobs must register `disabledWhen` or assert effect.
- Automated rollback on deploy health/smoke failure; mint Sentry sourcemap token (🔑).
- Sweep: pg_dump credentials off the command line (env + execFile); Regrid key out of URL.

**1F. Tenancy by construction (SRE R4).** Extend the proven type-brand technique
(read-only replica brand in db.ts) to org scoping: scoped-repository layer where
fetch-by-bare-id doesn't typecheck. RLS considered and deferred (pgBouncer transaction
mode + 465 tables = too much blast radius for now). Start: orgScope util coverage 8 →
all customer-data tables; lint new storage methods.

**1G. Shared-state stores (SRE R5).** Auth/signup limiter lanes → Redis store (exists,
unwire-d); circuit-breaker trips persisted + half-open probe; verify `req.ip` vs
CF-Connecting-IP behind Cloudflare (trust depth likely wrong → limiters key on edge IPs).

**1H. Job-runtime hardening (SRE E3/E9).** Move job bodies out of held transactions
(lease row instead — fixes the 60s idle-in-transaction landmine under ETL/AI jobs);
worker uncaughtException exits after Sentry flush; track scheduled-job in-flight on
shutdown; deadman state persisted across deploys (E11).

**1I. Economics guardrail (data E5).** 🔑 FOUNDER DECISION: heavy Pro user ≈ $180 AI
COGS vs $49 price; `poolDebit` always returns allowed and fails open. Options: hard
ceiling / mandatory BYOK past threshold / metered overage. Implement whichever Tom picks.

## TIER 2 — Feed the compounding machines

**2A. Observation capture (data R1/R2)** — the cheapest moat acceleration available:
- Widen `facts` at `parcel.ts:479` + `etlHandlers.ts:173` (assessed_value, market_value,
  tax_status, sale history); add fusion-path + customer-edit writers.
- Pass `observedAt` (plumbed, never used): emit dated sale observations from provider
  data; one-shot backfill from `parcel_snapshots.lastSaleDate/Price` → tenure clock gets
  decades of depth instead of starting at platform age; teach `deriveOwnerTenure` to use
  sale events as boundaries.
- LCS: add apn/state/county identity to `landCreditScores`; persist calibrator weights
  (in-memory Maps erased every deploy → `model_calibration_log`); benchmarks from own
  network cohorts (k≥5) only.
- Cache telemetry: record cache hits in `provider_lookup_log` (currently invisible —
  early return at `provider-registry.ts:170`); unified hit/avoided-cost accounting
  across the 4 cache lanes.

**2B. One money spine (data R3).** `unitEconomics` rebased on `financial_ledger` sums
(currently parallel tables + hardcoded Twilio rates); failed `postRevenue` → dead-letter
+ replay; Stripe reconciliation activated with divergence → finding (pages via 1D).

**2C. Light the growth machinery (growth R2/E2/E9/E10/E13):**
- Lifecycle dispatch job (start: d7_check_in, d30_nps, cancellation_reason_ask).
- Referral: capture `?ref=` in the acquisition-utm chain, call apply at signup flush,
  surface post-first-value.
- Server-side funnel truth: `trial_to_paid` from Stripe webhook, `first_value_reached`
  repointed at the witnessed first send; tier context (`?plan=&billing=`) carried
  through signup.
- Internal links: footer Free-tools/Learn columns (LCS + /why are currently orphaned);
  fix compare-page noindex-vs-sitemap contradiction; per-route sitemap lastmod.
- Verify canonical domain: code says acreos.io everywhere — confirm vs live domain.

**2D. Close the self-improvement loops (meta R3/R4):**
- Calibration grader → finding + bounded, audited threshold adjustment.
- Learning-loop RAG: do the 5-line dispatchRunner wire-in + regression test.
- Constitutional prompt block → buildSystemPrompt + test.
- Per-org audit_log chain added to the weekly verifier (currently never verified).
- Incident resolution with lessonsLearned ⇒ auto-drafted failure-mode entry (library
  has 3 entries; this is the only store agents structurally consult).

## TIER 3 — Reimaginings

**3A. Public parcel reports with the Land Credit Score (growth R1).** `/p/<state>/<county>/<apn>`
permalinks: saved public report, honest partial LCS from free data ("government-data
dimensions only"), per-report OG image, share button. The score finally appears in the
tool that sells it; every share is an acquisition event. Then: county-scale programmatic
SEO from the GIS registry (~3,100 counties) with live data-freshness stamps + /learn hub.

**3B. The signature interaction (product R2).** Parcel on Map → slide-over (owner, comps,
flood/soil chips) → Pax-drafted blind offer → one witnessed Send tap. Sixty seconds,
one surface. Onboarding continuity: parcel-check county follows the visitor through
signup ("Pax already has your parcel").

**3C. Today as a finishable day (product R1).** Ranked spine, "4 of 9 cleared" progress,
receipts strip ("Pax sent 2 follow-ups overnight"), Morning Brief as queue preamble,
celebratory zero state. + Perceived-speed doctrine (doors paint from cache; mobile nav
prefetch; door-shaped route fallbacks) + keyboard layer (G-chords, J/K queue traversal,
focus-on-H1 route announcements). Finance recomposed as one surface (T0-9 fix first).

**3D. Eval-gated AI pipeline (AI R3/R4/R5).** Hash the fully-composed prompt per turn
into telemetry; nightly judge over a ~50-conversation golden set; merge gate for
`server/ai/` changes; disagreement mining → hand-label queue. Pax memory → pgvector
hybrid retrieval (currently ILIKE on a 100-char key, recency-inverted). One
`resolveModel(ctx) → {model, decisionTrace}` collapsing the seven routing axes.

**3E. Platform end-states (platform R1/R3/R4).** Migration system → one source of truth
(snapshot prod → clean journal → real migrator → freeze+delete migrate.mjs STATEMENTS →
burn the 642-entry drift allowlist to zero). Route manifest registry (mount from typed
manifests; snapshot test = no orphaned route files). API contract layer (`shared/contracts/`
zod both ways, ratcheted adoption). Finish storage.ts split with a line-count ratchet.

**3F. Cross-org data co-op (data R5).** Generalize marketNetworkContributor's privacy
model (k≥5, bucketing, org-null) to county rollups → Map-door market-heat surface →
quarterly public market reports (SEO asset whose quality compounds with usage).
Job substrates 4 → 1 (cron expressions, derived roster).

---

## Founder-only items (🔑)
1. `gh secret set DEPLOY_ALERT_WEBHOOK` (2 min — unmutes every external watchdog)
2. External uptime monitor (UptimeRobot-class) on the two health endpoints
3. `DB_BACKUP_S3_BUCKET` provisioning (backups currently no-op)
4. Sentry auth token (prod stack traces currently minified)
5. Pricing decision: heavy-user AI ceiling vs mandatory BYOK vs metered overage (1I)

## Already excellent — do not touch (consensus across lenses)
- `server/static.ts` (post-fix), middleware ordering in index.ts, queryClient.ts network
  craft, the deadman/roster epistemology, the bidirectional ratchet idiom, the grounding
  stack + honest-null confidence, marketNetworkContributor privacy model,
  financial_ledger core design, single-source pricing, motion-token system, the
  dated-incident-comment institutional-memory practice (preserve through all refactors).

## Sequencing
Tier 0 → 1 in dependency order (1A/1B unblock nothing else; 1C/1D/1E first — they make
every later wave safer to ship). Tier 2 is parallelizable behind 1D (alert spine) and
1C (gates). Tier 3 items each ride behind their tier-1/2 dependency: 3A behind 2A (LCS
identity), 3D behind 1B (envelope), 3E behind 1C (boundary lint).

Open background work folding in: paid-data eval harness build (FB3), alignment bias-stub
honesty fix (P0) — both still running at blueprint time.
