# AcreOS Roadmap — October 2026: from zero customers to the mature machine

*Layering: `CONSTITUTION.md` → `mature-machine.md` (destination, gates G0–G4,
horizons H0–H5) → **this document** (waves under the active horizon) → decision
memos. It supersedes the execution ledger of `roadmap-2026-07.md`, whose open
W6.3/W7 items fold in below. `public-readiness-plan-2026-09-29.md` remains the
phase plan for crossing G0 and G1; this file schedules the engineering under it
and reuses its §6 scoreboard. Original snapshot: `b9b1330` on 2026-09-30. Execution state reconciled against `b852ce34188131f3a78d8ebdab218e43bc691c6a` on 2026-10-13; see §I.*

*Nothing here relitigates CLAUDE.md's DO-NOT-DO list or a dated founder ruling
(§F maps each to its reactivation trigger).*

## The through-line

No gate crossing has been established by the current execution. Historical
records listed Active 0 / Trial 0; current live customer counts are unknown
until billing and organization records are read. The repo's own verdict is
"broad scope and little proof", and its research warns against "the recursive
maturity program". So **mature** here means *the capability that exists is true,
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

## §H The launch program (founder direction 2026-10-09)

On 2026-10-09 the founder set a launch program: AcreOS launch-ready at the
lowest cash cost. Its principles are the same as this file's:
- spend Claude credits, not cash;
- no fabrication;
- verify every wave instead of trusting its report;
- ratchets only shrink;
- hard-stops stay founder-only.

The decisions behind it are recorded in `founder-decisions-2026-10-08.md`
(the 2026-10-09 sections).

Its waves are named **LP-W0 … LP-W6** so they do not collide with §D's W10.x
numbering.

**Scope reconciliation (2026-10-13).** The founder explicitly adopted the
39-ticket Public Readiness and Native Growth plan and directed its execution.
This authorizes those enumerated repairs and the native Growth integration;
it does not unlock unrelated feature waves, remove a G0 proof requirement,
or authorize account purchases, customer-data repair application, pricing,
legal signing, paid publication or a production deployment. The narrow launch
promise remains constrained by §I's recorded evidence. The older stop rule
continues to govern work outside this directed scope.

| Wave | Scope | Cash | Status |
|---|---|---|---|
| **LP-W0** Cost efficiency | Metered AI gateway (94 → 14 direct call sites); a platform AI ceiling scaled to MRR; the dormant $250 grant removed; a cost-to-serve alert; decisions A–C and Scale's $45 allowance; mail-credit recharges granted; legacy tier names folded | $0 | built (PR #339) |
| **LP-W1** Flawless and protected | Accessibility (93 axe issues); 8 dead ends; plain-words refusals; **support autonomy** (under 24 founder min/week); a real AI eval or an explicit NOT MEASURED; guards (AI-voice written consent, heirs' property, contract-for-deed rules, ethical outreach); CA auto-renewal; one-click full export; security baseline (2FA, sealed credentials, off-provider backup with a tested restore); strategy docs to a private repo | $0 | implemented in current main; simulation and source tests are not live workload/restore/model proof (see §I) |
| **LP-W2** Data foundation | Tennessee showcase preload (vacant and rural parcels, per-fact source and confidence, GeoParquet and PMTiles on R2's free tier); an on-demand county pipeline with refusal and "request this county"; a free-county-source census; small national datasets; tax-sale source registry; MapLibre with a free basemap; data-truth warnings; an accuracy gate before anything is shown | ~$0 | implemented in current main; allowed county load, durable artifact proof and licensed accuracy replacement still unverified/blocked (Oct11 ruling) |
| **LP-W3** Acquisition engine | A public Tennessee parcel report and a free landlocked checker (on `publicParcelReport.ts`); sourced county guides, llms.txt and structured data; creator revenue share; a founding-member yearly offer **[F: plan and price]**; a per-parcel report **[F: price]** | $0 | implemented in current main; creator commission, yearly offer and parcel-report price remain founder decisions; real activation proof pending |
| **LP-W4** Forecasting | A monthly vintage recorder (starts the clock); a cycle-phase model with walk-forward backtests on real-time vintages, gated by the evidence ladder; seasonal priors; county-forecast slots labelled "warming up"; a fair-housing check | $0 | implemented in current main (`e8e12d3c`, `a85b6fd0`); real-time vintages require elapsed time; forecasts remain evidence gated |
| **LP-W5** Trust, giving, growth | Owner opt-out and deletion; **giving at $1 per paying member per month** with receipts and a founder cap; fraud-check signals; collateral watch; Spanish; guided A2P 10DLC; migration import; offline maps; a first-deal-in-90-days program; a real customer outcome metric | giving only | implemented in current main (`a843f108`, `0e0a47a3`, `0007a1e6`, `c444c3c7`); giving transfer and credentialed customer journeys not externally proven |
| **LP-W6** Real-model proof | Pax, Solene and land-data explanations against a real model under the ceiling, moving evidence from E2 to E3 **[K: model API key]** | ≤ $25 | blocked on the key |

**Later, gated by revenue (the self-funding rules).** Each unlocks only when
trailing revenue covers it, and an automatic brake stops data-plane spend
when the plane runs net-negative:
- the four-state preload;
- paid data;
- the Sentinel-2 change watch;
- "land like this";
- the co-op;
- marketplace (~25 customers) and API (~50), per the DO-NOT-DO ladder;
- residential comps (its own trigger).

---

## Execution ledger

| Date | Wave | Commit | Red-first tests | Gate outputs | Audit verdict |
|---|---|---|---|---|---|
| 2026-10-01 | W10.1a Deploy gate and CI truth — deploy needs `test` + CI (called workflow; Security deferred to W10.1b because it is red on main); bundle budget blocking in CI with down-only ceilings; `continue-on-error` register incl. composite actions; `empty-on-failure` 13→0 and `console-in-server` 6→0; LOC counting rule (`npm run measure:loc`, 855,971 at this commit); DEFECT-0278–0280 fixed, 0281 opened | the W10.1a commit (see `git log`) | `deployGateRequiresCiAndSecurity`, `bundleBudgetIsDownOnly`, `ciAdvisoryRegister` (each mutation-checked), `quietHoursNeverOverwritesUnread`, `paxRailWatermarkMovesOnRead`, `locCountingRule` | `npm run check`, full vitest and `npm run build` exit 0 before commit (verifier-run, outputs redirected to files) | independent audit found 1 P0 (Security red on main → split into W10.1b) and 4 P2, all addressed before commit; live dispatch of `deploy.yml` on a red ref is owed after the merge to main; CI/ESLint/truth-engine/coverage have never run on this branch's SHA — the PR's CI run is that proof |
| 2026-10-01 | W10.1b part 1, Security made green — outside data no longer reaches the DOM as HTML (DEFECT-0282: the map's comp popup and Pax's print window build DOM text; a parsed gate over every sink shape); dependency CVEs fixed (DEFECT-0283): `npm audit fix` in range, sharp 0.35.5, and the MapLibre preview engine removed with maplibre-gl (it never fully rendered; Mapbox GL is the one renderer) — root `npm audit` 0 vulnerabilities; default map download 2598 → 1796 KB, total JS 10758 → 9958 KB, both ceilings lowered; LOC 855,971 → 855,869 | the W10.1b commit (see `git log`) | `noDataReachesTheDomAsHtml` (red at the parent; a canary per sink shape), `bundleBudgetIsDownOnly` | `npm run check`, full vitest and `npm run build` exit 0 before commit (outputs redirected to files) | Trivy fs/image cannot run in this container (GitHub release and ghcr downloads refused), so the first `Security Scanning` run on the PR's SHA is the proof owed; part 2 — `security` in `deploy`'s `needs` — lands only after that run is green; `tests/e2e-intelligent` keeps three moderate (the SDK and vitest, both needing majors) and one low (esbuild, held by tsx/vite) dev-only advisories |
| 2026-10-11 | LP-W1a Protections — consent, AI origin, tier folding, checkout intent, routine-support autonomy, eval truth, outreach guards, CA auto-renewal, full export, security baseline; then the 2026-10-10 rulings (support/ops/deploy seeded at execute_gated, the digest lane with undo, the digest-lane calibration exemption) and three demotion defects found in the simulated year (retention briefed on already-emailed orgs; a requeued provider blip charged as failure; the stand-in brain had no Iris) | `e5e2779b` on `claude/w1a-protections` | per commit message; each guard mutation-checked (e.g. `digestLaneRunsOnlyReversibleWork`, `digestLaneRiskExemption`, `retentionBriefingSkipsEmailed`, `requeuedBlipCostsNoAutonomy`, `workerCoverageIsChecked`) | full `npm test` exit 0 at `e5e2779b` (1327 files / 16,802 tests); `npm run check` exit 0 (outputs redirected to files) | no independent audit yet — owed before merge |

### LP-W1a: the simulated founder year (5 seeds × 365 days)

Founder minutes per week, over every week of every seed (265 weeks per row):

| Run | p10 | p50 | p90 | Mean | Dropped tickets |
|---|---|---|---|---|---|
| 2026-10-08 baseline | 11 | 38 | 58.6 | — | p50 7 |
| After the 2026-10-10 decisions (`01820c37`, before the defect fixes) | 9 | 45 | 74 | 43.9 | p50 12 |
| `e5e2779b` (fixes + Iris stand-in) | 0 | 9 | 39 | 15.6 | 0 in every seed |

**End levels at `e5e2779b`.** Growth, support, deploy, ops and finance end
at execute_gated in all 5 seeds. In the earlier runs, ops and deploy ended
at observe and support and growth at draft. Those demotions came from three
things:
- the stand-in brain had no answer for Iris;
- the retention worker was briefed on orgs it could not email;
- a requeued provider blip was charged as a failure.

**Asks by kind at `e5e2779b`.** No autopilot move asked the founder in any
seed. Earlier, about 340 move-approval asks per seed: `clear_support_backlog`,
`grow_owned_channels`, `retain_at_risk`, `optimize`, `resolve_incident`.
Every remaining founder minute is a support ticket the policy holds by
design. Per seed:
- unclear: 33–49;
- legal: 22–30;
- refund over $50: 9–14;
- bug: 6–9;
- other: 0–3.

Asks are now labelled by the reason each one states. Before, any ask that
quoted "refunds up to $50" was counted as a refund.

**Read this with care: the Iris outcome mix is an unsourced assumption.**
The stand-in decides how Iris's ops and deploy tasks turn out:
- 10 in 100 fail;
- 20 in 100 find nothing to do;
- 70 in 100 do the routine task.

These rates are stated in `tests/simulation/standin/brains/capable.mjs` and
have no source. A real model's rates are E3 evidence (LP-W6). The year run
now fails when any worker's calls go unanswered by the brain
(`workerCoverage.ts`), so an unmodelled worker cannot silently become a
demotion again.

## §I Directed readiness and native Growth execution — 2026-10-13

The founder adopted the 39-ticket report dated 2026-10-13 and directed its
execution. This is the execution record within the existing roadmap, not a
second provisioning authority. **G0 remains unproven.** A source implementation,
a simulated result, a green wrapper with skipped steps and a live receipt are
different evidence classes. Nothing here marks the whole program complete.

**Active priorities (maximum three):** (1) reconcile degraded production health
and owner readiness evidence; (2) land and verify the directed Growth rebase
and durable progress repairs; (3) prove publication refusal/receipt semantics
without enabling spend. Real restoration, licensed county proofs and staging
journeys unblock the subsequent acceptance gates. Unrelated expansion remains
deferred by the standing stop rule.

The October 13 follow-up explicitly authorizes updating GitHub main with validated
changes. It does not turn absent external acceptance receipts into completed tickets.

**Release boundary:** base main `b852ce34188131f3a78d8ebdab218e43bc691c6a`;
local branch `codex/acreos-readiness-execution`. Public app and fresh worker heartbeat both reported that base SHA.
App health was **degraded**, not healthy. A later authenticated browser read reached
Controls and Decisions; their live findings are recorded below. A later live Job health read identified the failing retract query; DEFECT-0285 records the release-path omission and the limits of that evidence. Actual worker image,
migration ledger and physical-device evidence were not inspected. Earlier CI/security/mobile proofs are baseline evidence,
not evidence that these local changes are deployed.

Statuses mean: Implemented locally = code written, external proof still open;
Partial = specified acceptance only partly established; Open = engineering
still required; Blocked = named account/access/data/time proof cannot be
manufactured locally. Blocked does not mean an account is missing in production.

| Ticket | State | Evidence / actual work | Remaining acceptance or dependency |
|---|---|---|---|
| P0-01 | Partial | §I reconciles scope, LP state and active priorities; 23 registry entries currently OPEN/PARTIAL. | Current-consumer closure census and independent release review remain. |
| P0-02 | Partial | Public app and worker heartbeat both reported b852ce34; heartbeat fresh at 2026-10-13T12:48:25.446Z; cached health still degraded at 12:48:22.899Z. | Founder sign-in observed; authorized app/worker image, live catalog, release and migration reads remain. The live retract query fails; its underlying database cause and the degraded-health root cause remain unknown. |
| P0-03 | Partial | tests/unit/deployGateRequiresCiAndSecurity.test.ts parses required CI/security job dependencies. | Isolated negative workflow run and separate rollback receipt; no production dispatch performed. |
| P0-04 | Partial | Authenticated live Controls shows 4/13 setup rungs verified, two essential rungs left; canonical readinessLadder remains authority. | Resolve paging, confirm owner budgets and remaining account decisions; keys resolving is not a completed operational proof. |
| P0-05 | Blocked | Existing backup/restore procedures retained; no actual recovery claim. | Infrastructure backup/object access and isolated PostgreSQL restore target; no database mutation performed. |
| P0-06 | Partial | Worker preserves bounded CMO receipts; generation parent identity follows render children and dead letters. | Live heartbeat/worker isolation and restart/timeout drill across all critical job classes. |
| P0-07 | Blocked | Baseline CI/mobile/security jobs ran on b852ce34; scheduled audit issues 301/302/304 identify absent target configuration in their captured runs. | Current staging target and synthetic credentials; rerun actual authenticated journeys, not auth-bypass fixtures. |
| P0-08 | Partial | DNC, STOP, owner suppression and late-opt-out regression families exist and are included in the acceptance test selection. | Actual account activation proof and policy-specific servicing determination; no real outreach sent. |
| P0-09 | Partial | Credit grants, replay, pool resets and customer-money routing regression families included in acceptance selection. | Live price/account read-back and witnessed sandbox lifecycle; no charges/refunds issued. |
| P0-10 | Blocked | Oct11 URL-level TN prohibition and coordinate routing tests retained; real-schema county pipeline exists. | Allowed Comptroller file and replacement labelled sample, artifact storage verification. Legacy 20-parcel fixture is not licensing proof. |
| P1-01 | Partial | Public report, landlocked checker and county-guide source/tests exist on main. | P0-07/P0-10: same-parcel auth return and first REAL useful outcome on licensed served data. |
| P1-02 | Partial | Offers now searches/paginates the permitted book, labels matching totals and resolves identities by id; three DOM cases pass. 0169 population census and 0171 whole-book consumers remain open. | Repair each consumer with search/by-id/aggregate or explicit pagination; real >5000-row interrupted import/rollback proof. |
| P1-03 | Partial | Existing parcel provenance/accuracy projection, DD and economics contracts retained. | Practising-investor journey, conflicting/stale data and insufficient-comps offer refusals on allowed corpus. |
| P1-04 | Partial | Existing approval kernel, provider receipt, inbound and idempotent mail tests retained. | Credentialed exact-revision recipient/sender/asset/cost witness and provider timeout/replay drill. |
| P1-05 | Partial | Creation now validates canonical vocabulary and opening stages at the sole server insert; CSV and labelled sample callers explicitly retain canonical historical stages. Six callers independently censused. Single-deal deletion now reaches the existing permission-scoped bulk writer. Close evidence and concurrency remain open. | Predicate-sensitive real-db one-close-writer census, Close & Carry training race and stale-version conflict recovery on every caller. |
| P1-06 | Open | 0185 remains OPEN (later installments/fee-posting concurrency); 0277 historical refund application remains owner operation. | Sandbox borrower cookie/checkout/ACH overlap proof and exact-cent reconciliation; never apply historical repair silently. |
| P1-07 | Partial | Growth plan, review and progress reads now distinguish errors from empty; save/brief forms retain work; queue ID shown. | Complete wedge state census and recovery testing beyond Growth. |
| P1-08 | Blocked | Growth uses existing semantic controls and responsive four-tab layout; DOM tests are not iPhone proof. | Physical iPhone Safari/VoiceOver and credentialed WebKit full-journey evidence. |
| P1-09 | Open | 0243 still reproduces: Today awaits runPortfolioHealthJob per GET. Existing bundle budgets retained. | Agree p75 targets; measure on representative hardware/dataset before changing scheduled behavior. |
| P1-10 | Blocked | Eval workflow success can skip real baseline/regression stages; keyless stubs never certify quality. | Bounded real-model run, served/requested model and judge-mode evidence, human review; no paid provider calls here. |
| F-01 | Partial | Existing Letter quiet-day collapse/readiness/outcome sections preserved by rebase. | Live two-minute phone task and health/revenue/freshness evidence. |
| F-02 | Partial | Growth Review links canonical Decisions. Live last-30-day view shows 74,254 Needs you records and repeated stale-lead/job-failure prompts in its latest 50. | Initiative pending/deferred cards now deduplicate by org/agent/action/input with a transaction-scoped advisory lock; three boundary tests pass. Two real-PostgreSQL concurrency/predicate cases are added but locally skipped without an isolated database. The authority gate now also deduplicates identical proactive/reaction pending or deferred observations without granting execution; five unit cases pass and two PostgreSQL cases await CI. Other producers, rejected-card changed facts, domain filters, aging/cost/held previews, expiry/replay and actual one-result proof; no historical cards silently dismissed. |
| F-03 | Partial | Growth inside existing Controls saves bounded audience/positioning; seed preserves edits; master publishing setting uses existing canonical writer. | Live read-back and Story witness; other Controls sections remain current source, not newly certified. |
| F-04 | Partial | Worker-backed progress links existing Story; raw provider errors excluded from job-status API. | Receipt chain across exact approval revision/account/cost/outcome and sensitive-data-safe export. |
| F-05 | Blocked | Simulation mean 15.6 min/week, p90 39; no claim of <24 every real week. | A week of actual attention/interrupt/aging observations; fresh facts before repeated owner asks. |
| G-01 | Partial | Merged in PR #352 at a85e02af after independent audit and all seven workflows / 14 checks passed, including full tests/coverage/build/security/mobile/customer journeys. | Main-branch release and live founder read-back remain separate proof; publication does not prove production behavior. |
| G-02 | Partial | Existing outbox payload holds whitelisted completion receipt; children carry trusted parent ID; DLQ read survives terminal move; UI polls durable jobs. | Worker restart/key revocation/failed-ratio drill, provider cost completeness, cancellation and safe generation recovery. No automatic retry control added. |
| G-03 | Partial | Transactional decision claim/enqueue; atomic per-platform manifest claim/merge; own destination receipt precedes aggregate status; uncertain outcome refuses replay; created objects no longer called live; performance consumer reads destination records. | Real-db concurrent claim/merge test, account/revision identity and upload/ad-review/organic URL reconciliation; legacy receipts do not prove delivery. |
| G-04 | Partial | Fresh canonical publish/panic read before upload and object creation; bounded upload-account identity guards and ambiguity refusals; destination config preflight; nonnegative integer operating caps validated; missing operating-budget row refuses generation. | Exact approved revision/account/assets, atomic spend reservation/invoice settlement and concurrent near-cap proof. Current budget gate is not a hard reservation. |
| G-05 | Open | Existing growth-intelligence endpoint is analytics, not a sourced opportunity inbox; removed generic Sprout suggestion and failed-read-as-zero behavior. | Bounded sourced opportunities, retrieval/freshness/policy context, untrusted-input envelope and three useful moves; no public username outreach. |
| G-06 | Open | Reuse marketingArtifacts, existing creative objects and canonical Decisions; no new calendar/approval database. | Revisioned educational artifacts/calendar, invalidated edited approvals, deduplicated scheduling and explicit manual handoff. |
| G-07 | Open | Strict observational signup summary is a lower bound; failed source is unavailable. Existing outcomes/creator/billing remain their canonical records. | Windowed visit→signup→real outcome→paid→refund→retained joins, sample exclusions and unmatched attribution. No CAC or incremental revenue claim. |
| G-08 | Partial | Read real attribution and canonical growth trust instead of constant zero/false; unknown remains null and locks paid eligibility. | Paid cohort/spend/refund evidence join, freshness/window/sample boundaries. CAC remains explicitly unknown; paid stays locked. |
| G-09 | Blocked | Meta creative and TikTok ad APIs are paid instruments, not evidence of organic posting. Manual handoff remains possible. | Choose one supported adapter/account with owner permission; witnessed real approved publication/read-back/revocation; no subscriptions purchased. |
| G-10 | Blocked | No growth winner or conversion benchmark invented from pre-customer source. | Actual cohort and bottleneck; founder review date, hypothesis, cost/time and stop condition before traffic experiments. |
| D-01 | Partial | Registry currently has 23 OPEN/PARTIAL entries; reproduced 0169/0171/0185/0243, repaired the offers consumer of 0169 and read 0244/0258/0265/0276 rather than declaring stale docs fixed. | Complete occurrence/consumer census, semantic forbidden-behavior tests and actual repairs; historical customer data separate. |
| D-02 | Open | Canon, boundaries, reachability and down-only ratchets retained; no speculative schema/SDK abstractions added. | Incident/customer-friction-led net surface reductions and adoption proof; no customer tables dropped. |
| D-03 | Partial | Metered gateway/current cost-efficiency program retained; CMO generation/scoring cost appears in durable receipt, render costs explicitly separate. | Remaining direct/streaming/embed/transcription/image exceptions and actual invoice reconciliation/caps. Generation receipt cost is for the completed worker attempt, not cumulative retries. |
| D-04 | Partial | This section replaces stale roadmap execution state; NEXT_UP/MASTER_PLAN/COMPLETION_MATRIX point here for current execution; health degradation stays visible; no duplicate owner provisioning checklist. | Real paging/canary/restore cadence and deliberate retirement/configuration of dormant audits; no live workflow dispatch. |

### Verification receipts

Initial rebased Growth/four-door run: 4 files, 28 passing tests. Initial durable
progress run: 5 files, 33 passing tests. Publication/progress/API/DOM run after
publication repairs: 4 files, 30 passing tests. These are unit/DOM fixtures,
not real-provider or PostgreSQL concurrency evidence. Final consolidated
gates and build results are recorded after execution below.

Earlier checks and interrupted attempts below are historical receipts. The
recovered release candidate has now passed the complete repository check,
then the expanded test-type check (151 existing errors, baseline unchanged;
8,794 files loaded). Six code/evidence commits are local above b852ce34,
ending at 8b409d56; final verification is recorded below. This is not a
clean whole-suite type or test claim.

A 52-file acceptance run finished with 632/634 tests passing. One finance test
timed out at its original 30-second deadline; the isolated finance file then
passed all 20 tests with a 90-second command-line deadline (no repository timeout
changed). The eval CLI test could not bootstrap tsx's IPC socket in this runtime;
its harness now invokes Node with --import tsx, retains the strict keyless eval
assertions and explicitly blanks the model key. The final four-file reliability
run passed all 26 tests (publication 9, approval 3, Growth DOM 5, eval 9).
This does not retroactively make the original 52-file run all green. An earlier
whole-suite attempt was interrupted with exit 130 and produced no complete
verdict. Seven publication regression cases failed against the original main
handler and passed against the repaired handler. Provider publication, actual
PostgreSQL concurrency and real-model quality remain unproven.

### Additional engineering and release boundary — October 13 follow-up

The offers population repair passed three DOM cases; initiative transaction
boundaries passed three unit cases. The two actual PostgreSQL dedup/concurrency
cases correctly SKIP locally without an isolated database; they must run in the
schema-building Test/pre-deploy workflows before this behavior is certified.
No active historical cards were removed. The scanner's unsourced 60% conversion
and 70% cold-risk assertions were replaced with its actual observed age facts.
The separate proactive/reaction authority producer is now repaired locally for identical recorded observations: a PostgreSQL JSONB-derived advisory lock and active-card predicate preserve distinct facts and all historical cards. Legacy cards lack subject input and cannot safely be folded. Tenant skills/goals retain separate cards because their trusted tenant identity is not carried by this gate. The 17-case unit/authority-ceiling run passed; two actual database cases skipped locally.

Automatic approval review originally rejected publication without exact
repository/branch scope. The founder subsequently approved the named branch,
independent review and merge after required checks (October13 20:45 ET).
The authorized native push then failed because the terminal has no GitHub
credentials. Publication will use the connected GitHub Git-data integration,
with an exact committed-tree comparison, not copied credentials. GitHub main
still remains b852ce34 at this checkpoint; no gate has been bypassed.

### Authenticated live observations

An existing browser session reached live Controls and Decisions on October 13.
No credentials were collected and no live operating settings were changed.
Controls reported 4/13 setup rungs verified: model keys resolve, APP_URL is the
production HTTPS origin, Stripe answered with 42 active prices and a webhook
secret, and the system-mail credentials/from-address are configured. These are
readiness UI receipts, not end-to-end billing, model-quality or delivery proofs.
Two essential rungs remain: no paging channel resolves, and the $500/month
mail/data plus $50/month agent limits have no observed metering or owner-choice
witness. Worst-day spend is unavailable because no monthly agent envelopes
exist; it must not be interpreted as zero. All five domains are watching only,
auto-publish and self-patching are off, and a listed Support delegation expired
September 27. Real direct mail is disarmed. The app cannot verify external
watchdogs; the code-host connection reports unresolved credentials.

Controls showed 74,262 waiting decisions, while its older five-hour tick showed
74,111; Decisions showed 74,254 Needs you records plus eight questions. These
are now reconciled against the canonical needsYou union: 74,254 pending decisions + eight open asks + zero frozen sends = 74,262. The older tick is stale, not a contradictory live count. The latest 50
cards visibly repeat stale-lead prompts and job-failure alerts, including
agent_retract_cron failures. This confirms a live attention-volume problem,
but does not establish the degraded health endpoint's root cause. No card was
approved, superseded, dismissed or deleted. The dashboard's stale $0 MRR and
+0 trials line is not a current customer census.

### Required owner proofs

Use existing Controls/readiness rungs to read configuration without revealing
secrets. Live founder Controls/Decisions were inspected; infrastructure release,
migration and recovery access remain required for private operational proofs.
Provision/confirm staging and synthetic accounts, infrastructure read/restore
access, an allowed Comptroller county file, model-spend envelope and a physical
iPhone session. Commercial values and contracts remain explicit owner decisions.
No current database, billing account, external publication, paid advertising,
customer repair or production deployment was changed in this execution.

### Recovered workspace and live failure follow-up

The recovered execution branch was at 649dd6ce; the production initialization
repair survived in a separate worktree as a3a9ee47 and was cherry-picked as
59ca014d. No earlier final-check/build receipt is assumed to survive the
workspace reset. Canonical createInsertSchema replaces the raw drizzle-zod
route import. landStatusLAR now uses the container working directory or its
explicit configured path, and schemaDriftDetector reads the compiled schema
barrel, including re-exported tables and chained/spread columns, instead of
loading production TypeScript source through import.meta. Four actual
CommonJS compile/load cases pass; the earlier isolated runtime/schema set
passed 59 tests. The restored 17-file release selection passed 126 tests,
with two real-PostgreSQL cases skipped. Whole-suite attempts have no final
passing verdict: one ran out of heap, another lost the executor connection.
Its raw-drizzle-zod factory regression was repaired and the 12-case factory
file now passes; that does not certify the whole suite.

Fresh authenticated Controls at approximately 19:52 ET still reported 4/13
setup rungs and no paging channel; the waiting count had grown to 74,435.
The older four-hour tick displayed 74,280. Job health reported 70 unique
jobs and 200 recent runs (196 success, three failures, one lock skip),
with repeated agent_retract_cron failures on the initial SELECT from
agent_proposal_observations. No underlying PostgreSQL cause is shown.
DEFECT-0285 closes the confirmed source omission: the historical 0078 SQL
had never reached Fly's executable release array. Both existing trust
stores and their five indexes are now mirrored, with literal-definition
parity and an isolated release-only PostgreSQL boot/read regression. No
production migration or retry was executed; arbitrary partial table shapes
still require catalog inspection. This is not proof of degraded-health
recovery. The registry now has 20 OPEN/PARTIAL entries, including this gap.

The build's source-map removal log no longer asserts a Sentry upload after
an explicitly skipped local upload. The recovered candidate at 8b409d56
passed the production web/server/worker build and prerendered all nine
routes; 476 source maps were removed (30.2 MB). The actual bundle scan
passed: 476 JS chunks, 10,027 KB total against 10,160 KB, largest map vendor
1,068 KB against 1,090 KB. The local tsx IPC restriction was handled by Node
--import tsx for the same build and prerender scripts, without weakening
build assertions. No local Sentry upload receipt is claimed.

Complete repository check: PASS. Expanded test-type check: PASS at the
unchanged 151-error baseline, 8,794 files loaded. Restored release selection:
126 pass / two PostgreSQL skips. Authority/ceiling run: 17 pass / two
PostgreSQL skips (a prior 3 GB run exhausted heap; the completed 6 GB run
is the verdict). Release-path/migration/authority selection: 30 pass / three
PostgreSQL skips. The five distinct PostgreSQL proof cases across these
sets remain required CI work, not locally passing database proofs. Ledger
source references and schema/DDL mirrors pass; no ratchet baseline widened.

GitHub main was freshly verified as
b852ce34188131f3a78d8ebdab218e43bc691c6a. Local main had still pointed at
its ancestor d2f46b37; an ancestry-checked fast-forward now matches the
verified remote. The execution branch carries six implementation/evidence commits across
49 changed files, followed by this final verification record. No remote publication, PR, merge, migration execution or
deployment happened. Automatic approval review's publication block remains.
Required full CI/security/real-DB and the independent completeness audit
must pass before merge. The 39-ticket program and G0 remain incomplete.

### Independent audit and review-resolution repairs — 20:45 ET continuation

The founder approved publication of codex/acreos-readiness-execution to
Thmsnrtn/AcreOS, an independent review agent and merging after required
checks. The fresh reviewer identified real CMO resolution races and unwired
generic resolution paths rather than accepting the original green tests.
DEFECT-0286 records the complete repair and its remaining proof boundary.
The final independent source review cleared all identified blockers after a
36-write-site census across eight files. Dedicated resolution is now mutually
exclusive and transactional; only ready bundle assets are eligible. The
reviewer also caught the real producer's legacy actionPayload-only bundle ID,
which is supported and normalized at approval. Generic service/chat,
notification, scheduler, purge and reversal paths cannot resolve video cards
without their review transaction. Decisions and progress now hand off to the
existing video reviewer, which still uses the canonical queue. The worker
checks current approval and selected destination twice and cannot restore a
rejected status through its receipt write.

Repair regression group: 56 tests pass; two real-PostgreSQL concurrency and
rollback cases skip locally. Seven distinct database proof cases across the
program remain required CI work. An initial DOM test fixture used the wrong
request mock; it was corrected to exercise the actual generation API and
now proves the video-review link. A check started before the producer repair
was deliberately interrupted; only the new complete check is eligible as the
final verdict. Current full checks/build/CI are pending for this revised
release. The newly observed JPEG modification is excluded from the release
and preserved in the working tree. The registry has 21 OPEN/PARTIAL entries.

### Published review candidate and platform-scope correction

PR #352 is open: https://github.com/Thmsnrtn/AcreOS/pull/352. The connected
GitHub integration published ba83d56c with tree 208a268d, exactly matching
local audited candidate 9e676a37. The native terminal could fetch the public
repository but could not authenticate a push; no credentials were copied.
GitHub main remains b852ce34 until the approved conditional merge actually
occurs. Seven PR workflows started, including full CI, real-schema Test,
security, mobile and customer-surface journeys.

Final local gates correctly refused two new founder-wide reads without the
explicit platform-operations access hatch. Both occurrences now use
unscopedForPlatformOps with a reason. The tenant-scoping gate then passed
with zero new/stale entries, and the focused publication/resolution set
passed all 24 tests. The failed full-check attempt is not a passing receipt;
a fresh complete check and revised-commit CI are required. The unrelated
JPEG remains excluded and preserved. The new review fix has independent
source clearance; full suite/database/provider evidence stays distinct.

### CI scope-ceiling finding and narrowed repair — 2026-10-14 UTC

Published f3dff5fa matched local tree f331abfa. Full CI passed 17,430 tests
but failed one orgScopedFetchCoverage waiver-ceiling assertion: 18 observed,
16 permitted. The ceiling and every ratchet baseline remain unchanged. The
worker now reads only founder-global (organizationId IS NULL) review cards.
Generic approval reuses its existing lookup before mutation; all four generic
resolvers use CMO-excluding atomic writes and require returned rows before
success or execution. This removes both added exemptions. A new real-DB case
checks all four generic paths leave card, render and outbox intact; eight
distinct PostgreSQL cases across this program now require schema-building CI.
Independent review cleared the actual narrowed source diff. On the previous
head, security, mobile, customer-surface, column and migration checks passed;
Test remained running. Previous-head evidence cannot substitute for revised
head CI. Main and the 39-ticket/G0 completion status remain unchanged.

### Main reconciliation and next creation-stage repair — 2026-10-14

PR #352 merged at a85e02af2243fb08b02daf12e4205ef71daf2016. All seven PR
workflows and 14 check runs passed on c47c0ee2: full repository check, tests,
coverage, web/server/worker/container builds, bundle budgets, security, mobile,
customer journeys, columns and migration mirror. The schema-building Test
job passed with an explicit isolated PostgreSQL URL and REQUIRE flag; its
eight program cases are mandatory in that environment. Job-log downloads
currently fail with a connector transport error, so no final suite count is
asserted. Main was ancestry-checked and fast-forwarded locally. The automatic
main-branch deploy/staging workflows have started; this is not a live-release
or production health receipt. The unrelated JPEG was absent after workspace
recovery and was never published.

P1-05 next repair reproduces ordinary creation at closed/escrow/arbitrary
stages. Red-first creation tests: 11 failed / 12 passed before the repair.
The sole server insert now validates canonical vocabulary in every mode and
opening stages for ordinary creation. Imports and the two labelled seeders
use literal internal contexts to retain known historical stages; HTTP/Pax
payloads cannot select the context. A new sample deal's invalid listed status
is corrected to negotiating; its property's listed status stays intact.
Independent review accounted for all six creation call sites and cleared the
actual diff. Historical rows are untouched. The simulation seed-cohort script
remains a separate direct-insert fixture with invalid statuses, outside this
repository enforcement proof. Complete close evidence, the Close & Carry
training race, and concurrency/version proofs remain open; no ticket is
closed by merely adding a creation guard.

### Single-deal deletion reachability follow-up

The writer census found useDeleteDeal's DELETE /api/deals/:id had no mounted
server handler. The hook now sends one ID through the existing authenticated,
org-scoped, canDeleteDeals bulk endpoint rather than adding another writer.
Independent audit cleared the actual change and confirmed mounting/permissions.
The corrected red-first harness failed one request-contract case on the old
hook; the refusal case passed. The combined creation/deletion/caller/sample/
transaction/state-machine group passes all 72 tests. The first harness failure
was a missing test-library import, not proof of the product defect; no dependency
was added. DEFECT-0287 records the narrow proof and remaining count/hold/retraction
semantics. The registry now has 22 OPEN/PARTIAL entries. Creation's complete
local check passed before this hook addition; revised-head gates remain required.
PR #353 initially published creation alone at 41d01cf2; its next revision will
include this repair and require fresh CI before merge. No historical or live
customer record was deleted. Full 39-ticket/G0 completion remains unproven.

### Bounded provider account/receipt checkpoint — G-03/G-04

PR #353 now publishes creation and deletion repairs at 4ced5240 with tree
71b017d9, matching the committed source. The complete combined local check
passed with no ratchet/baseline increase; all 72 focused tests pass and both
source audits cleared. Revised PR checks remain running. Main a85e02af's
automatic release is still behind its required test/CI gates; security,
columns/migration mirror, mobile and customer-surface checks passed. A fresh
scheduled Customer Journey Audit again skipped its actual audit step because
its target was unset. Its green wrapper is not an authenticated journey proof.
No production release or health recovery is claimed.

The next local checkpoint refuses ambiguous active Meta/TikTok accounts and
binds polling/object creation to the account identity returned by that upload.
TikTok no longer ignores its supplied advertiser identity. Meta normalization
preserves its act_ prefix convention. Missing/malformed provider IDs never
become object_created: the worker records uncertain and refuses blind replay.
The provider/account group was red-first (7 fail / 2 pass); the missing Meta-ID
case was separately red-first (4 fail / 10 pass). The final provider/worker/
approval group passes 46 cases and inspects uncertain receipt parameters.
Independent audit cleared the bounded final source. DEFECT-0288 records the
remaining proof; current registry census is 23 OPEN/PARTIAL, 263 FIXED and two
DEFERRED (288 total). No secrets are copied into receipts and no provider call
was made. Complete local check passed without widening a ratchet or baseline; publication/CI remain pending for this account checkpoint.

This is not approval-time revision binding. The broader G-04 census found
ready manifests omit byte digest/baked CTA URL, approval requests carry no
displayed revision token, workers use current script/brand CTA, and TikTok UI
says 9:16 only while approval queues all ratios. Those need one coherent frozen
review/destination snapshot using existing JSON/outbox and the canonical
approval hash, with matched immutable upload bytes. Account ownership/token
permissions, spend reservations and witnessed delivery remain separate proofs.
Likewise stage locks alone cannot close P1-05: six status/delete mutation sites
and unlocked route-side close effects need reconciliation; async Close & Carry
training insertion/retraction still requires shared serialization. These remain
engineering work, not absent-credential assumptions or completed tickets.

### Fresh live and staging evidence — morning October 14

The authenticated founder Controls session is still available. It reports
4/13 onboarding rungs verified (separate from its 8/14 armed projection), no
resolving pager, unproven/unchosen default spending lines, all five domains
watching only, and auto-publish/self-patching off. The live waiting count is
74,767; the older five-hour tick shows 74,616. No queue card or operating
setting was changed. The new Growth workspace was not visible in this view;
main's production workflow remains gated. Its exact served SHA was not read.
Job health's bounded 200-run view reports 58 unique jobs, 196 successes and
four failures, with agent_retract_cron still failing on the observation-table
SELECT (latest displayed failure October 14 08:10 ET). No underlying database
cause or production recovery is inferred from the error wrapper.

Main's Test workflow passed and the production gate's real-schema test step
passed. Staging's pre-deploy tests passed, but its deployment and smoke-test
jobs skipped: the workflow requires the FLY_STAGING_APP repository variable
and that gate was not met. This proves the staging workflow did not deploy;
its overall green badge is not a staging journey or recovery receipt. The
scheduled customer-journey audit also skipped its actual audit step. No new
staging app, account permission, budget, page, spend or customer mutation was
configured in this session.

### Displayed-review revision and destination matrix — October 14

PR #353's first remote CI run passed 17,457 tests and found two test-contract
failures. The persona assertion now keeps the property listed while its deal
uses negotiating; the repository census declares its existing sweep budget.
The four-file repair group passed 55 tests, and the exact repaired head is
cd9528c5f11ea62199141b12f6b922637acb28ed (tree 7b813aeb).
All applicable checks must pass on that new head before merge. The separately
preserved account checkpoint is 22ec089a36bee384c87081aa7f1a191235d29500,
not an active PR head or deployed release.

The next bounded G-04/DEFECT-0288 source repair sends a required displayed
metadata revision from the actual dashboard into approval. Existing canonical
approval hashing is factored without changing its semantics. The transaction
locks the pending decision and referenced renders in stable ID order, compares
the served revision, refuses stale metadata before writes, and queues only the
approved render/platform matrix. Meta receives available reviewed standard
ratios; TikTok receives portrait only, matching its UI description. A selected
platform with no eligible render refuses. Missing assets disable review approval.
The worker validates both the stored revision token and approved pair before
provider effects; legacy queued jobs without this proof refuse and require
manual reconciliation rather than implicitly acquiring new authority.

The confirmation dialog keeps the complete reviewed pending snapshot despite
polling, shows its copy/videos/available ratios, disables unsupported selections,
and blocks keyboard retargeting or Escape closure during an in-flight approval.
Stale errors do not silently replace the witnessed token. Seven red-first route
cases failed before the new approval contract. Latest targeted result: six files,
88 passed (including four real DOM dialog cases); four PostgreSQL cases skipped
locally and still require mandatory real-schema CI. The real-DB fixture obtains
the actual served dashboard token and creates the canonical brand only if absent,
with cleanup limited to a row it inserted. Final source review/full gates and
publication remain pending at this checkpoint.

This establishes displayed metadata at approval and the selected matrix. It
still does not freeze or re-hash post-approval render metadata/file bytes, current
script/brand CTA or provider configuration. Approval-time account identity,
asset digest plus matched immutable upload bytes, frozen outbound copy/CTA,
atomic spend reservations, actual provider authority/delivery and displayed
rejection revision remain open. G-04 and the full 39-ticket/G0 program remain
partial; no ads, paid generation, real provider effects or customer mutations ran.
