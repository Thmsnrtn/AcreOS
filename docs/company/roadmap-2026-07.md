# AcreOS Roadmap — July 2026

*Horizon context: this roadmap executes H0 and early H1 of the north-star
document, `mature-machine.md` (gates, horizons, and the autonomy switch
schedule live there; waves live here).*

*Synthesized 2026-07-03 from a four-lens expert audit (product/UX, veteran
land investor, CFO/COO, principal engineer + security) plus the accumulated
step-away doctrine and debt registers. Each finding below was verified
against the code by the auditing lens — file references live in the audit
transcripts; the doctrine doc covers the autopilot layer separately.*

## The through-line

One wedge pays for everything: **lead in → mail out → seller responds →
offer**. The strategic ladder the CEO approved (Wedge & Win now → marketplace
at ~25 customers → API at ~50) stands. Every wave below is ordered by a
single question: *does this make the wedge work, tell the truth, or stop
money/legal leaks — and can the platform still run itself while the founder
is away?*

**Sequencing rule:** Wave N+1 does not start until Wave N's P1s are done.
Within a wave, revenue/legal correctness beats polish.

---

## Execution ledger (updated 2026-07-04)

Waves 1-6's discrete items are SHIPPED on `claude/codebase-quality-audit-ko1u69`:

- **W1** (950eabd, 9c1c4e9, ec5dae1, 0bdecdf): dunning ladder revived; tier
  fallback + honest welcome email; SMS response capture + TCPA
  gate-by-construction; Data-API keys hashed + founder-gated; mail interlock
  closed; atomic credit-pool gate; honest BYOK payer; transactional Stripe
  webhooks with claim-release retry recovery.
- **W2** (34ca0dc): free-tier 5-piece lifetime first send (wedge open);
  checklist completable; offer-first onboarding finish; persona empty
  states; subdivider choosable; /campaigns on PageShell; drawer vocabulary;
  Betty leak removed.
- **W3** (e38db04): AVM refuse-not-fabricate + AI-estimate labeling; comps
  arm's-length screens + recency floors; daysOnMarket surface removed;
  integer-cents money (shared/finance/cents.ts) across deal KPIs / 1099 /
  QBO / P&L; shared/lifecycle/pipeline-status.ts stage machine + live-drift
  fixes ("won", "active").
- **W4+W5** (d220bb1): doc-intel + campaign-optimizer metered; offer AI
  attributed; tier-proportional cost ceilings; platform bucket chat floor;
  cached-last-known gate enforcement; dunning read-only ENFORCED
  (dunningAccessGate); mrr_snapshots + weekly job → real WoW growth;
  FIRST_DEAL_CLOSED detected; task processor + Atlas nudger + founder
  digest rostered; leads stage/cursor pagination in SQL.
- **W6** (06c1d0f): contract_assignments (the wholesaler mechanic) + doc
  autofill + dashboard real fees; /api/deals/:id/track single-track view +
  lead-timeline join bug fix.

**Still open:** W6.3 fix-and-flip repositioning (needs the investor-type
bucket decision); W7 continuous debt (storage.ts decomposition, res-status
558→0, req-as-any 73→0, storage-linecount); the three founder decisions
below.

**Resolved 2026-07-07 (query consolidation):** Documents (3 page-owned
queries → GET /api/documents/overview) and Inbox (email + SMS lists →
GET /api/inbox/unified, channel filter server-side) now load in one round
trip each, mirroring /api/today; all mutation sites invalidate the
aggregate prefixes alongside legacy keys. Map deliberately NOT
consolidated: its two on-mount queries (/api/properties, /api/deals) use
shared cache keys other pages read — a Map-only aggregate would fork
those caches for a 2→1 request win. Lob health false-negative fixed
(healthCheck/addressValidation now accept the generic LOB_API_KEY).

**Shipped 2026-07-07 (mature-machine H0 pass, `claude/platform-roadmap-strategy-eve1ah`):**
strategy layer added (`mature-machine.md` north-star + `deletion-ledger.md`
with keep/kill/freeze verdicts); DNC/litigator scrub SEAM built at the
sendOrgSMS choke point (migration 0195 — vendor pick remains Founder
decision #1; seam is inert until DNC_SCRUB_PROVIDER is set); module-state
audit executed (authority delegations + execution throttle → Postgres,
migration 0196; five stores pinned; rest resolved-by-deletion); ESLint
blocking; coverage converted from aspirational lines:50 (measured: 18.22%,
permanently red) to a blocking ratchet with per-file floors on money/send
paths; docs/exhaustive-completion (863 files) archived with all runtime
refs updated; Capital tab + Marketplace sidebar entry un-wired (frozen
features no longer advertised in customer chrome); LCS methodology
versioned (v1) and published on the explainer; README/replit.md truth pass.

**Shipped 2026-07-07 (cost audit + fixes, see `cost-audit-2026-07-07.md`):**
Scale-tier AI margin guard (two-stage Opus→Sonnet→Haiku downgrade — was
underwater at full utilization); idle-aware job pacing (decision executor +
embedding refresh run 1-in-8 slots below 5 paying customers); financial
forecaster wired to real tier-mix MRR + the shared costModel (was flat
$49/org + $200 burn guess) with honest reserve-based runway;
marketing_spend ledger (migration 0197) — the CAC numerator — with founder
endpoints, unit-economics CAC/payback/LTV:CAC now computable, and the
budget-ramp CAC proof seeing real ad dollars.

**Resolved 2026-07-06 (ops/secrets incident):** SES DKIM FAILED for
acreos.io traced to a dead IAM key + stale DKIM tokens from a recreated
identity; fixed end-to-end (key rotation via the founder-recovery kit,
ses-setup.mjs FAILED-state restart + NextSigningKeyLength, fresh CNAMEs).
Anthropic/OpenAI/SendGrid keys rotated; Cloudflare Email Routing enabled
(inbound @acreos.io forwards to the founder; DMARC rua now deliverable);
apex SPF merged correctly. Cause-time watchdogs live in prod:
platform_email_identity + credential_liveness (daily domain_audit sweep,
critical findings page via the alert spine). Full audit:
docs/company/secrets-audit-2026-07-04.md. Still dark by choice: Twilio
(10DLC purchase), ATTOM/BatchData (data licenses).

**Resolved 2026-07-04 (platform sweep r1-r4):** borrower-token CSPRNG +
portal sunset; hot-path indexes; retention truth; dunning/pricing/footer
marketing fixes; client diet (119MB); mass-assignment floor (22 sites);
schema-drift ratchet; right-to-erasure (deleteOrganization); escrow/ACH/fee
cents math; skip-trace throttle; founder-route self-gating;
directMailService billing tests. **SCP retire-or-wire resolved as KEEP**:
scpConfigVersioning is live-wired into Pax prompt versioning, so retiring
would break real surfaces — and evolution-on-real-sessions is blocked on
having real sessions (i.e., users). Revisit the interaction-capture seam
at first paying cohort.

---

## Wave 1 — Stop the bleeding (revenue, legal, correctness) — IN PROGRESS

The audit found the revenue machine and the compliance surface each have one
genuinely broken load-bearing part, plus a security hole in the future API
product.

1. **Dunning escalation ladder is dead.** Events parked at `scheduled_retry`
   are invisible to the reminder cron (it only queries `pending`), so the
   day-3/7/14 recovery emails never send for exactly the accounts still
   recoverable. Fix the selector; test the ladder end-to-end.
2. **Tier resolution has no fallback.** Stripe `product.metadata.tier`
   missing → paying customer stuck on free entitlements and MRR undercounts.
   Fall back to price-ID → tier mapping; backfill-safe.
3. **Welcome email lies about entitlements** (hardcoded wrong limits + a
   non-existent tier). Render from `TIER_LIMITS`.
4. **SMS is the dominant seller-reply channel and it's second-class.**
   Matched inbound SMS must flip the lead to `responded`, fire
   `first_seller_response`, and raise the hot-lead alert exactly like email.
   Unmatched inbound SMS (spouse's phone, new number) must land in an
   "unattached replies" queue with attach/create actions — today it is
   silently dropped.
5. **TCPA gate-by-construction.** The consent + quiet-hours gate lives in
   callers; the low-level `sendOrgSMS` can be reached without it. Move the
   gate inside the sender so no path can skip it. Add `leads.timezone`
   (sourced from mailing address) so quiet hours stop guessing from area
   codes. *(Founder decision needed: DNC/litigator-list scrub vendor — see
   "Founder decisions" below.)*
6. **Data-API security** (the future API product's foundation):
   `Math.random()` keys → `crypto.randomBytes`; hashed storage +
   constant-time compare; auth on `/stats` + `/coverage`; fix the dead
   founder admin mounting so key management is actually reachable.
7. **One mail sender ignores the live-send interlock** (`lobService`,
   currently unwired but loaded). Quarantine or route through
   `resolvePlatformLobKey()` so the "no code path can arm itself" guarantee
   is true by construction again.
8. **Money-flow integrity:** credit-pool debit is check-then-insert (race →
   COGS overspend) → single conditional insert; BYOK lookup failure bills
   the platform instead of the customer → fail toward the customer's key;
   subscription state + history written without a transaction → wrap.

## Wave 2 — Win the wedge (activation)

The UX audit's headline: **the free tier structurally cannot reach the
magic moment** — the "send your first mailer" checklist step is *hidden*
when the tier has zero campaigns, and onboarding celebrates loading sample
data instead of sending a first offer.

1. Free tier gets a small capped first send (1–5 pieces) so TTFM is
   reachable, or the hidden step becomes an explicit "Send 1 free —
   upgrade for more" conversion CTA. *(Founder call on which — recommend
   the capped free send; the wedge IS the demo.)*
2. Onboarding + Today drive toward the first offer: the parcel →
   blind-offer → hand-to-Pax flow already exists on the Map — celebrate
   *that*, not the sample-data load.
3. Map zero-state gets a real guided EmptyState; Today's empty state
   persona-branches (note investors don't have "parcels").
4. Shell consistency: `/campaigns` (the activation destination!) rebuilt on
   `PageShell` (it currently mounts a second, conflicting sidebar whose only
   link exits the page); Inbox standardized; mobile drawer vocabulary aligned
   to the five doors; "Betty" codename leak removed; Finance fallback uses
   house Skeletons.
5. The Subdivider persona is orphaned — offered nowhere in onboarding while
   the whole Subdivision module gates on it. Add the choice or map
   developer → subdivider.

## Wave 3 — Numbers an investor can trust

The investor lens was blunt: the two numbers that decide an offer are not
trustworthy today.

1. **Valuation honesty.** With zero comps and no trained model, the AVM
   falls to an LLM guess or a flat $1,000/acre — labeled "AcreOS Proprietary
   Valuation Model." Refuse-not-fabricate: no comps + no model → an honest
   "not enough data" state with what's missing. Label the LLM path as an AI
   estimate. *(Founder decision: license a sales dataset to seed
   `transaction_training` per county.)*
2. **Comps discipline.** Assessor last-sale records ≠ arm's-length recent
   sales: add recency floors + non-market-transfer flags. `daysOnMarket` is
   hardcoded 0 — remove the surface until a listing source exists.
3. Money sums in `float8` (deal-pipeline KPIs) and float accumulation in
   1099/QuickBooks reporting → integer cents (the borrower-payment layer
   already does this right; adopt its model).
4. Lead/deal stage becomes a real enum with server-validated transitions
   (funnel metrics currently sit on typo-able strings).

## Wave 4 — COGS + growth discipline

1. **Meter every AI surface.** Only chat counts against tier AI turns;
   comps/parcel-intel/campaign-optimizer/doc-gen bill COGS uncapped up to a
   $1,500/mo-equivalent per-org ceiling (~30× Pro's price). Meter them all,
   and make the per-org ceiling tier-proportional.
2. The platform-wide $15/day AI backstop throttles paying customers along
   with runaway loops — segment or exempt paying chat.
3. Entitlement + cost gates currently fail OPEN on DB errors — fail closed
   (or cached-last-known) for the cost ceiling at minimum.
4. Dunning "read-only from day 8" is promised in emails but never enforced —
   either add the access gate or stop promising it.
5. Truth in reporting: weekly MRR snapshot so WoW growth and the runway
   "upside" scenario stop being identical to base; detect the declared-but-
   never-detected FIRST_DEAL_CLOSED milestone (referral loop dead-ends
   there); fix the stale $29 margin math comments in the pricing source of
   truth.

## Wave 5 — Ops reliability

1. Five recurring `setInterval` loops run outside `withJobLock`/the roster —
   the deadman can't see them die. Route through the runtime + roster.
2. Test the untested money/send surfaces: creditPool, webhookHandlers +
   stripeService, smsService/provider, directMailService.
3. Leads list loads the entire org's leads into memory when stage-filtered —
   push scoring/filtering into SQL.

## Wave 6 — Product depth (vertical scorecard)

Verdicts from the investor lens: **Notes = deep and real. Rental,
Subdivision = real. Fix-and-flip = real math, built for houses (off-thesis
for land). Wholesale = thinnest — no assignment-contract mechanic.**

1. **DONE (PR #155, 2026-07-11)** — Wholesale gets its defining mechanic:
   assignment-of-contract + assignment fee doc flow. The backend
   (contract_assignments + state-legality rules + Assignment Contract
   template + compliance gate + e-sign) predated this; the AssignmentPanel
   in the deal's Docs tab made it one visible flow.
2. **DONE (PR #154, 2026-07-11)** — A deal-centric pipeline view stitching
   lead → mail → response → offer → contract → close with next-best-action.
   /api/deals/:id/track now maps the four real source tables (offers,
   inbound seller comms, campaign responses, mail pieces) into the timeline
   at query time; Timeline is the deal's default tab with a DealNextAction
   banner fed by the deal-coach engine.
3. **SCOPED → founder decision (see Founder decisions needed #4)** —
   Reposition fix-and-flip as an improved-property module rather than
   pretending it's land math. Scoping found the concrete mechanism:
   `BUSINESS_TYPE_TO_INVESTOR_TYPE` maps `fix_and_flip: "land"` (the coarse
   fork that selects data/tools), so flip orgs are served land comps, land
   AVM, and land due diligence under house labels. Fixing it honestly means
   a third investorType ("improved") that forks the data plane — blocked on
   a residential-comps data source (no license yet; the AVM stance is
   refuse-not-fabricate) and on the vertical-conveyor sequencing call.
   Copy-only repositioning without the data fork would be a label change
   pretending to be a fix.

## Wave 7 — Platform debt + autopilot ladder (continuous, interleaved)

- storage.ts decomposition (7,688-line ratchet), res-status-raw 563 → 0,
  req-as-any 73 → 0, console-in-server 11 → 0, translucency Wave R,
  date-format baseline.
- Autopilot: SCP memory retire-or-wire; planner integration; interaction-
  capture seam so evolution runs on real sessions; Google Ads adapter
  (connection prewired); fix the stale "NOT wired" comment in
  witnessGrant.ts.
- Strategic ladder: marketplace build starts at ~25 customers; public API
  productization at ~50 (Wave 1's Data-API hardening is its precondition).
- Experience legibility (founder-queued 2026-07-08): pulse strip,
  receipts, plain-language controls on the founder doors + customer
  settings — design + work clusters in
  `docs/company/experience-legibility.md`; first cluster (F1) starts
  after launch-week remainders clear.

---

## Founder decisions needed (blocking specific items)

All four decided by the founder 2026-07-11 (multiple-choice session), plus
three operational calls made the same day:

1. **DNC/litigator scrub vendor** (Wave 1.5) — **DECIDED: research first.**
   Comparison delivered same day; recommendation = Searchbug (pay-as-you-go,
   federal+state DNC, litigators, FCC RND) at launch volume, with TCPA
   Litigator List's 600K-record litigator DB as a possible second source
   later. Note: DNC.com and DNCScrub are BOTH Contact Center Compliance.
   Awaiting founder's vendor confirmation + account; cold SMS stays off.
2. **Free-tier first send** (Wave 2.1) — **DECIDED: capped free first
   send.** One hard-capped batch per org, once ever, booked as acquisition
   COGS. **BUILT 2026-07-13 (D4):** the 5-piece lifetime cap + refusal
   payloads shipped in W2.1 (routes-outreach-mail.ts); the flusher now
   books each free-tier send's real postage into marketing_spend
   (campaignRef `free_first_send:ship=<id>`, actuals-only, idempotent) so
   CAC math sees it. SMS lane stays dark until the DNC scrub is keyed.
3. **Sales-data license** (Wave 3.1) — **DECIDED: defer to the revenue
   trigger.** Refuse-not-fabricate holds; buy county-by-county when paying
   customers' counties demand it.
4. **Fix-and-flip data plane** (Wave 6.3) — **DECIDED: option (b), demoted
   beta → roadmap/waitlist** until a residential-comps source exists.
   Registry + landing tiers + onboarding copy updated; existing
   fix_and_flip orgs keep their surfaces; the 70%-rule math stays.

Operational calls (same session):

5. **Dunning retries** — **auto-retry + notify** (day-1/3/7 ladder,
   unattended, every attempt in The Letter/Story). **BUILT 2026-07-13
   (D1):** `processAutoRetries` in dunning.ts runs inside the 6-hourly
   sweeper — attempts the outstanding invoice on days 1/3/7
   (DUNNING_CONFIG.autoRetryScheduleDays), one attempt per rung
   (tracked in the event's notification log), success resolves as
   auto_recovered + clears dunning state, every attempt Letter-visible
   via logActivity. Idles with one log line until Stripe keys exist —
   the ladder is not burned pre-keys. 7 unit tests pin the rules.
6. **Auto-top-up** — **wire fully per customer settings**, with the
   permanent $500/action hard-stop still binding above customer config and
   a card-on-file (SetupIntent) step added to top-up settings. **BUILT
   2026-07-13 (D2):** `executeAutoTopUp` in credits.ts fires after every
   deduction — off-session PaymentIntent against the card on file, amount
   = min(customer config, $500 hard-stop), ledger-based one-charge-per-hour
   idempotency + Stripe idempotency key, credits land only after the
   charge succeeds, receipt/decline emails to the owner, every outcome
   Letter-visible. Card-on-file via SetupIntent routes in
   routes-billing.ts (setup-intent → payment-method, with ownership
   verification). Idles until Stripe keys exist. 8 unit tests pin the
   rules.
7. **Listing syndication** — **build the backend now** (channel model +
   status/sync endpoints the existing page expects). Build task D7.

## Do not regress (verified strengths, all four lenses)

- The `EmptyState` primitive's required-CTA contract; honest-null Map data
  design; keyboard-accessible kanban; 44px targets.
- Litigation-grade STOP handling (verbatim consent events, cross-channel
  opt-out, sequence cancellation) and the live-send interlock.
- Land-native due diligence (flood/wetlands/soil/environmental/tax) and the
  self-hosted hash-chain e-sign flow.
- Integer-cents borrower payment math with idempotent postings and real
  tests — the model for all money code.
- Fail-closed webhook signature verification on every provider; SSRF-guarded
  timeout-bounded outbound HTTP; webhook idempotent-claim + dead-letter
  replay; honest financial reporting (null CAC over fabricated CAC).
- The witnessed-send kernel + registration-time invariant + WitnessGrant
  delegation with atomic budget consumption.

*Maintenance: mark items DONE in place with dates; the step-away doctrine
doc remains the autopilot layer's source of truth.*
