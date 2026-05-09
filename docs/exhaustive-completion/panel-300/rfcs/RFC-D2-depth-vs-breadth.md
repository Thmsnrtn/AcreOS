# RFC-D2: Sequencing Decision — Land+NI Wedge vs Multi-Vertical Breadth vs Community Signal Hold

**Status:** Draft (open for comment until 2026-08-08)
**Author:** Engineering leadership panel (panel-300 H7 recommendation)
**Decision-owner:** Founder
**Forcing date:** 2026-08-08
**Decision-after:** NI revenue gate evaluation ($50K net-new ARR target); Magnus persona (multi-vertical operator) feedback; 90-day backlog completion; D1 comp choice landed

## Background

AcreOS has 6 feature-complete verticals (Land, Notes, Buy-Hold, Fix-Flip, Wholesaler, Subdivider) with zero paying customers. The sequencing fork: do we deepen Land before adding new verticals (Wendell's path), commit to Land+Notes as a 90-day wedge (Caspar's path), hold all 6 in maintenance mode and let community feedback signal winners (Diego's path), or position multi-vertical breadth as the Series-A moat (Ashok's path)?

By 2026-08-08, the ASC 606 ledger will have cohort-2 revenue data (if any), NRR will be measurable (or null), and customer-concentration will be known. The 30-day work order (D1 comp choice, G1-G4 gates) will be done. This is the forcing moment: pick one path and right-staff product/engineering accordingly.

## Options

### Option A — Deepen Land Only
Ship bulk-actions on `/leads`, map default on `/properties`, comp-dossier export, call-from-list, mailer feedback loops. No feature work on Notes/BH/FF/W/SD until paying Land customers say "irreplaceable." Trial-to-paid conversion on Land cohort only. Other verticals stay feature-complete but frozen (no new features for 90+ days).
**Cited by:** wendell-hart (Land deepening discipline), customers-verticals (Land TAM defensibility), product-leadership (focus as a virtue), domain-real-estate (land-specific moats like CMA-builder are competitive differentiators)
**Trade-off:** Forecloses Notes Investor (second-easiest GTM per the panel); concentration risk if Land customers churn. Narrative to Series-A: "focused Land leader," not "multi-vertical platform."

### Option B — Land + Notes Investor Wedge (Caspar's choice)
De-staff FF/W/SD/BH to maintenance mode. Land + NI continue active development. 30 days: both ship core features (Land bulk actions + map, NI amortization calc + IRR export). 60 days: Caspar's revenue gate evaluated ($25K net-new ARR on NI, or pause). 90 days: two-vertical wedge proven or pivot to Land-only. Frozen verticals stay launchable; no churn from customers if they signed up for FF.
**Cited by:** caspar-ng (named-account playbook per vertical), customers-verticals (Notes TAM is second-easiest), product-leadership (compression to highest-leverage verticals), domain-real-estate (Land+Notes = complementary use case for institutional investors)
**Trade-off:** Customers who bought BH/W/FF get "we hear you" emails but zero feature investment for 90+ days. Morale risk if freezing 4 verticals signals "this is a Land company, not multi-vertical." Series-A narrative: "wedge strategy — expand after proving unit-economics."

### Option C — Hold Breadth; Let Community Signal
Founder-letter cadence starts (weekly, using FW-DIEGO-1 backbone). Each letter asks "what do you wish AcreOS did?" All 6 verticals get equal feature investment for 90 days. Pattern-match: which vertical is asking for the most depth? De-staff decision driven by data, not gut.
**Cited by:** diego-marchetti (community signal over founder opinion), customers-verticals (don't foreclose future revenue without market data), marketing-growth (founder-letter cadence = content + customer listening), future-emerging (breadth optionality until sub-$10K ARR)
**Trade-off:** 90 days of unfocused work; engineering time spread thin across 6 verticals. Community feedback is weak signal when n=0 customers. Morale: "we're building everything" is hard to execute.

### Option D — Multi-Vertical = Moat (Ashok's thesis)
All 6 verticals get continued equal investment. Ship the customer-facing `/pricing/packs` page (FW-TEGAN-1 backend is ready). Position AcreOS as "the OS for any land-adjacent investor." Vertical-pack pricing ($249-$499/month) means each vertical prices itself. By 90 days, $25K+ ARR distributed across verticals.
**Cited by:** ashok-bhatt (multi-vertical TAM defensibility), ana-solis (masthead-architecture supports "AcreOS: the platform"), investor-capital (Series-A breadth narrative = larger TAM story), sales-gtm (vertical-pack pricing future-proofs sales motion)
**Trade-off:** Caspar's "compound integration debt" warning — you can't ship deep features in 6 verticals with a 5-person team. Series-A investors want a wedge story ("we dominated Land, now we're expanding"), not "we shipped 6 mediocre verticals at once."

## Five questions reviewers must engage

1. **Revenue-gate calibration:** Caspar's gate is "NI hits $25K ARR by 90-day mark, or pause." Is that achievable? (Assume 10 NI customers @ $2.5K ACV average, or 50 @ $500 ACV, or 1 @ $25K.) Which scenario is realistic? If it's unrealistic, does Caspar's gate become a pivot trigger, and is that the right incentive structure?

2. **Team velocity + depth tradeoff:** If we pick Caspar's Land+NI wedge, we de-staff BH/FF/W/SD to "1 engineer per vertical, maintenance mode." Can one engineer maintain a production vertical (handle bugs, customer support, data freshness) while two engineers actively develop Land+NI? Or does "maintenance mode" mean those 4 verticals ship zero bug fixes for 90 days?

3. **Customer signal interpretation:** The 5 friendly customers we onboard in 30 days — if one of them uses FF (fix-and-flip) because they're a contractor, not a pure land investor, does that count as "customer signal" for FF? Or is 1-customer signal noise? What's the minimum-N threshold for "customer signal" to be real?

4. **Breadth-as-moat credibility (Series-A pitch):** If we pick multi-vertical, our Series-A pitch is "the platform for all land-adjacent investors." But we have zero paying customers. How do we anchor that narrative without customer proof? Do we cite "land-adjacent TAM = $50B+" and build the narrative on TAM defensibility alone?

5. **Right-staffing consequences:** Each path changes the product org structure. Land-only = 1 PM (Wendell). Land+NI wedge = 2 PMs (Wendell + Marlena). Multi-vertical = 6 PMs (one per vertical). If we pick Caspar's wedge on 2026-08-08, we fire or redeploy 4 PMs. How do we handle that conversation? Which 2 PMs stay, and why?

## What needs to be true to decide

- **NI revenue gate evaluation (2026-08-08):** Did NI hit $25K ARR? If yes, Caspar's wedge is credible. If no, de-staffing NI engineers is wasteful; pivot to Land-only.
- **Magnus persona feedback (2026-08-08):** We'll have 1-2 multi-vertical operators by 90 days (operators running Land + Notes + BH simultaneously). Did they ask for cross-vertical features (consolidated P&L, multi-vertical W-2-exit calculator)? If yes, breadth has customer signal. If no, narrowing to wedge is fine.
- **Community-letter feedback pattern (2026-08-08):** Diego's founder-letter cadence will have produced 8-12 letters + feedback. Which vertical appears in the most customer responses? Which vertical had zero asks? This data informs the "de-staff decision driven by data" outcome.
- **G1-G4 gates landed (2026-08-08):** Eval harness, API contracts, idempotency, substantive attestations all in production. This is the operational floor for all paths. If gates didn't land on time, the product org is behind and narrow wedge (Option B) is de facto required.
- **D1 comp choice (2026-06-08):** If we picked AppFolio (SMB multi-vertical thesis), Option D (multi-vertical breadth) becomes more credible. If we picked Procore (enterprise vertical-SaaS), Option B (Land+NI wedge) becomes default.

## Recommendation

**Caspar's Land+NI wedge (Option B) is the highest-conviction call.** Here's why:
- Wendell's Land-only (Option A) is too narrow; Notes is the second-easiest GTM and forecloses $300K+ revenue by year-end.
- Diego's community-signal hold (Option C) is too slow when you have zero customers; there's no signal yet.
- Ashok's multi-vertical moat (Option D) is the right *narrative* but the wrong *work order* at this team size.

**Caspar's framing:** "Prove the unit-economics of the two easiest verticals (Land + Notes), then expand breadth once you've proven you can grow $50K+ ARR per vertical." This is venture-backed SaaS 101. The vertical-pack pricing layer means a frozen vertical (BH, FF, etc.) can still convert customers; you just don't ship new features for 90 days.

**Sequence:** Land + NI both ship core depth-features (30d). Evaluate NI revenue gate (60d). If $25K ARR hit, continue both. If missed, pause NI, double down on Land. By 2026-11-08 (180-day gate), you'll have proven $50K+ ARR on at least one vertical and can credibly pitch multi-vertical expansion in a Series-A deck.

## Comment thread

(Reviewers add comments below this line. Founder owns the resolve.)

---
