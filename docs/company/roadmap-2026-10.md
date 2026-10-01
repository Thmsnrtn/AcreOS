# AcreOS Roadmap — October 2026: from zero customers to the mature machine

*Layering: `CONSTITUTION.md` → `mature-machine.md` (destination, gates G0–G4,
horizons H0–H5) → **this document** (waves under the active horizon) → decision
memos. It supersedes the execution ledger of `roadmap-2026-07.md`, whose open
W6.3/W7 items fold in below. `public-readiness-plan-2026-09-29.md` remains the
phase plan for crossing G0 and G1; this file schedules the engineering under it
and reuses its §6 scoreboard. Verified against HEAD `b9b1330` on 2026-09-30.*

*Nothing here relitigates CLAUDE.md's DO-NOT-DO list or a dated founder ruling
(§F maps each to its reactivation trigger).*

## The through-line

No gate is crossed. Active 0 / Trial 0. The repo's own verdict is "broad scope
and little proof", and its research warns against "the recursive maturity
program". So **mature** here means *the capability that exists is true,
drilled, and small enough to hold* — not more capability.

**Prove before build · narrow before wide · delete while proving.**

Every item is tagged: **[E]** engineering-only (agents, in waves) · **[K]** owner
action (keys, spend, legal, partners) · **[F]** pending founder decision.

**Stop rule (founder decision 2026-09-30, recorded in
`decision-memos/2026-09-30-roadmap-stop-rule.md`).** After waves W10.1–W10.8 merge, no
H1 feature wave starts until G0's owner actions are done. Only the
credential-triggered waves (KA–KD) and debt / deletion / consolidation waves
(net LOC ≤ 0) run in the meantime. The scoreboard will then show plainly that
the constraint is not engineering.

---

## §A What blocks each gate

The long poles are owner actions. Engineering must never be the critical path,
and must not fill blocked time with new surface.

```
[K4] SENTRY_DSN, LOG_DRAIN_URL, UPTIME_PROBE_URL/TOKEN, paging ──► 30-day uptime clock ──────────► G0   (longest pole: first)
[K1] Clerk test creds + [K2] FLY_STAGING_APP / CI Postgres ──► KA: wedge E2E + tests/e2e blocking ──► G0
[K6] DNC_SCRUB_PROVIDER + Searchbug key ──► DNC fail-closed for cold outreach ────────────────────► G0
     └─ [K12] counsel read on servicing-text DNC scope ──► servicing SMS scope settled
[K7] Lob live key + webhook secret ──► KB: LOB_LIVE_SEND_ENABLED, first witnessed piece ─┐
[K10] Regrid licence (>$500 → founder) ──► KC: Regrid provider, full-coverage lists ──────┤  (without it: W10.3 v0 on
                                                                                         │   ATTOM + seeded counties + CSV)
[K16] 3–5 design partners ──► median time-to-first-mail ≤ 30 min ────────────────────────┴─► Phase-1 exit (H1 entry)
[K3] S3 bucket + keys ──► KD: backups + restore drill (0.2); arms document storage (0143/0046, built, dormant)
[K8] SES + SPF/DKIM/DMARC proof · [K11] LLC/EIN/agent + counsel on Terms/Privacy/DPA
[K9] live STRIPE_PRICE_* · [K20] witnessed $5/day Meta ad (founder-only) ──► CAC ──► G1
[K19] pentest (before G1) · [K13] tax reviewer ──► 1099-INT (0101) · [K14] DocuSign sandbox · [K15] real Outlook/Gmail
[F2] table-drop batches after OD-8 (customer-data deletion is a hard stop) ──► table-count ≤500 (G2), ≤450 (end H2)
```

**Owner actions, in order:** K4 → K1/K2 → K6 → K17 (`DISABLE_BACKGROUND_JOBS=1`
on `app`) → K3 → K7 → K8 → K5 (`REDIS_URL`) → K10 → K16 → K11 → K9 → K18 (run
the dry-run-first `scripts/data/*` with `--apply`: payoff_quotes, key rotation,
market rows, photos, the 0277 refunds, `stamp-status-deleted-leads`, 0239) →
K19 → K20. K12–K15 whenever possible.

**Founder decisions — one sitting, via the Decisions door:**

| # | Decision |
|---|---|
| F1 | The KILL-pending rows of `deletion-ledger.md` (V12/V13 dead methods, orphan leaves, dead sovereign reads) |
| F2 | Table-drop batches after the completed OD-8 program (export first, dry run by default) |
| F3 | Per-table money precision migration (0052), after `scripts/data/numeric-precision-report.ts` runs |
| F4 | The "divorce" motivation signal — after counsel |
| F5 | Academy (0127): execute the ledger's existing KILL — 0127 closes by deletion; its three tables go in an F2 batch |
| F6 | The owner with no active team row (0265 (1)): measure, then decide whether `requireRole` honours `ownerId` |
| F7 | Confirm `mature-machine.md` §4 switch schedule is ratified and recorded |
| F8 | County GIS cache redistribution (0202) |
| F9 | The G1 package: GA pricing (ruling #8), win-back copy (0150), marketplace concierge unlock |
| F10 | Which scale-up ladder is canonical (0225); the other reads it |

---

## §B Debt floors — ceilings that must hold before a gate is claimed

Down-only baselines in `scripts/ratchets/*.json` and the named tests. A value is
lowered in the commit that earned it, never in a baseline-only commit.

| Measure | Now | H0 exit | G1 | G2 | G3 |
|---|---|---|---|---|---|
| Production LOC (`npm run measure:loc`: `server/`, `client/src/`, `shared/` .ts/.tsx, tests excluded) | 855,971 | 845K | 770K | ≤650K | ≤600K |
| `table-count` | 727 | 710 | 620 | ≤500 | ≤450 |
| `schema-monolith-tables` (0048) | 361 | 361 | ≤200 | ≤50 | 0 |
| `run-scheduled-jobs-linecount` | 5,705 | 5,000 | ≤2,500 | ≤800 | ≤800 |
| `storage-linecount` | 1,618 | 1,400 | ≤800 | ≤300 | ≤300 |
| `as-any` / `colon-any` | 1,092 / 2,663 | 1,000 / 2,500 | 700 / 1,900 | 300 / 1,000 | ≤100 / ≤500 |
| `res-status-raw` (0050) | 356 | 280 | 100 | 0 | 0 |
| `self-fallback` | 135 | 110 | 50 | 0 | 0 |
| `empty-on-failure` / `console-in-server` | 13 / 6 | 0 / 0 | 0 | 0 | 0 |
| `tests-typecheck` / `TODO(tsc)` | 157 / 99 | 130 / 80 | 60 / 30 | 0 | 0 |
| `numeric-no-precision` (0052) | 349 | report only | money columns 0 | 100 | 0 |
| `openai-bypass` / `ghost-fields` / `sql-raw` | 82 / 56 / 38 | 65 / 45 / 32 | 30 / 20 / 20 | 0 / 0 / ≤10 | same |
| `inline-provenance` files | 60 | 50 | 30 | 0 | 0 |
| reachability unreached / internal-only exports | 423 / 1,237 | 360 / 1,150 | 250 / 800 | 100 / 400 | ≤50 / ≤200 |
| reachability tablesNoWriter / tablesNoReader / moduleOrphans | 57 / 66 / 34 | 50 / 58 / 0 | 25 / 30 / 0 | 0 / 0 / 0 | 0 |
| org-scoped writes / `OMISSION_BASELINE` / org-fetch baseline sets | 248 / 107 / 359 | ≤150 / 95 / 330 | ≤50 (+RLS) / 60 / 200 | 0 / 20 / 50 | 0 |
| `FOUNDER_ROUTE_BASELINE` | 81 | ≤70 | ≤55 | ≤40 | ≤30 |
| Registry OPEN P1 / P2 | 0 (+2 deferred) / 18 (count of record: 0050 PARTIAL counted OPEN) | 0 / ≤9 | 0 / ≤3 founder-held | 0 / 0 | 0 / 0 |
| Largest non-schema file | 5,807 (`server/ai/supportAgent.ts`) | 5,807 | ≤3,500 | ≤2,000 | ≤1,500 |

- The columns are this roadmap's engineering bar for leaving each horizon.
  They add to the gates; they do not redefine them — gate criteria change only
  in `mature-machine.md` §2. The "H0 exit" column includes readiness plan §6's
  Phase-1 target (org-scoped writes ≤ 150).
- "org-fetch baseline sets" = the four in-file sets of
  `scripts/check-org-scoped-fetch.mjs` (133 + 55 + 104 + 67 = 359), separate
  from the route-widening register `scripts/org-scope-route-widening.json`.
- The deletion ledger's LOC target never had a counting rule. W10.1 pinned
  one in `scripts/measure-loc.mjs`: `wc -l` over tracked `server/`,
  `client/src/` and `shared/` .ts/.tsx, tests excluded — 855,971 at the
  W10.1a commit. (A count over every tracked .ts/.tsx, scripts included, read
  873,238.) It is a measurement until W10.8 merges, because H0's waves add
  gate-tied surface; it becomes a down-only ratchet when the stop rule takes
  effect.
- `scripts/ratchets/reachability.json` holds `minima.pgTables = 600`; the
  table-drop batch that goes under it lowers the floor in the same commit.
- Table drops are founder-applied (F2). The OD-8 program is complete; these are its successors. At ~25 tables per fortnightly batch,
  727 → 450 is ~11 batches — which is why ≤450 sits at the end of H2.
- Debt time share per horizon stays as `mature-machine.md` §3 sets it.

---

## §C Horizons and exit criteria

### H0 — finish arming the wedge (now → G0, then the Phase-1 exit)

**Exit:** the wedge E2E (signup → list → Lob test-mode mail → SMS reply →
offer) is blocking in CI · 30 clean days of probes · module-state risk fixed
or pinned · DNC live, fail-closed · COGS ceilings tier-proportional · acting
switches off and the §4 schedule ratified (F7) · Phase-0 items 0.1–0.9 green · restore drill passed and
recorded · three partners each complete a loop with median time-to-first-mail
≤ 30 min and no founder help · §B's G0 column met.

| Track | H0 work |
|---|---|
| Today | 0243: portfolio health from a worker snapshot, not per GET |
| Map | County list builder v0 as a child of the Map door; county status vocabulary; no silent "first 100" cap |
| Deals | 0276, 0244, 0235 — one close writer on every path |
| Finance | 0185 later installments; 0277 script; 0052 report; autopay checks `pendingCheckoutSessionId` (0265 (4)); the leftover `ach_actum` value removed from the payment-method enum in `server/routes-finance.ts` |
| Pax | No new tools; its close path goes through the one writer |
| Communications | DNC (K6) and Lob (K7) armed; census of agent sends against `server/services/approvalKernel.ts` |
| Platform | Deploy gate; bundle gate; `continue-on-error` register; uptime clock (K4); backups + drill (K3) |
| Security & tenancy | 0017 per-user AI cost cap; 0018 prompt envelope on indirect inputs; org-scoped writes ≤ 200 |
| Structure | Founder route consolidation; `server/routes-kpis.ts` 501s and the dead sovereign reads deleted; "not yet live" triggers wired or removed |
| Design & accessibility | The §E bar on the wedge path |
| Founder | The existing `/founder/onboarding-funnel` moved into a section of The Letter (a route removed, none added); founder paging proven (K4): `web-push` installed and one push delivered via `server/services/oncall.ts`, or another paging channel chosen — never deleted first |
| Legal & external proof | K11, K8, K12 — tracked in `docs/legal/launch-readiness-checklist.md` |

### H1 — win the wedge (G0 → G1)

**Exit** is exactly G1 — 25 paying (~$2K MRR), < 2 founder pages a week, dunning
recovery measured working, gross margin ≥ 70%, CAC measured, support and
billing at `execute` (support after 10 clean witnessed cycles, per
`mature-machine.md` §4) — plus: median time-to-first-mail ≤ 10 min
*unwitnessed*, time-to-aha ≤ 4:00, pentest done, RLS live with 0 cross-tenant
findings across two audit cycles, §B's G1 column met.

Waves (sketched; detailed at H0 exit):

- **W11.1 Schema split I** (0048, 0027) — `shared/schema.ts` → `shared/schema/<domain>.ts`; the client imports browser-safe types only; the bundle gate pins "no schema chunk".
- **W11.2 Jobs and storage** — `server/jobs/runScheduledJobs.ts` into per-domain modules under `server/jobs/jobRegistry.ts`; `server/storage.ts` into repositories.
- **W11.3 Outreach end to end** — campaign, mail and SMS E2E in CI; the mail reply channel (with partner input); every agent send on the governed lane, pinned by census.
- **W11.4 Deals e-sign** — DocuSign orchestration adapter on K14, provider-agnostic per `docs/esign/PROVIDER_BOUNDARY.md` (orchestrate, not build).
- **W11.5 Finance completion** — the borrower portal's "new URL coming soon" banner resolved; Reg Z statement automation; the 90-day wind-down E2E; `/api/portal/:accessToken/*` retired at sunset.
- **W11.6 Tenancy in depth** — Postgres RLS on the ten highest-value tables; org-scoped writes ≤ 50; pentest (K19).
- **W11.7 Pax consolidation** — the `/api/founder/v10`, `v11`, `v12`, `v14` prefixes (v13 is already retired) renamed to domain names behind the four doors; `server/ai/supportAgent.ts` and `server/ai/tools.ts` split by door; `scripts/eval-gate.mjs` — which runs on path-filtered PRs and exits 0 without an API key — gets a CI key and becomes a required check; `openai-bypass` ≤ 30.
- **W11.8 Onboarding and activation** — time-to-aha ≤ 4:00; sample data cleared when real data arrives; contrast across the 12 themes and named sliders (elite-bar review).

Continuous: a table-drop batch every two weeks · k6 (`tests/load/k6-baseline.js`) at
10× the 25-customer load on staging before the first real ad dollar · the
restore drill as a weekly CI-visible signal · founder routes ≤ 55 · a 7-day
step-away drill.

### H2 — second engine and the deletion campaign (G1 → G2)

**Exit** is G2: 100 paying, ≥ 10 closed deals in `transaction_training`, the
first organic cross-customer deal, 99.9% quarterly probe uptime with a live
error-budget policy, LOC ≤ 650K and tables ≤ 500; by H2's end ≤ 600K and ≤ 450.

Note servicing productized (repricing is a hard stop → founder) · marketplace
**concierge seeding only** after the founder unlock at ~25 · win-back (0150)
with founder copy · GA pricing per ruling #8 · the remaining monoliths split
(`routes-admin.ts`, `routes-founder-intelligence.ts`, `routes-rent-ledger.ts`,
`routes-notes.ts`, `workflow-engine.ts`; `properties.tsx`, `leads.tsx`,
`finance.tsx`, `borrower-portal.tsx` to ≤ 1,500 lines) · 0067 tsc errors to 0,
mostly by deleting the modules that carry them.

### H3 — industrialize the moat (G2 → G3)

County ETL as a production line with a per-source health ledger · score
versioning and drift monitoring · API private beta (≥ 5 partners, only past ~50
customers) · second ad channel · incident response ≥ 80% auto-resolved ·
self-patch auto-merge for the deletion and dependency classes only · LOC grows
only net of deletions.

### H4 / H5

H4: API and data GA; capital markets only as a real note-securitization
revenue line; a rehearsed multi-region cold rebuild; registered verticals promoted as each
clears its honesty bar (`founder-decisions-2026-07-28.md` §11). H5: the steady state of `mature-machine.md` §1.4,
with the succession pack tested yearly.

---

## §D The next eight waves (H0), in detail

**Every wave carries:** an exclusive file set declared up front · red-first
tests · gates redirected to files with `$?` echoed (never through a pipe) ·
`npm run check`, `npm test`, `npm run build` run by the verifier, not taken from
a report · an independent completeness audit by an agent that did not build it
· a hunt for things built but not wired · ratchets lowered in the same commit ·
`docs/audits/defect-registry.md` updated and its summary recounted · a row in
the reconciliation queue.

| Wave | Scope | Proof |
|---|---|---|
| **W10.1a Deploy gate and CI truth** [E] | `.github/workflows/deploy.yml` requires `ci.yml` (called as a reusable workflow) on the SHA it ships, alongside `test` (which already runs `migrate.mjs --dry-run` via `db:build-from-repo`). `scripts/check-bundle-size.js` blocking in `ci.yml` with down-only ceilings. A register of every `continue-on-error` (`docs/audits/ci-advisory-register.md`). `console-in-server` 6 → 0, `empty-on-failure` 13 → 0. A LOC counting rule (`npm run measure:loc`; a ratchet once the stop rule takes effect). | `deploy.yml` runs only on `main` or by hand, so a scratch branch proves nothing: dispatch it by hand on a ref whose `ci.yml` or `security.yml` is red and record that no deploy step ran; plus a unit test that parses `deploy.yml` and fails if the gating `needs` is removed. |
| **W10.1b Security green, then a gate** [E; an image fix may need K-level access to the registry] | Upgrade the dependencies `npm audit` flags critical/high (maplibre-gl — a major version, behind the Map door; multer; sharp; undici; fast-uri; brace-expansion), clear the Trivy fs/image findings or record each in `.trivyignore` with a reason, then add `security` to `deploy`'s `needs` (`PENDING_GATES` in the test forces it the moment it is called). | Security Gate green on main for the SHA, then the same live dispatch proof. |
| **W10.2 Live-lead reads and the scale ceiling** [E] | 0273: one live-lead predicate adopted by the ~50 reader files. Both pinned exceptions stay: the import/create duplicate checks and the inbound-SMS match still see deleted leads, so a STOP's opt-out survives deletion. 0169 paginated pickers. 0171 cursors or refusals in place of 5,000-row caps. 0243 Today from a snapshot. | A census ratchet whose population floor is the reader file count; fixtures over 5,000 rows. |
| **W10.3 List builder v0 behind Map** [E; full coverage on K10] | Pick a county; filter acreage, owner type, years owned; count and cost before commit; save to the existing list model. Layered providers (ruling #2). County status vocabulary. | Refuse-not-fabricate tests; the wedge E2E list step; nav and sidebar tests unchanged. |
| **W10.4 Deal state truth** [E; 0235 with F] | 0276: creation at a late stage goes through the state machine; typed 409 for a stale version; advance-stage reads contract evidence. 0244: advance-stage, bulk and Pax closes recorded by one close writer. 0258 (1): the close-evidence read and the training-row insert in one transaction. 0235: network retraction on reopen (a data change on a shared aggregate — founder decides). Owns `server/storage/dealRepo.ts`. | A census that every production writer of `deals.status` calls the canonical writer (law 2), one test per path. |
| **W10.5 Money residue** [E, then F3/K18] | 0185 across later installments; the 0277 export-first dry-run script; the 0052 report for F3; autopay checks `pendingCheckoutSessionId` (0265 (4)); the `ach_actum` enum value removed (the Actum rail was deleted 2026-07-29; `server/services/actumProcessing.ts` stays — autopay imports its NACHA return codes); 0050 coded error bodies. Owns `server/services/achAutopay.ts`. | Cents-exact property tests over multi-installment schedules; `moneyCustodyHardStop.test.ts` stays green. |
| **W10.6 Tenancy and AI safety** [E] | Org-scoped writes 248 → ≤ 150 (routes first; `dealRepo.ts` and `achAutopay.ts` belong to W10.4 and W10.5). 0017 per-user AI cost cap on every model path. 0018 prompt envelope on mail replies, documents and web inputs. Census of agent sends on the approval kernel. | Injection fixtures red first; ratchets lowered in the same commit. |
| **W10.7 Founder consolidation and deletion I** [E, with F1] | Delete the five legacy redirect routes (`/founder/dashboard`, `/cockpit`, `/now`, `/today` → `/founder`; `/v13` → `/founder/bridge`); fold `command` into The Letter; keep `bridge` as the deep chat+telemetry tool CLAUDE.md names; move `/founder/onboarding-funnel` into a Letter section. Delete the `routes-kpis.ts` 501s. Wire or remove the "not yet live" workflow triggers — rewrite `workflowActionHonesty.test.ts` to the new truth, never delete it. `moduleOrphans` → 0. | `FOUNDER_ROUTE_BASELINE` ≤ 70; net LOC < 0. |
| **W10.8 Polish on the wedge path** [E] | The §E bar on Today, the Map builder and import, Deals, the Outreach composer and Inbox. | axe output at 375 and 1440 px to files; mobile E2E; `lint:voice`; `lint:semantic-contrast`. |

**Order:** W10.1a first (everything merges through its gate), W10.1b next · W10.2 before
W10.3 (the builder writes leads) · W10.4, W10.5, W10.6 in parallel, with
`server/ai/tools.ts` owned by W10.4 alone · W10.7 at any time · W10.8 after
W10.3.

**Ready to fire the day a key lands:** **KA** (K1 + K2) the wedge E2E and the
desktop suite blocking · **KB** (K7) Lob armed, first witnessed live piece ·
**KC** (K10) Regrid provider, full-coverage lists · **KD** (K3) the restore drill, and a live proof of document storage
(0143/0046 are built and dormant until the bucket exists).

---

## §E What "mature, polished, refined" means — measurably

A polish claim that no test or gate pins is not claimed.

| Aspect | Bar | Pinned by |
|---|---|---|
| Every door | Every query-backed region: a shape-matched Skeleton, an `EmptyState` with a purposeful CTA, a `QueryErrorState` with retry. No spinners. No "coming soon" or 501 reachable from a customer path. | customer-journey and desktop-feel audits; a lint census |
| Accessibility | axe: 0 serious/critical on every door at 375 and 1440 px, light and dark; every door task keyboard-completable; icon buttons labelled; contrast across all 12 themes | `test:a11y`, `lint:semantic-contrast` |
| Performance | Server p95: Today ≤ 400 ms, Deals ≤ 300 ms, Finance ≤ 500 ms, Map count ≤ 800 ms. LCP ≤ 2.5 s on mid-tier mobile. Initial JS under the bundle ceiling | k6 on staging, `scripts/check-bundle-size.js`, Sentry performance (K4) |
| Mobile parity | `MOBILE_DOORS` equals the sidebar; each door's primary task passes on mobile | `sidebarHiddenRoutes.test.ts`, `e2e-mobile` |
| Copy | One vocabulary per persona; status words from the canonical list | `lint:voice`, `lint:status-vocabulary` |
| Truth | No invented number anywhere; every figure carries provenance or refuses | `lint:no-fabrication`, `lint:measurement-defaults`; empty-on-failure, self-fallback, inline-provenance at 0 |
| Money | One posting rule for every writer; integer cents; precise money columns; customer money only on the customer's processor | `moneyCustodyHardStop.test.ts`, `financePaymentIsRecordedOnce.test.ts`, `numeric-no-precision` |
| Communications | Every send through the approval kernel; BYO identity; DNC fail-closed for cold outreach; STOP honoured in hold; SPF/DKIM/DMARC pass | kernel census, `lint:kernel-boundary`, `scripts/audit-email-deliverability.mjs` |
| Pax | Every tool scoped, leaving a receipt or a refusal; blocking evals; per-user cost cap; envelope on every indirect input; no bypass of the model router | `scripts/eval-gate.mjs`, `lint:prompt-envelope`, `openai-bypass` = 0 |
| Platform | All E2E blocking; no `continue-on-error` on a gating job; weekly restore drill green; 99.9% probe uptime | the workflow register, the uptime probe |
| Tenancy | RLS on the top tables; unscoped writes 0 or RLS-covered; 0 cross-tenant findings two cycles running | org-scoped writes ratchet, `lint:org-fetch` |
| Code | 0 tsc errors; the §B file-size ceilings; unreached and orphan code at 0 or allowlisted with a reason | `npm run check`, line-count ratchets, `lint:reachability` |
| Founder | Four doors; route count within baseline; decisions batched; minutes per $1K MRR falling | `founderFourDoors.test.ts`, `server/services/founder/readinessLadder.ts` |
| Governance | Unenforced hard stops stay at 0 | `constitution.test.ts` |

---

## §F Deliberately not on this roadmap — and what would bring each back

| Item | Reactivation trigger |
|---|---|
| New top-level nav (customer or founder), persona verticals, AI destinations | Never, short of an explicit founder rescission |
| Marketplace | FREEZE — ~25 customers + founder unlock (concierge only); GA at G2's liquidity proof |
| Public API | ~50 customers; private beta at G3 |
| Residential comps / fix_and_flip activation | Their revenue trigger (`check-residential-comps-hold`) |
| A vertical not already registered | Not before G1 (readiness plan). Registered verticals continue under `founder-decisions-2026-07-28.md` §11, each behind its honesty bar |
| Capital markets | H4, as a real securitization revenue line |
| White-label | The first enterprise contract |
| Win-back (0150) | G1, with founder-approved copy |
| Acting autonomy switches | `mature-machine.md` §4, from G1, after clean witnessed cycles |
| Paid ads beyond the witnessed $5/day | Founder only, ramped on measured CAC |
| Academy (0127) | Not reactivated — the ledger's KILL is executed (F5) |
| Native app-store release | Mobile usage evidence at G2 |
| Multi-region | H4 rehearsal |
| 1099-INT | K13 tax-reviewer sign-off |
| "Divorce" signal | K12, then F4 |
| Negotiation orchestrator | Revisit at G1 if usage is zero |
| New V-numbered founder modules | Never — consolidation only |

---

## §G How progress stays honest

1. **Scoreboard.** `mature-machine.md` §0's two numbers — MRR composition, and
   founder minutes per week per $1K MRR — plus the readiness table of
   `public-readiness-plan-2026-09-29.md` §6, refreshed in the Execution ledger
   below at every wave merge. Gate crossings are dated only in
   `mature-machine.md` §2. Sources are measured, never declared:
   `server/services/founder/readinessLadder.ts`, `customers.md`,
   `scripts/ratchets/*.json`, and the recounted table in
   `docs/audits/defect-registry.md`.
2. **Every ledger claim cites four things**: the commit, the test that was red
   first, the gate output file, and the independent audit's verdict. A claim
   missing one does not count.
3. **Anti-recursion.**
   - Every wave cites a gate criterion, friction a design partner was observed
     hitting, or a registry/ratchet line. "Maturity" alone never justifies one.
   - While a gate is blocked on owner actions, only the credential-triggered
     waves (KA–KD) and waves with net LOC ≤ 0 run (the stop rule above).
   - A scope unlock needs three consecutive cohort months in which
     time-to-first-mail holds its target, gross margin is ≥ 70%, support load
     per customer is flat, and founder minutes per $1K MRR fall.
   - Planning documents are surface too: this file replaces, it does not
     accumulate. Stale docs are corrected or deleted at each gate crossing.
4. **The three laws, on every new gate:** a fixture that holds the semantic
   defect and turns it red; a census of production adoption for any canonical
   function; a vacuity floor on the population it reads.
5. **Cadence.** Regenerate as `roadmap-YYYY-MM.md` at each gate crossing;
   review annually with the Constitution.

---

## Execution ledger

| Date | Wave | Commit | Red-first tests | Gate outputs | Audit verdict |
|---|---|---|---|---|---|
| 2026-10-01 | W10.1a Deploy gate and CI truth — deploy needs `test` + CI (called workflow; Security deferred to W10.1b because it is red on main); bundle budget blocking in CI with down-only ceilings; `continue-on-error` register incl. composite actions; `empty-on-failure` 13→0 and `console-in-server` 6→0; LOC counting rule (`npm run measure:loc`, 855,971 at this commit); DEFECT-0278–0280 fixed, 0281 opened | the W10.1a commit (see `git log`) | `deployGateRequiresCiAndSecurity`, `bundleBudgetIsDownOnly`, `ciAdvisoryRegister` (each mutation-checked), `quietHoursNeverOverwritesUnread`, `paxRailWatermarkMovesOnRead`, `locCountingRule` | `npm run check`, full vitest and `npm run build` exit 0 before commit (verifier-run, outputs redirected to files) | independent audit found 1 P0 (Security red on main → split into W10.1b) and 4 P2, all addressed before commit; live dispatch of `deploy.yml` on a red ref is owed after the merge to main; CI/ESLint/truth-engine/coverage have never run on this branch's SHA — the PR's CI run is that proof |
