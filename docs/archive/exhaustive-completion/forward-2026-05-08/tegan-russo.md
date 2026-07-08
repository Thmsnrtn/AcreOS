# tegan-russo — Pricing & Packaging Strategist

**Reading list:**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (P0-1 unified tier-pricing shipped)
- `docs/exhaustive-completion/REMAINING-WORK-INVENTORY.md` (Tegan's original audit + expansion revenue roadmap)
- `shared/billing/tier-pricing.ts` (single source of truth, live 2026-05-08)
- `server/services/autonomousSalesPipeline.ts:309` (enterprise shape already exists, $999/mo)

**State read (1 paragraph):**
The seven price-table mess is solved. `shared/billing/tier-pricing.ts` is canonical and Stripe syncs cleanly. What ships next isn't another price hike — it's a tier-architecture decision that survived the P0 sweep: Tegan's operator-class shape (Solo $79 / Operator $249 / Pro Operator $599 / Operation $1,490) is the right frame and annual discount math (12–17% by tier) de-risks conversion loss. The expansion-revenue gap is the real miss: mailers, AI calls, skip-tracing, and e-sign are metered in the code but not charged outside subscription. A unified credits ledger + per-vertical pricing packs (Note Investor +$200/mo, Wholesaler +$100/mo) unlocks 30% of MRR by month-12 post-launch — industry-leading for vertical SaaS. The question now is: *do we have the pricing discipline to ship expansion before shipping a new vertical?*

**Push forward — my 5 moves (ranked):**

1. **Wire expansion revenue transport (credits ledger + metering)** — ship one unified ledger where mailers, AI, lookups, and e-sign all draw from one balance with auto-top-up. 3–4d build, unblocks 30–50% of customer lifetime value that's currently invisible. Test with 5 Operator-tier customers: if they spend ≥$3K/mo beyond base, the model holds. — *Why now: expansion revenue is the only lever that keeps ARPU growing after reprice; without it, MRR flatlines month-6 when new-customer cohorts shrink.*

2. **Ship the annual SKU launch on-time (target end-Q2)** — confirm with Stripe that annual Prices are live for all tiers, test the grandfathering logic (new customers see new prices; existing monthly → annual conversion offers 20% off grandfathered rate). Measure: 40% of monthly converts to annual within 90 days of migration. — *Why now: annual cohort locks LTV 12 months; we're leaving $500K+ on the table if this slips past Q2.*

3. **Vertical pack pricing spec (Note Investor, Wholesaler, Tax-Delinquent)** — don't build four pricing pages. Build one and meter the verticals. Each vertical is a +$100–$200/mo pack on top of any tier (not a tier itself). This future-proofs the four-vertical roadmap and prevents the "pricing table explosion" from happening again. Document the rule: *"One base price. Vertical packs unlock domain-specific agents and workflows."* — *Why now: the vertical work launches soon; embedding this pricing pattern in the product code (not as an afterthought) keeps the table from re-exploding.*

4. **Pre-launch comp & beta policy overhaul** — Marisol flagged that free accounts and comps have no shadow-MRR visibility. Write a policy: every comp account has a `comp_reason`, `comp_expires_at` (default 12mo), and a shadow-MRR measure. Comps convert to paid on expiry with 60-day notice. Publish this on `/pricing`: *"Free accounts for paying customers only. Early-stage partners are on 12-month comps, then conversion."* This moves comps from a trust-erosion vector to a trust-builder. — *Why now: with seven founders and customers asking for free seats, a policy blocks the death-by-a-thousand-comps scenario.*

5. **Defer per-seat pricing at lower tiers; measure ceiling friction** — Tegan's original audit called this out: per-seat punishes small teams. Keep flat pricing with seat ceilings (Pro Operator = 10 seats / $40 overage). Measure: do partnerships (dad-and-son, two-person teams) convert at flat rate better than per-seat? If yes, this becomes the permanent model. If no, revisit. — *Why now: we're about to onboard our first partnerships; this decision made now prevents seat-math churn later.*

**What I'd defer (and why):**
- Dunning and payment-recovery flows until month-3 (churn is pre-launch risk, dunning is retention-phase risk)
- Multi-org fund pricing until a fund customer walks through the door (overbuilding for a hypothetical $X/mo customer ties up engineer-days on speculation)
- Marketplace-style "take a percentage of deal value" until we've proven seat-based ARR scales past $100K/mo (value-based sounds good; it's actually chaos for bookkeeping and collections)

**What scares me most:**
Bryn's going to push for per-seat pricing to match AppFolio (10x ARR multiples, investor comps matter). Per-seat is the "safe" play for VC optics. But per-seat on land-investor software at $40 AOV is a moat-eliminator — small teams churn the moment the second seat triggers an overage notice. I'd rather defend a pricing model that fits the customer than defend a model that looks good in a pitch deck. The test: ask Wendell if he'd rather pay $249 flat for 3 seats or $100 + $80/seat for 3. He chooses flat every time. That's the customer model we ship.

— Tegan
