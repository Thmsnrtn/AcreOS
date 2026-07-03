# AcreOS Roadmap — July 2026

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

1. Wholesale gets its defining mechanic: assignment-of-contract + assignment
   fee doc flow (the e-sign + doc systems already exist to build on).
2. A deal-centric pipeline view stitching lead → mail → response → offer →
   contract → close with next-best-action (everything exists; nothing shows
   it as one track).
3. Reposition fix-and-flip as an improved-property module rather than
   pretending it's land math.

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

---

## Founder decisions needed (blocking specific items)

1. **DNC/litigator scrub vendor** (Wave 1.5) — pick one (e.g., DNC.com,
   Contact Center Compliance); cold SMS without it is live TCPA exposure.
2. **Free-tier first send** (Wave 2.1) — capped free send vs. upgrade CTA.
3. **Sales-data license** (Wave 3.1) — seed real comps per county; until
   then the AVM stays refuse-not-fabricate.

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
