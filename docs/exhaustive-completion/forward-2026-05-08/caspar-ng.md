# caspar-ng — Vertical-SaaS CRO / multi-vertical sequencing

**Reading list (what I read before writing):**
- MASTER-FINDINGS-RECONCILIATION.md
- post-may1-resweep.md (RS-1..RS-7 closed; BH screening gate still open)
- git log (53 vertical PRs since May 1; NI/TD/W/SD/FF/BH all shipped)

**Backstory:**
Built sales orgs at ServiceTitan (HVAC, $800M exit), Toast (restaurants, $25B IPO), Procore (construction, $13B IPO). Watched a $40M ARR vertical-SaaS company chase 3 new verticals simultaneously, miss execution on all 3, and crater to acquisition. Scar: vertical expansion without first proving repeatable unit economics on one wedge is how you die. Current obsession: the PMF watermark — when is a vertical "ready" to be deprioritized so a second vertical can ramp, and how do you sequence them so the org doesn't suffocate?

**State read (1 paragraph):**
AcreOS has shipped 6 verticals in 5 weeks. That's a feat. But "shipped" doesn't mean "customers paying," and Caspar is the boring-metrics guy. Note Investor is wedged but unproven (zero revenue, product is raw, Magnolia persona still designing how investors actually use it). Broadband/Housing are even earlier. The land-investor personas (NI-adjacent, same cash flow obsession) have legs, but NI proper needs to reach $1M+ ARR before you touch #7. Meanwhile, Wendell (the 12-year land investor) will notice you're building for six customer archetypes while solving for zero of them deeply. The choice isn't "all six or none" — it's *which one gets the next 6 weeks of CRO rigor*.

**Push forward — my 5 moves (ranked):**

1. **Name the wedge explicitly: Note Investor is secondary, NI/Land-portfolio is primary.** Magnolia wants NI for the sourcing loop; Wendell wants NI for the deal-evaluation loop; they are different products. Until you call out which customer segment owns NI's roadmap, you're building two products at once. RS-1/RS-2 closed on BH screening; now BH needs TBD tenant-screening ACV and 3-customer pilot before it's vertical-2. But Land (NI+land-portfolio together) can hit $1M ARR with 10 existing customers and 20 pilots. Pick Land, get obsessive. — *2-week planning sprint; effort shifts to GTM (Caspar domain)*

2. **Baseline the GTM math on land-investor NI.** What's the ACV? (Wendell says "$50K for a professional; $10-30K for a bootstrapped operator; the distribution is bimodal.") What's the install base in AcreOS today? (Founder says "maybe 3 deals tracked as notes, real integration is thin.") Run a 5-customer pilot, measure: activation (do they create a note in month 1?), retention (is notes.count > 0 by month 3?), expansion (are they linking notes to capital raises or deal-selling? checking feature adoption in `notes` table + via telemetry). 3 months, close-of-quarter decision gate on whether NI continues or deprioritizes. — *3 months; CRO hire trigger.*

3. **Suspend vertical-7 planning until NI baseline is set.** Caspar disagrees sharply with Wendell (who wants deepening NI *and* wants Land-portfolio launch concurrently). One vertical at a time. Broadband Housing Tax is still raw; Wholesale Lending is theoretical. When NI hits $500K ARR net-new (not migrated), then plan vertical-7. When NI hits $1M ARR, then hire the vertical-2 PM and CRO. Not before. — *deferral (and disagreement)*

4. **Hire the CRO when NI closes its first $50K+ ACV customer.** That customer will need: contracting discipline (do they sign a real MSA or a handshake?), onboarding choreography (does a 30-min walkthrough stick, or do they need a week?), escalation protocol (who do they call when the feature request is urgent?). One customer at that ACV teaches you more than 10 $5K customers. The CRO makes that teachable moment explicit. — *trigger: first $50K customer; assume Q3 2026*

5. **De-staff the 5 non-wedge verticals to maintenance mode.** This is the hard move. TD, W, SD, FF, BH stay live for existing customers; no new features except bug-fixes and compliance gates (like RS-1/RS-2 for BH). Redirect the 2-3 engineers who built those verticals to NI depth: deal-sourcing integrations, capital-structure modeling, SPV accounting. — *1 sprint to retriage; engineering velocity immediately +25%*

**What I'd defer (and why):**
- Wholesale Lending vertical (#7). The commercial-lending playbook requires a different sales motion (SBA officer relationships vs individual operators), different underwriting (creditworthiness vs property arbitrage), different contract terms. Don't touch this until NI is $2M+ ARR and you've hired a dedicated vertical PM. The six you have now are the right experiment; a seventh dilutes.
- Founder-dashboard v2 / ops-console extraction (FOUNDER-DASHBOARD-V2-PLAN.md, deferred). Asher, Marisol, Theo all shipped founder-facing work; the monolith stays. Not because it's not a problem, but because the engineer-hours it consumes are better spent on Note Investor onboarding flows (`/notes/create`, `/notes/link`, `/notes/export`). Polish can wait 90 days.

**What scares me most (one named risk + mitigation):**
*The vertical graveyard.* Six verticals shipped, zero are at repeatable $100K+ MRR yet. If Q3 ends and *all six* are still in "early pilots, unclear retention," the board narrative flips from "we're building the land-investor OS" to "we're a spray-and-pray platform with no focus." Mitigation: set explicit revenue gates per vertical by end-Q2 (30 days). For NI: $50K net-new revenue. For BH: 2 paying customers on tenant-screening (post RS-1/RS-2). For the others: 1 paying customer or deprioritize. If you have 3+ verticals hitting those gates, the story survives; if fewer than 2, Caspar recommends a hard pivot to just Land + NI and let the others cool. The alternative is death by a thousand verticals.

---

**Caspar's disagreements (named explicitly):**
- **Vs. Wendell:** You want NI *and* Land-portfolio *and* horizontal deepening all at once. CRO says: pick one. Land (NI + portfolio tracking) is the wedge; give it six months before considering the parallel vertical.
- **Vs. Marisol:** You want a Series-A narrative next quarter. CRO says: no revenue gates, no Series-A pitch. Get one vertical to $1M ARR first, *then* you have a diligence story. Raising on "six verticals, all early" is a down-round signal.
