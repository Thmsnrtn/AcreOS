# RFC-D1: Pick a Public Comp (AppFolio 10x vs Procore 14x vs ServiceTitan 12x)

**Status:** Draft (open for comment until 2026-06-08)
**Author:** Engineering leadership panel (panel-300 H7 recommendation)
**Decision-owner:** Founder
**Forcing date:** 2026-06-08
**Decision-after:** G1-G4 gates landed; pricing-elasticity A/B test data available; 5 friendly customers onboarded and measured

## Background

The capital strategy (D1) hinges on a narrative anchor: are we a vertical-SaaS leader (Procore 14x multiple, $1.5B+ exit), an SMB-Ops platform (AppFolio 10x, $1.5B exit), or a fintech lower-multiple play (ServiceTitan 12x, $1.2B exit)? Picking a comp drives pricing strategy, hiring profile, deck framing, and which investor class we'll attract.

Today we have zero paying customers, a 5-person engineering team, and a solid demo. The 30-day window (through 2026-06-08) will produce (a) pricing-elasticity A/B test conclusion ($199 vs $249 Solo), (b) 5 friendly-customer onboarding patterns + time-to-aha, and (c) Bryn Halliday's comp-benchmarking writeup. This data makes the comp choice defensible instead of aspirational.

## Options

### Option A — AppFolio (10x ARR multiple, SMB-Ops platform thesis)
SMB operators using AcreOS for Land + Notes + BH as an integrated desk. Pricing: $249-$499/month per operator with per-seat add-ons. Narrative: "The OS for any real-estate investor." Go-to-market: founder-led SMB, self-serve + Intercom. Hiring: full-stack engineers, product, then sales. Series-A story: "multi-vertical + SMB pricing = lower CAC, land-and-expand expansion."
**Cited by:** bryn-halliday (comp-anchoring discipline), ashok-bhatt (SMB TAM defensibility vs enterprise), espen-gulbrandsen (comp benchmarking), hideki-yamashita (proptech 10x multiple), lucette-marchand (SMB expansion math at 50-customer cohort)
**Trade-off:** Lower ACVs than enterprise path (land customers @ $3-5K vs $50K+); requires 1:many CSM motion early; Series-A growth treadmill at SaaS-y 10x multiples demands 3x revenue YoY.

### Option B — Procore (14x ARR multiple, vertical-SaaS leader thesis)
Construction management platform playing to high-revenue operators (commercial land-development firms, large construction firms, institutional real-estate funds). Pricing: $2K-$5K/month per vertical per account. Narrative: "The category leader for construction-adjacent real-estate investing." Go-to-market: founder + hired CRO targeting named accounts. Hiring: sales engineers, compliance, then customer success. Series-A story: "single-vertical depth first (Land), then breadth as a land-adjacent thesis."
**Cited by:** ashok-bhatt (multi-vertical TAM defensibility), hideki-yamashita (vertical-SaaS 14x premium), bryn-halliday (narrative consistency at scale), investor-capital panel (Series-A comp multiple benchmark)
**Trade-off:** Requires early enterprise playbooks ($50K+ ACV = custom SLAs, security reviews, named CSMs); narrower SMB TAM if executing Land-only first; hiring challenge (need experienced CRO by month-4).

### Option C — ServiceTitan (12x ARR multiple, verticalized fintech thesis)
Home-services + real-estate financing integrated platform. Pricing: $500-$2K/month + variable financing fees (1-3%). Narrative: "Fintech for real-estate operators." Go-to-market: founder + sales team targeting operators with active financing needs. Hiring: compliance engineers, credit analysts, backend (fraud/risk). Series-A story: "recurring revenue + financial-services take-rate = durable moat."
**Cited by:** adversarial-stress panel (regulatory + audit defensibility), security-compliance (SOC 2 + FCRA maturity pre-raise), investors-capital (downside protection if ARR flattens; financing take-rate = non-churn revenue)
**Trade-off:** Regulatory complexity (TILA + FCRA + state lending disclosures) front-loads 6+ months of legal work; financing vertical is a 2026+ H2 conversation (not 30-day forcing date); requires trust + 3x compliance engineering.

## Five questions reviewers must engage

1. **Comp-match calibration:** Which comp did we actually resemble at Month-6 in their founding journey? (AppFolio: $100K ARR, multi-vertical, $249/mo; Procore: $50K ARR, single vertical, $2K/mo; ServiceTitan: $200K ARR + financing take-rate.) Do our 30-day metrics land closer to one comp's Month-6 story, or are we an outlier?

2. **Hiring + burn implication:** If we pick Procore (14x, enterprise focus), we need a CRO + sales engineer by month-3 post-decision. If we pick AppFolio (10x, SMB), we hire product + full-stack by month-2. How does each hiring path change our burn rate? Which path is sustainable on a $10M Series-A?

3. **Series-A credibility bridge:** Which comp's investors are most likely to back us at this revenue + traction level? (E.g., Procore backers won VCs betting on category winners at smaller scales; ServiceTitan backers bet on fintech + vertical integration; AppFolio backers bet on horizontal SMB platforms.) Does our current team profile + narrative align with one camp?

4. **Pivot cost:** If we pick Comp A by June and the 90-day data suggests we actually look like Comp B, what's the re-anchor cost? (Pricing change? Sales-team rebuild? Narrative reframe to Series-A candidates?) Which comp choice minimizes that risk?

5. **Customer feedback alignment:** The 5 friendly customers we onboard in 30 days — do they use the product as $249/mo self-serve (AppFolio signal) or negotiate custom pricing + need a CSM (Procore signal) or ask about financing options (ServiceTitan signal)? What does customer behavior signal vs what does our narrative say?

## What needs to be true to decide

- **Pricing-elasticity A/B test (2026-05-25):** $199 vs $249 Solo price point conclusion. If $249 wins, we're trending Procore/ServiceTitan (higher-ACV thesis). If $199 wins (conversion rate +40%), we're trending AppFolio (SMB self-serve thesis).
- **5 friendly-customer time-to-aha (2026-06-08):** Measured time to first value for each customer. <4:00 = AppFolio (SMB quick wins). 4:00-8:00 = Procore (enterprise requires more setup). >8:00 = ServiceTitan (compliance-heavy, slower onboarding).
- **Comp benchmarking dashboard (Bryn's 2026-05-22 writeup):** Bryn Halliday (public-markets analyst from panel-300) compares AcreOS Month-0 metrics vs the 3 comps at their Month-0. Which comp's trajectory do we most resemble?
- **Vertical-pack pricing feedback (2026-05-30):** Do customers ask "why can't I buy Land-only?" (AppFolio path = unbundle) or "can I buy Land+Notes+BH as a bundle?" (Procore path = deepen first, then offer packs).
- **Founder narrative clarity (Asher's 1-paragraph statement, 2026-05-22):** Asher writes a 1-paragraph positioning statement per comp option. Present to advisors (Helena + Tomek + Bridget). Which one feels most coherent + defensible to external counsel?

## Recommendation

**Pick the comp *after* the A/B test + friendly-customer data lands.** Do NOT announce a comp choice before 2026-06-08. The synthesis recommendation (Bryn's narrative-first, pick a comp) should be followed to the letter: let the market data (pricing elasticity, customer behavior, time-to-aha, feedback) determine which comp matches reality.

If forced to pre-commit for 30-day roadmapping: assume **AppFolio (10x multiple, SMB self-serve) as the working narrative** through 2026-06-08. This keeps the 30-day work order (G1-G4 gates, customer kit, friendly customers) agnostic to vertical depth vs breadth. If the data says "you're actually Procore," the gates you shipped still apply; you just right-staff sales + compliance. If the data says "you're ServiceTitan," you shift hiring to credit/risk.

The downside of picking wrong is a Series-A re-narrative at month-8 ("we thought we were 10x, we're actually 14x"). The upside of picking right is a 6-month head-start on investor conversations that match your actual trajectory.

## Comment thread

(Reviewers add comments below this line. Founder owns the resolve.)

---
