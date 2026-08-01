# Wire-for-Real Census — 2026-06-08

Six read-only census sweeps (data/providers · AI/Pax · server jobs · client surfaces · billing/finance/compliance · integrations/infra) inventorying every placeholder/stub/sample/disabled-flag in AcreOS, classified for Tom's "wire it all for real" directive ([[project-wire-for-real-directive]]).

**Headline:** AcreOS is far more *built-but-dark* than *fake*. The customer-facing surfaces are largely honest already (the P0 honesty work held). The real opportunity is **lighting up finished capability** — jobs never scheduled, integrations gated on missing keys, modules behind OFF flags, and a few genuinely-hardcoded values.

---

## 🟢 WIRE NOW, FREE — Solene executes (the build pass)

| Item | File | Effort | Notes |
|---|---|---|---|
| **Pax real confidence** — replace hardcoded 85/90/92/95% with model-computed confidence | `server/services/paxObserver.ts:115`, `routes-pax-calibration.ts:48`, `aiRouter.ts` | M | The calibration plot is self-documented as "diagnostic-only until real confidence lands." Highest-value honesty fix. |
| **Schedule `indexAnalyzer`** (pg index recommender) | `server/jobs/indexAnalyzer.ts` | S | Complete, never invoked. Reads pg stats — zero external dep. |
| **Schedule `fairLendingAudit`** (monthly disparate-impact) | `server/services/fairLendingAudit.ts` | S | Complete, needs a monthly cron. Compliance value. |
| **Schedule `featureEngineering` + `landCreditScoreRecalc`** | `server/jobs/featureEngineeringJob.ts`, `landCreditScoreRecalculation.ts` | S | Complete ML pipelines, never scheduled. Pure compute. |
| **Cost guardrail** on the autonomous-decision executor (uncapped ~$30/day) | `runScheduledJobs.ts:1025` | S | Add per-tick cap / explicit kill-switch env. Prudent. |
| **AI cost knobs** — `AI_CASCADE_ENABLED`, `AI_QUALITY_THRESHOLD` envs (default = current behavior) | `aiRouter.ts:185` | S | Optional levers for cost testing; no behavior change by default. |
| **Move hardcoded billing constants → `founder_settings`** (trial cap $5, auto-top-up 200¢/2500¢) | `credits.ts:163`, `routes-billing.ts:194` | S/M | Makes them tunable; the constants stay as defaults. |
| **Marketplace "featured" real flag** (currently `id % 3 === 0` demo) | `client/src/pages/marketplace.tsx:867` | S | Wire to real `isFeatured`. |
| **Telemetry honesty** — distinguish "cached real data" vs "fallback stub" in FEMA/NWI responses | `data-source-lookup.ts:174` | S | Fallback is correct; just label it. |

> Note: `dbBackup` and `courseCompletion` jobs are also dark+finished but need creds (S3 / email) → see 🔑.

---

## 🔑 NEEDS A KEY / CREDENTIAL FROM TOM — code is ready, secret isn't set

Solene wires the code; Tom sets the secret on Fly (Solene never handles secret values — [[feedback-credential-value-handling]]).

**Customer-critical (these gate having real customers):**
- **AWS SES** — transactional email. ⚠️ *Without it, users may not get password-reset / signup-confirmation emails.* `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SES_FROM_EMAIL`. Free after domain verification.
- **Mapbox** — `VITE_MAPBOX_ACCESS_TOKEN`. ⚠️ *Maps/geocoding don't render without it.*
- **Stripe** — live price IDs (`STRIPE_PRICE_*`) + keys. ⚠️ *No checkout / no auto-top-up without these.*
- **CAN_SPAM_MAILING_ADDRESS** — currently prints literal `[PLACEHOLDER]` in every outbound email footer. Needs the real business mailing address.

**Growth / data:**
- **Regrid** (`REGRID_API_KEY`), **ATTOM** (`ATTOM_API_KEY`), **BatchData** (`BATCHDATA_API_KEY`) — parcel/owner/comps data. All three have full implementations gated off.
- **Lob** (`LOB_API_KEY`) — direct mail (returns mock IDs without it).
- **SendGrid** (`SENDGRID_*`) — email transport + event webhook.
- **Twilio** (`TWILIO_*`) — SMS/voice.
- **QuickBooks Online** (`QBO_CLIENT_ID` + OAuth, L effort to finish the flow) — accounting sync.
- **Meta Ads** (`META_ACCESS_TOKEN`, `META_PAGE_ID`, `META_CATALOG_ID`) — listing syndication.
- **VAPID push** — *free*, just `npx web-push generate-vapid-keys` → set `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`.
- **Google / Microsoft OAuth** — optional login methods.

---

## 🤔 NEEDS A FOUNDER DECISION

- **9 gated feature modules** (OFF by default): Marketplace, Academy, Vision AI, Capital Markets, Deal Hunter, Acquisition Radar, Land Credit, Negotiation Copilot, Tax Researcher. → Solene should **audit each for production-readiness first**, then Tom picks which to activate.
- **Paid-data (Regrid) greenlight** — leave dry-run/mock or go live (needs key + spend approval).
- **Flood / wetland / soil columns** — add to `properties` + populate from federal APIs, or defer. (Pointer was `dataIngestJob.ts:187`; that job was deleted 2026-08-01 as a module orphan — the decision itself is still open.)
- ~~**Satellite boundary-change detection** — implement polygon-delta or drop it from the change score. (`satelliteImageUpdate.ts:95`)~~ Mooted 2026-08-01: `satelliteImageUpdate.ts` deleted (module orphan; standing Satellite/Vision-AI KILL in the deletion ledger) — no change score remains to fix.
- **Trial spending cap / auto-top-up defaults** — confirm the dollar values when moved to settings.

---

## ⚪ LEGITIMATELY DEFERRED — correctly stubbed, no action (honesty intact)

Eval-gate CI stub (never false-fails fork PRs) · demographic-bias section (honest "insufficient volume," not a zero-bias claim) · founder tax engine (provisional + disclaimer, audit-safe) · reserve-floor 30% constant · EDDM carrier-route geometry (gated on USPS BCG at $1k MRR) · R2 cold-archival (Tom's TODO when R2 configured) · paid-data eval sample mode · the no-op aggregate-view CTAs (pipeline/timeline/cohort/inbox — correctly have no single CTA) · landing hero demo cards (aria-hidden, labeled "Example") · zoning mock free-tier fallback · provider cache dormant (proprietary `redistributable:"no"` until signed contracts).

---

## OFAC reconciliation note

Three overlapping OFAC implementations now exist; consolidate at integration:
1. `server/services/sanctionsList.ts` (CANONICAL) — real daily Treasury SDN ingestion, **hashed** name+country, signup-time exact block. Already scheduled 03:30 UTC. **Keep as the ingestion.**
2. Polish-batch `server/services/compliance/ofacScreening.ts` — fuzzy *counterparty* screen, built against a **fixture**. **Repoint at real data.**
3. In-flight `beatrice/ofac-real-data` agent — plaintext entries + matcher. **Keep the matcher; fold its data population into job #1; do NOT schedule a 2nd Treasury download.**
