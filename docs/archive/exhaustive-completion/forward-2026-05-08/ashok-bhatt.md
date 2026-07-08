# Ashok Bhatt — VC Series-A IC memo

**Reading list (what I read before writing):**
- `docs/exhaustive-completion/MASTER-FINDINGS-RECONCILIATION.md` (21/24 P0s shipped; pricing source-of-truth unified per P0-1; P1-35..46 still open on AI eval)
- `docs/exhaustive-completion/post-may1-resweep.md` (RS-1..RS-7 closed; no new fund-blocking items; Note Investor permissible-purpose gate + adverse-action notice slated for Phase 4)
- Ashok-series-a.md — original memo from 2026-05-01 (conditional yes at $4M seed-extension/$20M post; Series-A at $12M/$60M post once 7 fixes shipped)
- `shared/billing/tier-pricing.ts` (single source now live; Tegan's pricing reset ($79/$249/$599/$1,490) planned), `server/services/providers/` (data moat building), `autonomousHealthMonitor.ts` (cost tracking started)
- `client/src/pages/founder-dashboard.tsx` (7,379 lines, still monolith; extraction queue deferred but pending), `server/routes-admin-recovery.ts` (founder recovery console 100% shipped per RS-4..RS-7)

---

## State read

Five weeks ago I said: "Conditional yes — $4M seed extension at $20M post, Series-A in 9–12 months once pricing is single-source, NRR is legible, COGS is rolled up by customer, and the founder's voice carries the brand through the auth wall." 

Today: pricing source-of-truth (P0-1) shipped. Tier-pricing now has one table (`tier-pricing.ts`). The founder dashboard is still unrefactored (7,379-line monolith), but the operational density hasn't blocked Note Investor work or any P0. RS-1..RS-7 shipped without deal-killers. The Theo/Wendell/Yuna audits above show specific engineering moves that are fundable and low-risk. **The game has not changed. The execution risk has not increased. The founder's credibility has actually strengthened because he shipped 21/24 P0s in 5 weeks.**

---

## Push forward — my 5 moves (ranked)

1. **Crystallize the multi-vertical thesis with a closed-beta plan for Note Investor by month 3 post-seed** — Ashok's original §7.9 said "closed beta: 10 customers, $500 ARPU, 12-week timeline." This was the proof point for the TAM expansion ($1.5B from Land+Notes+Wholesale). That proof is do-or-die for Series-A math. Ship Note Investor read-only today (Sophie's current state per the original brief). Close-beta: invite 5 Land Investors who have existing notes, ask them to upload portfolios, charge them $50/month for beta access. Goal: 10 customers by month 3, then move to $500/month pricing. This isn't a product swing; it's a go-to-market proof. Sophie already has the note-servicing read-only surface; the beta is permission to charge and the customer data to prove the model works. Two weeks of go-to-market design (beta landing page, onboarding, email). Zero product work (reuse Land onboarding).

2. **NRR + GRR + COGS-per-customer legible on `/founder-home` or a new `/founder/financials` tile** — Marisol's original audit said "NRR is the most-asked metric in Series-A; AcreOS has none." Ashok's §8.1 term sheet conditions said "Monthly metrics dashboard with NRR, GRR, customer concentration, COGS-per-customer." That dashboard doesn't exist yet. Build a `/founder/financials` page (or a tile on existing `/founder-home`): four numbers (NRR, GRR, avg gross margin per tier, customer concentration alert). NRR is straightforward SQL: `(month_N_cohort_revenue - churn - contraction + expansion) / month_N_cohort_revenue`. COGS-per-customer: `SUM(ai_calls × cost_per_call + data_costs + other_cogs) / customer_id`. Customer concentration: `TOP(organizations BY MRR)`. Wired to `autonomousHealthMonitor.ts` if it already aggregates; if not, write a nightly job. Two weeks. This dashboard becomes the investor narrative. Without it, the Series-A meeting is "let me log into Stripe and show you the numbers," which reads amateur.

3. **Pricing reset (operator-class, 90-day rollout) executed and grandfathered** — Tegan's original §7 said pricing reset ($79/$249/$599/$1,490 vs current $20/$49/$79) is the difference between a $30M post and a $60M post. The tier-pricing source-of-truth is done. The reset itself is not. Send an email to existing customers (likely <10 at this stage): "You're grandfathered at your current price forever. New customers start at the new tiers." Migrate Stripe Price objects to the new skus. Roll out over 30 days (day 1-10: new signups only; day 11-30: opt-in upgrade path for existing; day 31: public announcement). This is a go-to-market motion, not a feature. Two weeks (legal/comms/Stripe setup). Adds $X00K to forward ARR if executed cleanly.

4. **Founder-voice audit pass on `/auth`, `/pricing`, `/money`, empty-states, error-toasts, payment-failure messages** — Ashok's original §7.8 said "empty states, toasts, payment-failure copy, security page in founder voice. This is the brand becoming production-grade." You've shipped the recovery console (Asher's incident-response surface). You haven't applied the founder voice uniformly. Audit every customer-facing surface that doesn't require logged-in state: auth pages (sign-up copy, sign-in button label, password-recovery tone), pricing page (tier descriptions, CTA buttons), error messages (404, 500, rate-limit), payment failure (decline, card expired). Current state: mixed (some Shopify-template copy, some founder voice, some generic SaaS). Goal: every surface is letter-to-a-customer tone. One week of copy + QA. High-signal for the IC room — shows the product is intentional, not hurried.

5. **SOC 2 Type II audit initiated (month 1 post-seed commitment)** — Ashok's §8.1 term-sheet "use of funds" line item: "$1M: Compliance — SOC 2 Type II completion." This is not a pre-Series-A blocker, but it's a Series-A prerequisite for any operator-tier customer conversation. Engage an auditor (Drata, Vanta, Striped) in month 1 post-seed close. They'll walk the app, interview the founder, observe logging/retention/access patterns. Time-to-cert: 4-6 months. Cost: $40K–$80K. This signals institutional rigor. If you close a seed extension today, start the clock on SOC 2 immediately. Three weeks to kick off; 4 months to completion.

---

## What I'd defer (and why)

- **Enterprise sales infrastructure (multi-year contracts, custom DPA, negotiated discounts).** Tempting for land-investor "operators." Defer until you have $2M ARR from Land + 10 paying Note beta customers. Then hire a revenue-operations operator to manage deal desk. Today you're founder-led, PLG-ish, and moving fast. Sales bureaucracy slows that down without improving the unit economics yet.
- **International expansion.** Ana's brand memo mentioned UK/AU land-investing. Real but not now. Land US operations are not yet capital-efficient; Canada is ~3x easier (similar market, no compliance delta). Defer until Year 2.

---

## What scares me most (one named risk + mitigation)

**The founder becomes the bottleneck before the product becomes defensible.** Ashok's §6.1 flagged bus-factor of 1. Since May 1, Thomas has shipped 21 P0s, unified pricing, built recovery console, and is now directing 5 parallel persona audits. If he burns out at month 14 (after seed extension closes, before Series-A metrics are hit), the company does not recover quickly. The brand is the founder; the code is secondary. Mitigation: (a) commit to a founder coach (a16z partnership or equivalent) starting month 1 post-seed; (b) hire a VP of Product or Technical Co-founder (junior-senior engineer, not a manager) by month 6 post-seed to carry some of the spec/decision load; (c) the Note Investor closed-beta (move 1, above) is a test of whether the product can be grown without Thomas being in every customer conversation — if it can't, that's the leading indicator of burnout risk.

---

**Bottom line for the founder:** You're 90% of the way to the Series-A condition. The five moves above are the final 10%. Do them in parallel (pricing reset, founder-voice audit, Note beta plan, financials dashboard, SOC 2 kick-off). None of them are product builds; all of them are operational excellence. The Series-A case becomes one slide: "founder-led vertical SaaS with $500K–$1M ARR, 120%+ NRR, 70%+ gross margin, operator-class wedge (named agents under an autonomy slider), and a $1.5B–$2B multi-vertical TAM. The $20M seed closed on proof of execution. The $60M Series-A closes on validation of the multi-vertical thesis and founder sustainability." That thesis is alive and fundable. Ship these five moves and it's a tier-1 round.
