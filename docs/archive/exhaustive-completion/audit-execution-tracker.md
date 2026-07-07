# Audit Execution Tracker — 12-Week Sprint to All-A's

Single source of truth for the multi-session execution of the 45-lens audit
backlog. Each session picks up here. Updated as items land on main.

**Goal:** Every lens to grade A. Every untouched finding closed or actively
in-flight. Every Critic systemic finding resolved.

**Current main HEAD when sprint started:** `7ff3cbea` (wave-3 deploy complete)

## Status legend

- ✅ Shipped to main
- 🟡 In-flight (worktree / agent running)
- 🔴 Blocked on external (API key, attorney sign-off, etc.)
- ⏸ Deferred to a later week
- 🆕 Not yet started

## Priority A — Week 1 (zero-cost cleanup, no external deps)

| Item | Status | Lens | Notes |
|---|---|---|---|
| Flip `continue-on-error: false` on production test gate | 🆕 | 10/24 | One-line `.github/workflows/deploy.yml` change |
| Flip `continue-on-error: false` on post-deploy health check | 🆕 | 24 | Same file |
| Generate `DEPLOY_BOT_TOKEN` recipe + doc | 🆕 | 32 | Crypto-random secret; Tom pastes into GitHub + Fly |
| First DR drill manual run script + first ledger row | 🆕 | 24/32 | `scripts/run-dr-drill.mjs`; Tom executes; writes `dr_drills` row |
| First quarterly access review manual run | 🆕 | 32 | `npm run access-review`; Tom replies REVIEWED |
| Sentry source-maps token doc (waits on Tom) | 🔴 | 24 | Needs `SENTRY_AUTH_TOKEN` from Tom |
| Twilio SMS paging for SEV1 (waits on Tom) | 🔴 | 13/24 | Needs Twilio creds |

## Priority B — Weeks 2-3 (counsel engagement — Tom's lane)

| Item | Status | Lens | Notes |
|---|---|---|---|
| Schedule multi-state RE attorney ~4h | 🔴 | 26 | Carla's seed data + UPL + warranty clauses + land contracts + FIRPTA |
| Schedule consumer-finance compliance attorney ~4h | 🔴 | 27 | David's RESPA + ATR + HOEPA + balloon language |
| Schedule RE tax JD/CPA ~2h | 🔴 | 28 | Lisa's dealer-classifier + 1098/1099 forms |
| Schedule TCPA counsel ~2h | 🔴 | 30 | Maya's consent disclosure + STOP audit fields |
| Schedule landlord-tenant atty ~4-6h | 🔴 | 31 | Glenn's state procedure wording |
| Schedule title/escrow operator review | 🔴 | 34 | Mae's checklist + state-attorney-required states |
| Open SOC 2 Type II conversation w/ audit firm | 🔴 | 32 | Kareem's policy stack is ready |
| Submit cyber-insurance application | 🔴 | 35 | Brian's 30-Q doc is ready |

## Priority C — Weeks 3-6 (wave-3 carry-over)

| Item | Status | Lens | Notes |
|---|---|---|---|
| Devon — fix-flipper FK migration + `rehab_photos` table + ARV-to-rehab wire | 🆕 | 20 | Was in worktree, build conflict; needs resolution + re-run |
| Imelda — Mobile Landlord persona tab | 🆕 | 21 | Was in stash; recover + polish |
| Ines — design token unification (lock `rounded-card`, merge motion libs, ban arbitrary text sizes) | 🆕 | 7/8 | Re-run with focused scope |
| Trey — wholesaler dialer scaffold (Twilio integration deferred to API key) | 🆕 | 18 | Build the UI + state machine; wire when Twilio key arrives |

## Priority D — Weeks 6-12 (compound-interest cleanup)

| Item | Status | Lens | Notes |
|---|---|---|---|
| `shared/schema.ts` split per `schema-inventory.md` | 🆕 | 10/11 | 21,679 LOC → 12 buckets |
| `server/storage.ts` god-class break-down | 🆕 | 10 | 8,763 LOC → per-domain repos |
| Audit-log purge + chain interaction fix (`audit_log_purges` sealing table) | 🆕 | 23/32 | Kareem's significant deficiency #4 |
| `FIELD_ENCRYPTION_KEY` first rotation + re-encrypt sweep tool | 🆕 | 23 | Kareem's deficiency #3 |
| Founder-dashboard 7,379-LOC monolith extraction (begin queue) | 🆕 | 1/10/12 | Documented C.1 deferral; start the queue |
| Optimistic mutation factory expansion (~530 sites still don't roll back) | 🆕 | Critic #3 | Apply `useOptimisticUpdate` across remaining hooks |
| Tier-3 cooldown persistence to DB | 🆕 | 13 | Fly restart wipes the in-memory Map |
| `pg_advisory_xact_lock` per scheduled job | 🆕 | 13/24 | Unblocks horizontal worker scaling |
| Landlord tenant portal + Stripe ACH (waits on API key) | 🔴 | 21 | Money-transmitter regulatory work |
| Note Servicer mode (Ursa) — schema + UI scaffold | 🆕 | 16 | Sub-persona "not built" per audit |
| `routes-dunning.ts` naming-collision fix | 🆕 | 16 | Customer billing vs note-borrower dunning |
| Knowledge base public browse UI | 🆕 | 25 | Articles are write-only today |
| Error → docs slug linking via `Errors.*` helpers | 🆕 | 25 | Add `docsSlug?: string` |
| In-app invoice viewer | 🆕 | 25 | Stop bouncing to Stripe portal |
| Sentry source-maps re-enabled (waits on token) | 🔴 | 24 | |
| SLO Prometheus exporter (`prom-client` + `/metrics`) | 🆕 | 24 | Stop the documentation theater |
| Scale tier inconsistency fix (3-tier in-app vs 4-tier `/pricing`) | 🆕 | 3 | Promote `TIER_LIMITS` to single source |
| Codename leak fix (`Pricing.tsx` Sophie, `FAQ.tsx` Atlas) | 🆕 | 9 | One-liner |
| "Welcome aboard!" / "You're all set!" rewrites | 🆕 | 9 | Onboarding copy hygiene |
| Founder home consolidation (kill `/founder/dashboard` + `/founder-dashboard` + `/founder/now`; pick one) | 🆕 | 4 | Redirect today, not "60 days from now" |
| Stale `pages` array in command-palette → source from `NAV_MODULES` | 🆕 | 4 | |
| Merge `⌘K` + `⌘⇧K` palettes into one with scope chips | 🆕 | 4 | |
| 22 orphan routes sunset audit | 🆕 | 4 | Delete or link from nav |
| Hero rotator → static "Built for Land Investors" | 🆕 | 1 | Per Tom's terminology rule |

## Untouched lenses to run as new agents (this session)

| Lens | Agent | Notes |
|---|---|---|
| 46 — AI autonomy trust loop legibility | 🟡 spawning | When Atlas takes destructive action, is the *why* legible? |
| 47 — Marketing funnel + SEO + Lighthouse | 🟡 spawning | Landing→signup→activation funnel mechanics + Core Web Vitals |
| 48 — Production IDOR behavioral probe (read-only) | 🟡 spawning | Yuki closed grep-findable IDORs; this one looks at behavioral patterns |
| 49 — Localization / i18n readiness | 🟡 spawning | Lens 22 flagged "no i18n library"; deep audit |
| 50 — Public API design + v0 scoping | 🟡 spawning | Hugo touched Errors envelope; full v0 design needed |

## Items waiting on Tom (external)

- Provision Twilio Voice + Programmable Messaging account → paste keys into Fly secrets
- Generate Sentry source-map auth token → paste into Fly + GitHub
- Stripe Connect Custom enrollment (for landlord ACH)
- TransUnion SmartMove org enrollment (for landlord screening)
- Attorney bookings (4 lanes)
- SOC 2 Type II audit firm engagement
- Cyber insurance application submission

## Session log

- **2026-05-27 session 1:** Sprint start. Wave-3 deploy complete (7ff3cbea). Beginning Priority A + new-lens agents.
