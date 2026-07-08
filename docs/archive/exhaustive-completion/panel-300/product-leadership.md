# Product Leadership — 15 personas

## 106. Niamh Riordan — CPO
**Lens:** Wedge-deepening discipline — shipping one vertical to depth before breadth.
**Backstory:** 2nd CPO; first role was expanding 4 verticals into 12 (learned the hard way).
**What I see:** The roster names 6 verticals (Land, Notes, BH, Fix-Flip, Wholesaler, Subdivider) shipped at the data layer per `post-may1-resweep.md`. But zero are paying customers yet. The founder-judgment decision D2 is: deepen Land only (Wendell), Land+NI wedge (Caspar), or hold breadth + signal (Diego)? None of these are "6 concurrent product lines."
**Highest-leverage move:** Recommend Caspar's Land+NI wedge path to founder. Then staff one PM on Land (Wendell's features: bulk actions, map default, comp dossier), freeze the other 4 verticals at "feature-complete but frozen" (customers can use, no new work), and move 3 junior PMs to NI-depth work. This ships depth at velocity instead of breadth at stall.
**Biggest risk:** If you staff all 6 verticals equally, your best PM gets spread 10 ways and you ship nothing at depth.

## 107. Fenella Drummond — VP Product
**Lens:** Roadmap-resourcing math and dependency chains.
**Backstory:** Owns 8 PMs at a 300-person SaaS; built the 90/30/10 allocation rule.
**What I see:** The 90-day workstream has 15 items (`_FORWARD-SYNTHESIS.md` §4.2); 12 are shipped. The open 3 are (90-8 bulk actions), (90-9 map default on /properties), (90-15 OpenAI bypass migration). But there are also 8 *data-layer* items (subscription-events ledger, /founder/financials, eval harness v0, complianceAI post-validator, etc.) that are shipped + verified. The math: if you have 4-5 engineers, you can do (a) all data-layer items + the 3 UI holdouts, OR (b) all data-layer items + hire 2 more engineers. No third path.
**Highest-leverage move:** Map the 90-day roadmap as a dependency graph: which items unblock which? The subscription-events ledger (90-1) unblocks `/founder/financials` (90-2). The eval harness (90-3) unblocks complianceAI post-validator (90-4). Present the founder with: "Here's the critical path for the 90-day gates. Here's the hire-or-defer breakpoint. You pick."
**Biggest risk:** If you don't show the founder the dependency graph, she'll commit to all 15 items and you'll ship 8, credibility crater.

## 108. Tariq Sayed — Principal PM
**Lens:** API-as-product framing and platform moats.
**Backstory:** Owns platform PM at a 600-person fintech; every API surface is a product in its own right.
**What I see:** The vertical-pack pricing model (FW-TEGAN-1) is an API decision: is it `GET /api/orgs/:id/packs` (separate table) or `GET /api/pricing/packs` (centralized)? The answer shapes whether a 3rd-party vertical can integrate into AcreOS or whether they're forever vendor-locked. The 365-day roadmap mentions "Per-seat metering wired in backend (toggle-able, not activated)" — that's an API contract that needs defining now before you ship the foundation.
**Highest-leverage move:** Write a "Vertical-Packs API Specification" (1 page) defining: (a) the endpoints (GET/POST/PATCH), (b) the contract (request/response shape), (c) the versioning strategy (v1 forever?), (d) the extensibility hooks (3rd-party integrations future-proofed?). Submit to Ingrid's ARB. This prevents 2 subsequent API redesigns.
**Biggest risk:** If you ship vertical-packs without an API spec, the second vertical will find a design flaw and you'll have to break the first.

## 109. Matías Nuñez — Growth PM
**Lens:** Activation-to-retention attribution and cohort analysis.
**Backstory:** Built PLG flywheel at a 500-person unicorn; measures everything in days-to-aha and retention curves.
**What I see:** The persona-aware checklist (FW-YUNA's work) targets time-to-aha ≤4:00 (down from 7:30). But the 30-day gate says "measured ≤4:00" — who measures it? There's no cohort-flagging logic, no daily rollup, no dashboard showing "April cohort hit aha on day 2.3 on average." Without that, you're guessing whether the feature worked.
**Highest-leverage move:** Pair with Yuna + Camila (CS) on D30-branching logic. Define: what's the aha event? (first deal created? first property added?). Wire a Mixpanel/Amplitude event `aha_step_completed` per step. Build a 3-row dashboard: "aha1 completion (60s)", "aha2 completion (120s)", "aha3 completion (180s)", filtered by signup cohort. Measure daily starting 2026-06-01.
**Biggest risk:** If you don't measure time-to-aha, the next feature pushes it to 5:00 and nobody notices for 2 months.

## 110. Asma Bouzidi — Platform PM
**Lens:** Internal-tooling DX and team self-service.
**Backstory:** Owns developer experience at a platform; every API customer is an engineer doing integration work.
**What I see:** AcreOS doesn't expose an external API (no 3rd-party integrations). But it does have `/founder/*` routes (recovery console, financials, monthly-close, year-end, audit-prep). These are your "internal API" — they're consumed by one customer (the founder). The persona-aware checklist + bulk actions + map default are all *founder-facing* DX improvements.
**Highest-leverage move:** Treat `/founder/*` routes as a "founder API" product line with the same rigor as customer-facing UX. Define the endpoints, spec the contracts, version them, write runbooks. This elevates "founder tooling" from ad-hoc to platform-grade.
**Biggest risk:** If you build founder tooling without DX discipline, every new operator surface becomes a one-off hack.

## 111. Cassiel Roux — AI PM
**Lens:** Eval-driven iteration and model-swap discipline.
**Backstory:** Shipped 4 AI features post-ChatGPT at a SaaS; obsessed with whether the model is the lever or the prompt is.
**What I see:** Three AI surfaces live: Pax draft generator, Pax executive, complianceAI disclosure generator. Zero have deterministic post-checks (FW-INDIRA-1 is the first validator). The forward panel converged on eval-harness ownership — Theo (engineering/cost) vs Indira (governance/compliance). But the actual question is: who owns model versioning?
**Highest-leverage move:** Propose a "Pax Model Lockfile" — pin claude-opus-4-7 in `aiRouter.ts` with a 90-day deprecation date (Anthropic's SLA). Wire the eval harness to block model swaps unless pass-rate ≥95%. When Anthropic deprecates opus-4-7 next month, the harness gates your migration automatically. No founder decision needed per swap.
**Biggest risk:** If you don't lock model versions, you'll wake up one day to "your model is deprecated" and have to scramble.

## 112. Wendell Hart — Vertical PM (Land)
**Lens:** Deepening Land before widening anything else.
**Backstory:** 12-year land-investor operator; returned from 20-panel; now owns Land PM in this panel.
**What I see:** The amortization library acceptance test (FW-WENDELL-1) caught 2 real bugs. That's the signal: Land needs paranoia tests, not new features. The 90-day workstream lists (90-8 bulk actions) and (90-9 map default) — both Land-only. But D2 (depth vs breadth) might defer both if the founder picks "hold breadth" or "Land+NI wedge."
**Highest-leverage move:** Run a 1-week "Land Power-User" sprint with Elara + real customers. Collect the top 5 wishlist items. Then present to founder: "These are the Land features I'd ship if D2=deepen-only. If D2=wedge, I'll do just bulk-actions + map-default. What's your call?" This flips the decision from strategy to tactics.
**Biggest risk:** If you keep shipping Land features without founder clarity on D2, you'll build 8 things that the wedge strategy doesn't need.

## 113. Marlena Lansdale — Vertical PM (Notes)
**Lens:** Amortization correctness to the cent and institutional-grade tooling.
**Backstory:** Built note-investing tools for an institutional desk (4,000+ note portfolio); obsessed with whether Quickbooks reconciles to AcreOS to the penny.
**What I see:** The note-ledger acceptance test (FW-WENDELL-1) is actually validating the entire Notes vertical foundation. The test generated 1,000 randomized amortization schedules and caught 2 bugs. But there's no equivalent paranoia for the other 5 verticals. BH has no "landlord accounting correctness test." Land has no "property-cost-basis correctness test."
**Highest-leverage move:** Pair with Hannelore to run "paranoia tests" for each vertical: (a) Notes: amortization edge cases (already running, FW-WENDELL-1), (b) BH: tenant-screening compliance (FW-WYNNE-1 permissions, RS-2 notice send), (c) Land: property-cost-basis calculations (not yet running). Document the test corpus as Mariana does for Notes. This prevents 10 customer-facing accounting bugs.
**Biggest risk:** If you ship Notes to customers without the paranoia test, your first customer finds a rounding error on $50K payment and loses trust forever.

## 114. Renske de Vries — Vertical PM (BH)
**Lens:** FCRA-safe screening and tenant-landlord risk mitigation.
**Backstory:** Property-management background; obsessed with whether the screening data is legally defensible in a §1983 dispute.
**What I see:** The BH vertical is data-layer-ready per `post-may1-resweep.md` §2. But the launch is gated on D6 (geofence to TX/OK or go nationwide?). Wynne recommends TX/OK only to defer $5M class-action exposure. But the real question is: if you launch TX/OK, are you saying to CA/NY customers "we're not ready yet" or "FCRA rules prevent us"?
**Highest-leverage move:** Write a customer-facing FAQ: "Why can't I use tenant-screening in CA yet?" Answer: "CA Civ §1786 requires additional state-specific disclosures we're attorney-reviewing now; estimated availability Q4 2026." This is honesty, not ambiguity. It also signals to the founder: "I need a lawyer reviewing this, not just engineering."
**Biggest risk:** If you launch nationally without CA/NY attorney review, the first CA landlord using the feature triggers class-cert exposure.

## 115. Hugo Beaufort — Vertical PM (FF)
**Lens:** Rehab-budget realism and contractor-coordination workflows.
**Backstory:** Fix-and-flip operator; obsessed with whether the rehab-budget tool actually prevents scope creep.
**What I see:** FF-3 (1099-NEC generator) shipped; FF-1 (contractor entity + W-9 storage) shipped. But the real deal-killer (Hugo's §4 in the 20-panel) is "rehab-budget realism" — does your tool prevent contractors from blowing past estimate? The system ships the data model but not the workflow enforcement (alerts at +10%, pause at +20%?).
**Highest-leverage move:** Ship a "Budget Variance Alert" workflow: (a) define alert thresholds per property ($500 or 10%, whichever is smaller), (b) email contractor + user when actual spend hits threshold, (c) require user approval to exceed +20%. This is a 3-day feature that prevents $10K budget surprises.
**Biggest risk:** If you ship contractor tooling without budget enforcement, your first FF customer will have a $30K cost overrun and blame AcreOS.

## 116. Imelda Costa — Vertical PM (Wholesaler)
**Lens:** Assignment legality per state and double-close vs assignment mechanics.
**Backstory:** Wholesaler operator; obsessed with whether the assignment contract is state-legal.
**What I see:** The wholesaler vertical is feature-complete at the data layer. But there's zero product work on the contract-assignment workflow — the e-signing system (P0-4 + FW-HARLOWE-1, ESIGN integrity layer) is agnostic to assignment-vs-double-close mechanics. Your first wholesaler customer will ask: "Can I use AcreOS to manage my assignment contracts?"
**Highest-leverage move:** Audit the `/contracts` routes against Imelda's state-by-state assignment rules (UCC §2-210, etc.). Build a state-aware contract picker: TX wholesalers see "assignment template (Texas-safe)"; CA wholesalers see "contact your attorney" (CA restricts assignments). This is 2 days + 1 lawyer review.
**Biggest risk:** If you don't state-gate the assignment workflow, your first CA wholesaler will sign an invalid assignment contract and sue you for the lost deal.

## 117. Leyla Aydın — Vertical PM (Subdivider)
**Lens:** Permit-tracker realism and jurisdictional property-split mechanics.
**Backstory:** Land subdivider operator; obsessed with whether the permit tracker shows approval dates correctly.
**What I see:** The subdivider vertical ships land-split calculations (parcel divisions, acres remaining, cost-per-acre). But permit tracking is just a "notes" field today — no state-specific permit workflows. Your first TX subdivider will ask: "Does this tool track my TX land-division applications?"
**Highest-leverage move:** Build a "Permit Status Tracker" for subdividers: (a) add `permits` table with `state_permit_id`, `filed_date`, `expected_approval_date`, (b) wire to county-recorder APIs (Regrid + LandAmerica via Hartwell's integration, FW-HARTWELL-1), (c) email user when status changes. This is Phase 4 work (partner-API tier), but the schema should be ready now.
**Biggest risk:** If you ship the subdivider vertical without permit tracking, the first customer will leave after one deal because the tool doesn't reduce their manual work.

## 118. Roderick Gould — Enterprise PM
**Lens:** Seat math and deployment economics for mid-market.
**Backstory:** Sold to mid-market; obsessed with whether "per-seat + flat base" pricing makes unit economics work.
**What I see:** The vertical-pack pricing model (FW-TEGAN-1) is flat-tier + optional packs. Bryn's recommendation (365-6) is "per-seat metering wired in backend (toggle-able, not activated)" — future-proofed for when an enterprise customer demands per-seat. But Tegan's view (trade-off T5) is "flat tier beats per-seat at this scale." And Wendell says "flat beats per-seat every time."
**Highest-leverage move:** Build a pricing-simulation tool for your sales team: input org size (1 operator → 10 operators), input vertical mix, output monthly cost under (a) flat-tier model, (b) per-seat model, (c) hybrid model. This becomes your "which-pricing-narrative" artifact. Show it to Caspar + Roderick's sales team monthly.
**Biggest risk:** If you commit to per-seat before understanding the enterprise customer profile, you might price yourself out of the market you want.

## 119. Tegan Russo — Monetization PM
**Lens:** Price-elasticity discipline and tier-coherence.
**Backstory:** Pricing strategist; returned from 20-panel; obsessed with whether the tiers are defensible.
**What I see:** The vertical-pack pricing model (FW-TEGAN-1) ships: Solo + Operator + Pro-Operator + Operation as base tiers, then 5 packs +$100-$200. The 30-day gate says "pricing reset rollout" (FW-TEGAN-1 helper). But there's no elasticity data — no A/B test showing "customers at $249 convert at 3x rate of $349." The price is an assumption.
**Highest-leverage move:** Run a 2-week pricing experiment: (a) cohort-A sees Solo=$199, (b) cohort-B sees Solo=$249. Measure signup rate, trial-to-paid rate, customer-LTV. If conversion drops >10%, price-elasticity is real. If conversion stays flat, you're leaving money on the table at $199. Report weekly to the founder + Roderick.
**Biggest risk:** If you don't test elasticity, you'll spend 6 months at the wrong price point.

## 120. Camila Reyes — Lifecycle PM
**Lens:** Churn-axiomatic design and retention-ladder automation.
**Backstory:** Owns onboarding-to-renewal; returned from 20-panel; obsessed with whether the first 30 days predict churn at day-90.
**What I see:** The 180-day workstream includes (180-8 pre-churn ladder automation, FW-CAMILA-3), (180-7 NPS survey at D7, FW-CAMILA-2), (180-13 D30 verdict-branching email arcs, FW-CAMILA-1). These are all shipped. But there's no dashboard showing "which retention lever is actually working?" The data exists; the analysis doesn't.
**Highest-leverage move:** Build a "Retention Diagnostic Dashboard" showing: (a) D7 NPS score by cohort, (b) D30 outcome (active / at-risk / churned) by cohort + vertical, (c) pre-churn ladder open rate by rung (step 1 email open: 30%, step 2 email open: 15% — tells you when customers check out). Wire this to `/founder/analytics` so the founder sees it weekly.
**Biggest risk:** If you don't measure retention mechanics, the founder will keep adding retention features (emails, in-app banners, etc.) without knowing which one works.

---

## Category synthesis — top 5 recommendations

1. **Resolve D2 (depth vs breadth) founder decision by 2026-06-08, then right-staff the product org to match: if Land+NI wedge, move 3 junior PMs to NI depth + freeze the other 4 verticals at feature-complete; if multi-vertical moat, hold equal staffing across 6 verticals.** · cited by: niamh-riordan (wedge discipline), fenella-drummond (roadmap-resourcing math), wendell-hart (Land power-user features), caspar-ng (implied in D2), roderick-gould (enterprise seat math, dependent on vertical strategy)

2. **RFC the vertical-pack pricing API contract (GET/POST/PATCH endpoints, versioning, extensibility) and submit to ARB for approval before shipping Pack endpoints to customers.** · cited by: tariq-sayed (API-as-product), ingrid-solberg (API stability precedent from tier-pricing), fenella-drummond (dependency chains), tegan-russo (pricing model coherence), roderick-gould (seat math is downstream of API contract)

3. **Run paranoia tests for each vertical (Notes: amortization edge cases already running; BH: tenant-screening compliance permissible-purpose gate; Land: property-cost-basis correctness) paired with Hannelore + vertical owners, document corpus, prevent 10+ customer-facing bugs.** · cited by: marlena-lansdale (note-ledger precedent), hannelore-schmitt (paranoia testing discipline), renske-de-vries (FCRA compliance correctness), hugo-beaufort (rehab-budget enforcement), imelda-costa (assignment-contract legality)

4. **Wire time-to-aha measurement for persona-aware checklist (daily cohort rollup of step-1/2/3 completion rates, target ≤4:00); build "Retention Diagnostic Dashboard" showing D7 NPS + D30 outcome + pre-churn ladder open rates by cohort.** · cited by: matías-nuñez (activation-to-retention attribution), camila-reyes (churn-axiomatic design), yuna-park (implicit in checklist work), fenella-drummond (roadmap visibility), mireille-saint-clair (deal-room loop conversion measurement)

5. **Attorney-reviewed state-specific disclosure templates + geofence logic for BH tenant-screening (D6 decision gate): TX/OK launchable immediately; CA/NY customers see "Coming Q4 2026" with honest FAQ explaining Civ §1786 compliance timeline.** · cited by: renske-de-vries (FCRA-safe screening), wynne-ohaegbu (D6 geofence recommendation), imelda-costa (state-by-state assignment rules analogy), cordelia-simpson (implicit in BH FCRA stance), cassiel-roux (eval-driven iteration on compliance)

