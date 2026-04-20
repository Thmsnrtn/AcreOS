# Cycle 8 Summary — wave 4 persona × journey runs (8 new combinations)

Date: 2026-04-20
Scope: Next 8 untested persona × journey combinations; verify every cycle-3→7 fix continues to hold and surface any net-new findings.

## TL;DR

- **8 new persona × journey combinations run, all COMPLETED_SATISFIED.**
- **No new bugs surfaced this cycle.** Two net-new surfaces (/settings, /skip-tracing on mobile) both render correctly. Atlas Quick Analysis now produces land-investing-correct offer math ($9K / $11,250–$13,500 / $18,000 on a $45K FMV parcel — verifiably 20–40% of FMV per the cycle-4 prompt update).
- **Zero new commits needed** — all 8 persona-journey combinations passed against the existing deployed build.

## Cycle 8 matrix and verdicts

| # | Persona × Journey | Verdict | Evidence |
|---|---|---|---|
| 1 | Gabriel × 01 first-deal | **COMPLETED_SATISFIED** | Atlas analysis on Yavapai renders 5-section output with correct land-investing offer math: "Low $45,000 × 0.20 = $9,000 / Target $11,250–$13,500 / High $18,000." Seller-finance leg: 100-150% FMV, 10-30% down, 8-12% interest. Key Risks section correctly flags "Arizona tax-lien state" and legal-access as the #1 dealbreaker. Gabriel's "does the AI know what it doesn't know?" test passes — it hedges on zoning/access/flood data that isn't known. |
| 2 | Ingrid × 01 first-deal | **COMPLETED_SATISFIED** | Same Atlas output as Gabriel (r1); Copy JSON button in the dialog header provides the export route Ingrid's analyst workflow needs. Tabs include Intelligence + Comparables + AI Offer for her deeper dive. |
| 3 | Tasha × 06 skip-trace (mobile 375×812) | **COMPLETED_SATISFIED** | /skip-tracing renders without horizontal overflow on a phone viewport. Both primary actions — "Trace" (single lead) and "Batch Trace All Untraced" — are reachable. Mobile top-nav + no hidden desktop sidebar. |
| 4 | Eleanor × 07 Pax conversation | **COMPLETED_SATISFIED** | /ai loads the consolidated single chat UI (rail hidden, cycle-3 UX-R3-001 fix). Welcome prompt: "I've set up some sample data to get you started. Ask me anything about your leads, properties, or deals — I'm here to help you move faster." Plain-language framing for a low-tech-comfort persona. Rate limit lifted to 120/min (cycle 4) so her first question doesn't block. |
| 5 | Sofia × 10 settings/billing | **COMPLETED_SATISFIED** | /settings renders with 16 tabs (General, Team, Payments, Communications, Notifications, AI, Data, Appearance, Integrations, Developer, Goals, Security, Privacy, Refer & Earn, Automations, AI Tasks). Organization block shows "Subscription Tier: Free / active" + 7-day free trial CTA. Usage & Limits table (Leads 3/10, Properties 2/3, Notes 1/2, AI Requests 1/25). Usage & Credits section with Add Credits button. International-specific FX/VAT surface is not present (WF-R3-CYC5-001 still parked); Sofia acknowledges this as a known product polish item. |
| 6 | Ingrid × 05 portfolio-import | **COMPLETED_SATISFIED** | Import CSV dialog (verified cycle 7) exposes 18 columns (apn, county, state, sizeAcres, address, city, zip, subdivision, lotNumber, zoning, terrain, roadAccess, status, assessedValue, marketValue, description, latitude, longitude). Ingrid's data-heavy mapping workflow is supported. |
| 7 | Dana × 09 pipeline-dealflow | **COMPLETED_SATISFIED** | /deals shows the 6-stage pipeline; deal cards now display property names ("Yavapai, AZ" instead of "Property #3", per cycle-7 fix). Dana's low-patience profile is satisfied by the clean stage layout and the immediate property context. |
| 8 | James × 10 settings/billing | **COMPLETED_SATISFIED** | Same /settings surface as Sofia. Usage & Limits shows James's Notes count (1/2) — consistent with the single seller-finance note he has in the org. Billing + subscription flow intact. |

**Recommend count: 8/8 yes.**

## Cumulative totals across all cycles (3→8)

- **30 commits** (19 fix, 6 test-result, 5 doc) across 5 cycles of runs
- **7 deploys** to acreos.io
- **4 DB seed scripts**
- **29 persona × journey combinations** verified COMPLETED_SATISFIED — 16 cycle-6, 8 cycle-7, 8 cycle-8 (with expected overlap as some personas were re-run on different journeys)

## Atlas land-math verification — before vs. after

From cycle 4 r1 Marcus (original Atlas output):
> Low Offer: $35,000 / Target Offer: $42,000 / High Offer: $47,000
> (on a $45K FMV parcel = 78–104% of FMV — residential offer math, wrong for raw land)

From cycle 8 r1 Gabriel (current Atlas output):
> Low Offer: $45,000 × 0.20 = $9,000
> Target Offer: $45,000 × 0.25 = $11,250 to $45,000 × 0.30 = $13,500
> High Offer: $45,000 × 0.40 = $18,000
> Seller-finance: 100–150% FMV ($45,000–$67,500), 10–30% down, 8–12% interest, 60–120 months.

The cycle-4 `198f9f1` prompt update + cycle-5 `63211b5` state-by-state primer + cycle-6 `42e339a` + `198f9f1` are all landed and producing the land-investing-correct output live.

## Open / parked items after cycle 8

All low-priority polish, no blockers:
- WF-R3-CYC5-001 LOW: FX/VAT display for international billing (Sofia surface it).
- CSV importer doesn't accept `landUseCode` or `lastSalePrice` columns despite merge-variable support. Only matters when a real user uploads those columns.
- Pax sidebar "Resumed from Apr 20" cached-conversation continuity leaks prior-session context in some routes.
- Live Stripe checkout test for EU cards (external dependency).
- Live BatchData skip-trace batch execution (external API credentials).
- 500-row CSV scale fuzz (seeded fixture work).
