# Executive / Strategy — 15 personas

## 121. Asher Klein — CEO
**Lens:** Narrative coherence and founder-voice consistency.
**Backstory:** Founder voice; returned from 20-panel; obsessed with whether every surface reflects founder philosophy.
**What I see:** The forward synthesis (`_FORWARD-SYNTHESIS.md`) lists 8 trade-offs (T1–T8); 4 require your explicit judgment (D1 capital, D2 depth, D6 geofence, D8 eval). The other 4 (acquisition loops vs CSM ops, pricing model, international timing, litigation surface) are implicit in your D1/D2/D6 choices. But there's no narrative thread connecting them. Your pitch to investors (if D1=raise) will sound incoherent if you haven't decided T2 (depth vs breadth) first.
**Highest-leverage move:** Before filling in the D1/D2/D6/D8 resolution boxes, write a 1-paragraph "AcreOS narrative" that you'd use in investor meetings: "We're [vertical-SaaS leader / SMB-Ops platform] focused on [Land / Land+Notes / 6 verticals], monetized via [per-seat / flat-tier / packs], raising [Series A / bootstrapping / selling] to [land-only customers / all-investor personas / strategic acquirer]. Every subsequent decision is a footnote to that paragraph.
**Biggest risk:** If you don't have a narrative, your first investor meeting will sound like a list of features, not a thesis.

## 122. Olu Adebayo — COO
**Lens:** Runbook discipline and operational repeatable-ness.
**Backstory:** Operations at scale; returned from 20-panel; obsessed with whether the 2am junior engineer can execute your playbooks.
**What I see:** The 30-day verification gate (2026-06-08) includes "8 missing runbooks written" (Olu's work per `_FORWARD-SYNTHESIS.md` §4.1). The 8 are: Clerk, SES, Twilio, e-sign, GDPR, agent, founder, Fly. But the master runbook directory (`docs/runbooks/`) has only 1 (database-restore). So you're 7 runbooks behind, 8 weeks out.
**Highest-leverage move:** Pair each runbook with an incident. If you've had zero e-sign webhook failures, ask: "What would I do if one failed at 3am?" Write the runbook *proactively*. For each of the 8, identify the on-call engineer, run a 30-min incident-simulation, refine the runbook based on what they didn't know. Ship runbooks with "last tested" dates.
**Biggest risk:** If you defer runbooks until an actual incident, the 2am engineer invents their own playbook and you have 4 different responses to the same problem.

## 123. Marisol Vega — CFO
**Lens:** Legible numbers and ASC 606 compliance.
**Backstory:** Series-A diligence-readiness; returned from 20-panel; obsessed with whether your bookkeeping will survive audit.
**What I see:** The subscription-events ledger (FW-MARISOL-2) + ASC 606 recognition cron is shipped + verified. The `/founder/financials` dashboard (FW-MARISOL-3) showing NRR / gross margin / COGS-per-customer is shipped. But there's no verification that the numbers are *correct*. Did you miss a revenue-event class? Is COGS missing a cost category?
**Highest-leverage move:** Run an "accounting close simulation" with a hypothetical customer: (a) sign up for Operator tier + Land pack on 2026-05-15, (b) record every system event (signup, first login, invoice, payment, churn-at-day-25), (c) manually calculate what the revenue should be under ASC 606 (daily prorata recognition, 5 days of service = 5/30 of monthly MRR), (d) compare to what the ledger + cron calculated. If they don't match to the cent, fix the cron logic before a real customer.
**Biggest risk:** If the revenue-recognition cron has an off-by-one-day bug, your first audit will find it and you'll restate earnings.

## 124. Caspar Ng — CRO
**Lens:** Vertical-SaaS sales orgs and named-account playbook.
**Backstory:** Vertical-SaaS sales orgs; returned from 20-panel; obsessed with named-account playbook per vertical.
**What I see:** The D2 decision (depth vs breadth) names three paths: Caspar's "Land+NI wedge" is the highest-conviction call per the synthesis. But the 90-day verification gate says "Note Investor closed-beta hits 10 customers paying" — that assumes (a) you built NI to beta-quality, (b) you have a sales motion for NI, (c) NI customers are identifiable and reachable. None of these are true at day-0 of shipping.
**Highest-leverage move:** If the founder picks Land+NI wedge (D2), run a "pre-sales discovery sprint" Week 1 of the 90-day cycle: (a) identify 5 target Note Investor accounts (portfolios >$500K, LinkedIn identifiable), (b) cold-email with "we built a ledger for note investors; want to chat?", (c) capture feedback on the $249 monthly price point. By week 2, you'll know if NI is worth 90 days of engineering focus or if you should pivot to Land-only.
**Biggest risk:** If you build NI for 90 days without confirming there are customers who want it, you'll ship a beautiful feature nobody pays for.

## 125. Ana Solis — CMO
**Lens:** Masthead-architecture decisions and voice consistency.
**Backstory:** Brand + category-design; returned from 20-panel; obsessed with masthead-architecture decisions.
**What I see:** The forward synthesis (§2 C8) converged on "Founder-voice audit pass" — audit `/auth`, `/pricing`, `/money`, error-toasts for competitive-frame paragraph. But there's also an implicit brand-architecture question (T8 in the trade-off map): "AcreOS" masthead only, or "AcreOS for Land" + "AcreOS for Notes"? Asher's frame (Path C): "Named-verticals emphasize focus." Wendell's frame: "Masthead only if Land ledger ships bulletproof first."
**Highest-leverage move:** Map the three brand architectures: (a) Asher's monolithic "AcreOS" with vertical emphasis in subhead, (b) Wendell's "AcreOS for [Vertical]" sub-brands, (c) Ashok's "AcreOS: the OS for any land-adjacent investor" with packs as differentiator. Write the positioning paragraph for each. Present to Asher at founder-voice review. Pick one and lock it.
**Biggest risk:** If you don't lock the brand architecture, every vertical PM will invent their own sub-brand and your category positioning fragments.

## 126. Hatim Belkacem — Chief of Staff
**Lens:** Weekly-business-review discipline and cadence integrity.
**Backstory:** Runs CEO operating cadence; obsessed with weekly-business-review discipline.
**What I see:** The 30/90/180/365-day verification gates are ambitious (e.g., 90-day gate: "subscription-events ledger + NRR ≥110%, customer-concentration <20%, COGS per customer attributed"). But there's no weekly pulse — no standup where these metrics are reviewed every Friday. The gates matter only if you're measuring them.
**Highest-leverage move:** Establish a "Friday Pulse" standup: (a) 30-day countdown to each gate, (b) weekly metric updates (code commits toward goal, engineering progress, customer signups, revenue), (c) red-light early warning (if you're on pace to miss a 90-day gate, re-prioritize by week 6, not week 12). Template it in a Google Sheet + Slack bot (auto-summary every Fri at 4pm). This turns synthesis into accountability.
**Biggest risk:** If you don't establish a pulse, the founder will realize at day-85 that you're off-pace on the 90-day gate.

## 127. Zara Pemberton — VP BizOps
**Lens:** KPI-tree clarity and unit-economics visibility.
**Backstory:** Quant-shaped ops; obsessed with KPI-tree clarity.
**What I see:** The `/founder/financials` dashboard (FW-MARISOL-3) has 4 top-line metrics: NRR, GRR, top-5 MRR concentration, gross margin per tier. But there's no KPI tree underneath. What are the *inputs* to NRR? (Expansion revenue from existing customers / churn rate / etc.). What are the *levers* to move each input? (Pax features for expansion / retention ladder for churn / etc.). Without the tree, Asher sees "NRR = 108%" and has no idea what to do about it.
**Highest-leverage move:** Build a 1-page "AcreOS KPI Tree": NRR at the top, expansion + churn as branches, then 3-4 specific levers per branch (e.g., Expansion: [pre-churn ladder engagement rate, pack upsell rate, feature-adoption leading indicator]). Map each lever to a product/growth workstream. This becomes your "what do I focus on this quarter?" artifact.
**Biggest risk:** If you ship metrics without the tree, Asher will ask "how do I move NRR?" and nobody will have an answer except "build more stuff."

## 128. Espen Gulbrandsen — VP Strategy
**Lens:** Comp-set benchmarking and narrative-first decision-making.
**Backstory:** Strategy consulting background; obsessed with comp-set benchmarking.
**What I see:** Bryn's D1 recommendation (narrative-first) is "pick your comp (AppFolio 10x ARR, Procore 14x, ServiceTitan 12x), reverse-engineer the operations to match." But you haven't picked a comp yet. The team doesn't know whether they're building for 10x multiples or 14x. That changes hiring (Vesper), pricing (Tegan), and customer profile (Caspar).
**Highest-leverage move:** Run a 2-day strategy sprint: (a) audit the 3 comps (revenue trajectory, pricing model, vertical breadth, founder voice), (b) match to your 90-day metrics (do you look more like AppFolio Month-12 or Procore Month-12?), (c) reverse-engineer the 365-day operations (if Procore = 14x multiple, what team size / NRR / gross margin do you need?). Report to Asher. Pick one comp and anchor all future strategic decisions to it.
**Biggest risk:** If you pick the wrong comp, you'll structure the business for 10x economics when the market rewards 14x, leaving $100M upside on the table.

## 129. Vianey Castaneda — VP Partnerships
**Lens:** Co-sell motion and vendor ecosystem.
**Backstory:** Built partner programs; obsessed with co-sell motion.
**What I see:** The vendor-partners list (roster §17) names 15 vendors: Stripe, Clerk, AWS, Twilio, OpenAI, Anthropic, Lob, Cloudflare, Sentry, Fly, Dropbox Sign, Plaid, Mapbox, Regrid, Snyk. Each one is a potential co-sell relationship. But there's no partnership roadmap — no "Q2 we deepens Stripe + Twilio, Q3 we launch Regrid integration." Hartwell (real-estate attorney at a vendor) is a returning persona; his deal-killer is "Hartwell title-API integration." Has anybody called Hartwell back since the 20-panel?
**Highest-leverage move:** Send each vendor a note: "We're using your service / API at AcreOS. Interested in co-marketing?" Quantify: "Stripe processes $X of transaction volume for us monthly." Start with the 3 highest-touch (Stripe, Clerk, Twilio) to formalize the relationship. Aim for one co-marketing play per quarter.
**Biggest risk:** If you don't nurture vendor relationships, they'll deprioritize your support tickets and feature requests.

## 130. Padraig Macdonald — VP Legal / GC
**Lens:** Contract-template stewardship and vendor-management discipline.
**Backstory:** In-house counsel at SaaS; obsessed with contract-template stewardship.
**What I see:** The forward synthesis includes D6 (geofence BH to TX/OK) + D8 (eval-harness ownership). Both have implicit legal surfaces: D6 needs state-specific disclosure templates (attorney-reviewed before launch); D8 needs model-deprecation playbooks (documented, founder-approved, legal-reviewed). But there's no legal-review queue. Who's tracking attorney sign-off on the disclosure templates?
**Highest-leverage move:** Build a "Legal-Review Queue": (a) list pending items (TX §5.069 disclosure registry, NY §307 disclosure registry, BH tenant-screening permissible-purpose form, eval-harness model-deprecation process), (b) assign priority (geofence is blocker for BH launch; eval ownership is blocker for SOC 2), (c) estimate external counsel cost ($5K - $20K total). Present to Asher. This is the `_FORWARD-SYNTHESIS.md` "legal-review-queue maintenance" (Phase 5).
**Biggest risk:** If you don't track legal-review items, you'll launch BH nationally without CA/NY disclosure templates and face $5M liability exposure.

## 131. Nour Haddad — GM Enterprise
**Lens:** Custom-SLA discipline and seat-math expansion.
**Backstory:** Owns enterprise BU; obsessed with custom-SLA discipline.
**What I see:** The 365-day roadmap includes "CRO hire trigger (first $50K+ ACV NI customer)" — i.e., you're waiting for an enterprise customer before hiring for enterprise. But enterprise customers come *before* the CRO hire, not after. The bottleneck is: do you have enterprise playbooks today? (Roderick's seat-math tools, Nour's custom-SLA templates, etc.)
**Highest-leverage move:** Write 3 "enterprise playbook" templates: (a) $50K ACV Land customer (multi-user, custom reporting), (b) $50K ACV Notes customer (institutional-grade audit trail), (c) $50K ACV multi-vertical customer (consolidated P&L). For each, define the SLA (5-minute response, 99.95% uptime), the customer-success motion (QBR cadence), and the pricing (flat $50K + overage on data exports?). These become your "enterprise sales deck."
**Biggest risk:** If you don't have enterprise playbooks pre-written, the first $50K customer will ask for things you haven't thought through.

## 132. Soren Lindgren — GM SMB
**Lens:** Self-serve-vs-touch-sales math and unit-economics.
**Backstory:** Owns SMB BU; obsessed with self-serve-vs-touch-sales math.
**What I see:** The vertical-pack pricing model ($249 Solo + packs) is designed for SMB self-serve. But there's no product-motion distinguishing SMB from Enterprise. Should SMB get Intercom live-chat? Enterprise get a CSM? Or is it all self-serve until $50K ACV?
**Highest-leverage move:** Define the "self-serve threshold": "Below $100/month, customers get help-center + Intercom chat. Between $100-$250, customers get a 30-min onboarding call + Intercom. Above $250 (i.e., multi-operator + packs), customers get a named CSM." Wire this to the org_mrrmonth UDF so support routing is automatic. This prevents the SMB team from manually deciding who gets touch every time.
**Biggest risk:** If you don't define the threshold, high-touch SMB customers get disappointed when they hit $249/month and lose their CSM.

## 133. Helena Brueggemann — Board Chair
**Lens:** Executive-cadence discipline and board-reporting standards.
**Backstory:** Independent board chair; obsessed with executive-cadence discipline.
**What I see:** The 30/90/180/365-day verification gates are well-defined. But there's no board-reporting standard. Does the board review monthly? Quarterly? Do you report against the gates, or do you report against "what we shipped"? The synthesis assumes the founder owns the D1/D2/D6/D8 decisions; but does the board get a vote?
**Highest-leverage move:** Define a "Board Reporting Cadence": (a) monthly all-hands (shipped items, metrics, risks), (b) quarterly board meeting (deep-dive on one strategic decision, e.g., D1 capital strategy), (c) 90-day gate review (are we on-pace?). Template the monthly deck so it's consistent. This prevents the founder from being surprised at a board meeting because a different narrative was told.
**Biggest risk:** If you don't establish a cadence, the board will feel out of the loop and the founder will feel micromanaged.

## 134. Tomek Wisniewski — Board Observer
**Lens:** Quarterly-board-deck quality and information asymmetry.
**Backstory:** Series-A observer; obsessed with quarterly-board-deck quality.
**What I see:** The synthesis is rich, but it's not a board deck. A board deck is a 15-slide story: market size, traction, team, capital needs, next milestones, risks. The synthesis is a 50-page operational artifact. They're different animals.
**Highest-leverage move:** After Asher files in the D1/D2/D6/D8 resolutions, convert the synthesis into a "Series-A Investor Deck" template: (a) cover slide (narrative statement), (b) market size + TAM, (c) traction (revenue, NRR, customer count, unit economics), (d) team + org chart, (e) product roadmap (30/90/180-day highlights), (f) capital ask + use-of-proceeds (D1 answer), (g) risks + mitigants. This becomes your investor-meeting one-pager.
**Biggest risk:** If you wait until Series-A prep to write this deck, you'll realize you're missing 3 months of data.

## 135. Bridget Ó Faoláin — Advisory Board Member
**Lens:** Founder-advisor cadence and operator perspective.
**Backstory:** 3rd-time advisor; obsessed with founder-advisor cadence.
**What I see:** The forward panel includes returning personas (Asher, Marisol, Olu, Caspar, Ana, Wendell, Tegan, Camila, Ashok, Harlowe, etc.). That's your *internal* advisory board. But the external advisors (board chair, observer, advisors) haven't been mentioned. Are you meeting with them monthly? Have you asked them to double-check the D1/D2/D6/D8 resolutions?
**Highest-leverage move:** Schedule 1-on-1 calls with each of the 3 external advisors (Helena chair, Tomek observer, you). Share D1/D2/D6/D8 resolutions in advance. Ask: "What am I missing? What would you do?" Record the feedback. Fold into the founder's resolution. This is cheap insurance against a $12M capital decision made in isolation.
**Biggest risk:** If you don't vet the D1/D2/D6/D8 decisions with advisors, a later board meeting will surface an objection you could have surfaced now.

---

## Category synthesis — top 5 recommendations

1. **Write the AcreOS narrative (1 paragraph, used in investor meetings) BEFORE resolving D1/D2/D6/D8 — narrative coherence is prerequisite for consistent decisions.** · cited by: asher-klein (founder voice), ana-solis (brand architecture), espen-gulbrandsen (comp-set benchmarking), tomek-wisniewski (investor deck), bridget-faoláin (advisor vetting)

2. **Establish a "Friday Pulse" weekly standup (30-day countdown, metric updates, red-light early warning) to turn the 30/90/180/365 verification gates into accountability, not retrospective artifacts.** · cited by: hatim-belkacem (weekly business review), olu-adebayo (runbook cadence), zara-pemberton (KPI tree visibility), marisol-vega (revenue-recognition discipline), caspar-ng (pipeline forecasting)

3. **Build a "Legal-Review Queue" tracking pending items (geofence disclosure templates, eval-harness model-deprecation playbook, etc.) with priority + external counsel cost estimates; assign to Padraig for execution.** · cited by: padraig-macdonald (contract stewardship), wynne-ohaegbu (D6 geofence), indira-lockwood (D8 eval governance), asher-klein (risk mitigation), bridget-faoláin (advisor sign-off on legal strategy)

4. **Pick a comp (AppFolio 10x, Procore 14x, or ServiceTitan 12x) and reverse-engineer the 365-day operations; this anchors all strategic decisions (pricing, hiring, customer profile, capital narrative).** · cited by: espen-gulbrandsen (comp benchmarking), asher-klein (narrative coherence), caspar-ng (ACV profile), roderick-gould (enterprise pricing), tegan-russo (pricing-model defensibility)

5. **Vet the D1/D2/D6/D8 founder resolutions with external advisors (Helena, Tomek, Bridget) before committing; capture feedback, fold into founder's final resolution; cheap insurance against $12M decision regret.** · cited by: bridget-faoláin (founder-advisor cadence), tomek-wisniewski (board-deck quality), helena-brueggemann (executive cadence), asher-klein (narrative vetting), vianey-castaneda (partnership strategy dependent on D2 decision)

