# Marisol Vega — CFO Audit, AcreOS

**Lens:** Incoming series-A CFO. What I'd want hardened before a diligence call with Tier-1 investors. Specifics over vibes.

---

## 1. Plan-structure verdict

**Today (`client/src/pages/pricing.tsx`):** Free / Starter $20 / Pro $49 / Scale $79. 14-day trial on paid tiers. "Contact us" mailto for enterprise (`support@acreos.io`). Annual = 20% off (Starter $192, Pro $470, Scale $758).

**What's right:**
- Free → paid → "scale" arc is legible.
- 20% annual discount is industry-standard (Stripe coupon mechanics already wired in `routes-billing.ts:307-322`).
- Add-on seats priced per tier ("$20/seat" Pro, "$40/seat" Scale).

**What's wrong — and this is the single biggest finding in the entire audit:**

There are **at minimum six different hardcoded tier-price tables across the codebase, and no two agree.** This is not a typo. I counted:

| File | starter | pro | scale | enterprise |
|---|---|---|---|---|
| `client/src/pages/pricing.tsx` (what customers see) | $20 | $49 | $79 | (mailto) |
| `server/storage.ts:3452` (org metrics MRR) | $49 | $99 | $199 | — |
| `server/routes-admin.ts:3293,3373,3685` (admin MRR) | $49 | $149 | $399 | $799 |
| `server/routes.ts:1443` (`/api/founder/executive-dashboard` — feeds /founder-home) | $29 | $79 | $199 | — |
| `server/agents/revenue.ts:14` (TIER_PRICES, in cents) | $20 | $49 | $399 | $799 |
| `server/services/expansionRadar.ts:55-65` (in cents) | $20 | $49 | $79 | $199 |
| `server/services/autonomousSalesPipeline.ts:309` (in cents) | $99 | (professional) $299 | — | $999 |

`expansionRadar.ts` even carries a comment that says "MUST match /pricing page values" right above prices that don't match the page. The MRR rendered on the **founder home page** (commit d255dfe) is computed off the `routes.ts:1443` table — which means the founder's primary forward-looking metric is wrong by **45% on Pro and 250% on Scale** vs the actual list price the customer is paying. ARR derived from that figure is fiction.

**Why it matters in diligence:** investors will recompute MRR from Stripe directly. The board deck number won't match. Worse, the *agents* (revenue, expansion-radar) trigger upgrade nudges and projections off these conflicting numbers, so the system is internally inconsistent, not just wrong on one screen.

**Recommended new tier shape:**
- Single source of truth: `shared/billing/tier-pricing.ts` exporting `TIER_PRICES_CENTS` consumed by every server file, the pricing page, the agents, and admin. Stripe price IDs cached and reconciled nightly against this table; build fails if Stripe disagrees.
- Add **Team** tier between Pro and Scale ($129) — Pro→Scale is a 1.6x jump with no intermediate; expansion radar will have nowhere to push 2-seat shops that outgrow Pro.
- **Self-serve Enterprise gate**: today it's a `mailto:`. For series-A, you want a real "Talk to sales" form that creates a HubSpot/Attio lead with org context + tier they were on. The mailto loses every prospect who doesn't have native mail configured (which on mobile Safari is most of them).
- **Usage-based add-on (credits) is good** — keep it, but it's currently severable from subscription. Decide: do credits net against MRR (deferred-revenue style) or are they a separate product line? Today they live in `creditTransactions` with no link back to subscription tier.
- Founder/beta comp accounts must have a flag — `is_founder` exists, but no `comp_reason`, no `comp_expires_at`, no MRR-shadow value. CFO can't answer "what would we be billing if comps were paid?" today.

---

## 2. Billing edge-case inventory

| Scenario | Current state | Risk |
|---|---|---|
| **Mid-cycle upgrade Pro→Scale** | `stripeService.createCheckoutSession` is the only path. No `subscriptionItems.update` with `proration_behavior` set. Customer Portal handles it client-side via Stripe defaults. | **Medium** — Stripe defaults to `create_prorations`, fine for now, but founder cannot override. No upgrade nudge UI captures the proration delta back to the customer; "you'll be charged $X today" copy doesn't exist. |
| **Mid-cycle downgrade Scale→Starter** | Same as above. No retention flow before downgrade. `cancellationSurveys` table exists; downgrade-survey doesn't. | **High** — silent revenue leakage. No friction = no retention save. |
| **Failed payment / dunning** | `services/dunning.ts` is solid: 4-stage (grace/warning/restricted/suspended/cancelled), email templates, retry schedule, auto-downgrade to free at suspended/cancelled, revenue-at-risk alerts ≥$100. | **Low** — best-built piece of the stack. Two gaps: (a) no SMS/push channel — email-only, and (b) no in-app banner; the customer learns by email. |
| **Refund flow** | `routes-billing.ts:783` — request → auto-refund under $50, manual review above. 30-day rate limit. Auto-cancels subscription on refund and downgrades to free. Good. | **Low-Medium** — auto-refund is generous (most SaaS holds at $25). No partial-refund flow. No refund reason taxonomy for the CFO month-end deck. |
| **3DS / SCA** | `payment_method_types: ['card']` only. No automatic_payment_methods, no off-session reauth. | **Medium** — EU/UK customers will fail 3DS challenges silently. Stripe's `automatic_payment_methods: { enabled: true }` should be flipped on; cost is one line. |
| **Tax (Stripe Tax / Avalara)** | **No `automatic_tax`, no `tax_id_collection`, no `tax_behavior` anywhere in `stripeService.ts`.** Prices are tax-inclusive by default in some jurisdictions, tax-exclusive in others — the platform doesn't say. | **High** — collecting in Texas, Washington, Tennessee without sales-tax handling is a notice-and-fine risk once paying customers cross thresholds. Canadian customers (GST/HST/PST) currently can't be served correctly. |
| **Coupons / promo codes** | `pricingConfig.stripeCouponId` + `allowPromoCodes` flag, time-bound via `promoEndsAt`. Couponed at checkout only. | **Medium** — no expiration enforcement on coupons applied to active subscriptions; no "coupon stacks with referral credit" matrix; no founder UI to revoke a promo mid-flight. |
| **Trial expiry** | `customer.subscription.trial_will_end` webhook handled. `trialUsed` set on checkout completion (good — prevents trial farming). | **Low**. |
| **Disputes / chargebacks** | Webhook handlers exist (`charge.dispute.created/updated/closed`). | **Low** — but no chargeback rate dashboard for the founder. |
| **Invoice memos / line-item attribution** | None. Subscription-only invoicing. Credit-pack purchases are separate `mode: 'payment'` checkouts. | **Medium** — when a customer asks "what's this $79 charge?" the answer requires a human. |

---

## 3. Unit-economics observability gap

**Measured today:**
- Total MRR (wrongly, as above)
- ARPU (`mrr / activeOrgs`)
- Tier-breakdown counts
- Credit purchases this month (`creditTransactionsThisMonth`)
- Dunning revenue at risk

**Not measured — and should be:**
1. **Gross margin per customer.** No COGS attribution table. Every paid AI call, every SMS, every Lob postcard, every premium data-provider lookup deducts from credits but never rolls into a per-customer cost-of-revenue figure. `simulatedActions` has the categories (`ai_paid | sms | email | webhook_outbound`) — production needs the same shape with real cost. Without it, "Pro at $49 with 1,000 AI requests/day" could be margin-negative and nobody knows.
2. **CAC and CAC payback.** No `acquisition_source`, no `acquisition_cost_cents` on organizations. The growth agent fires referral nudges but there's no LTV/CAC unit.
3. **LTV.** `autonomousSalesPipeline.ts:315` uses a hardcoded "18-month average LTV" assumption with the wrong tier prices. Real cohort retention exists in code but isn't wired into LTV.
4. **Net Revenue Retention.** Cohort retention endpoint exists (`routes-founder-intelligence.ts`), but expansion (upgrades + add-on credits) and contraction (downgrades) aren't decomposed. NRR is the single most important metric in series-A diligence and it's not on the dashboard.
5. **Burn multiple, runway, magic number** — fine as a stretch, but at minimum the operating-cost side of the ledger needs to exist. Today only revenue is tracked; expense data lives in nobody's database.

---

## 4. GAAP-compatible ARR readiness

**Verdict: NO, with significant work.**

Issues:
- **ARR is computed = MRR × 12** in the few places it appears, off the wrong tier table. GAAP ASC 606 requires ARR be derived from contractually-committed recurring revenue net of discounts, deferred over the service period.
- **Annual plans are not amortized.** A customer pays $192/year for Starter — today that's recognized at checkout (Stripe charge), but on the AcreOS side there's no deferred-revenue schedule, no monthly recognition. For a series-A audit, this is a base-case finding.
- **Credit packs**: pre-paid usage. GAAP says recognize as consumed, not at sale. `creditTransactions` tracks balance, but there's no liability-side ledger (`deferred_revenue` table) showing the unrecognized portion at month-end.
- **Discounts**: no separation between gross-list ARR and discounted/net ARR in any output. Both numbers are needed for the board.
- **Refunds**: contra-revenue. Today refunds reduce neither MRR snapshot nor ARR; they're just a Stripe refund + downgrade.
- **No `subscription_events` ledger.** When tier changes mid-month, the `organizations.subscription_tier` field overwrites in place. Yesterday's MRR cannot be reconstructed from the database alone — only from Stripe. That breaks audit reproducibility.

**To get to GAAP-compatible:** add (a) `subscription_history` immutable event log, (b) `deferred_revenue` table for annual plans + credit packs, (c) recognition-schedule worker that writes monthly recognized-revenue rows, (d) single tier-price source-of-truth.

---

## 5. Founder financial-visibility gap

What `/founder-home` has after d255dfe: MRR (wrong number), active orgs, NPS-90d, churn rate (backward), churn-risk bands (forward), action queue.

**What's missing:**
1. **Net Revenue Retention** — the question every investor asks first.
2. **Revenue concentration / top-N customers** — no view shows "customer X is 32% of MRR." The data is there (it's a `groupBy(subscriptionTier)` away), but the view doesn't exist. **This is a control failure: a founder should not be able to lose 30% of revenue overnight without an alert.**
3. **Cash vs accrual distinction.** Today the founder sees Stripe-cash-equivalent MRR. They cannot answer "what was recognized revenue in March?"
4. **Gross margin and contribution margin per tier.**
5. **Discount/comp leakage report.** "How much revenue did we forgo this month from beta credits, founder comps, and active coupons?"
6. **Credit-pack burn rate** — pre-paid balance outstanding (a liability) is not visualized.
7. **Tax-collected ledger** — required to remit; doesn't exist.
8. **Connected-account (Stripe Connect) revenue** — separate from subscription. Customers process payments through AcreOS-issued Stripe Connect accounts (`server/services/stripeConnect.ts`); the founder needs a take-rate / platform-fee dashboard. No view today.

A self-serve founder cannot close a month from this dashboard. They can see vibes, not numbers.

---

## 6. CFO close-the-month checklist

What blocks me on day 5 of next month:

| Check | Status today | Effort to unblock |
|---|---|---|
| Reconcile Stripe MRR ↔ database MRR | **BLOCKED** — six tier tables disagree | 2 days: consolidate to one table, regenerate views |
| Recognize annual-plan revenue ratably | **BLOCKED** — no deferred-revenue table | 4 days: schema + worker + backfill |
| Recognize credit-pack revenue on consumption | **BLOCKED** — same | 2 days: usage→recognition mapping |
| Reconcile coupon/discount giveaways | **PARTIAL** — `pricingConfig` exists, no aggregation report | 2 days: nightly rollup |
| Refund contra-revenue treatment | **BLOCKED** — refunds adjust orgs, not revenue ledger | 1 day |
| Sales tax remittance per state | **BLOCKED** — Stripe Tax not enabled | 1 day to flip flag, then 30 days of nexus monitoring |
| Customer concentration disclosure | **BLOCKED** — view doesn't exist | 1 day |
| Chargeback / dispute reserve | **PARTIAL** — webhook captured, no reserve calc | 2 days |
| Founder-comp shadow-MRR | **BLOCKED** — no comp metadata on orgs | 1 day schema + 1 day report |
| Audit trail for any subscription change | **PARTIAL** — `auditLog` exists, billing changes not consistently logged through it | 2 days to add audit hooks to all subscription mutations |

**Total: ~3 weeks of focused engineering to make this auditable.** Right now I would tell the audit committee "we cannot close the month from the system of record."

---

## 7. Pre-Series-A finance hardening sprint (2–3 weeks)

Ranked by ROI / risk reduction:

1. **Tier-price single source of truth** (1d). `shared/billing/tier-pricing.ts`. Delete the other six. Stripe price-ID reconciliation test in CI. Without this, every other metric is suspect.
2. **Subscription event ledger** (3d). Immutable `subscription_history` table. Every Stripe webhook that changes tier/status writes a row. MRR/ARR recomputed from this ledger as a view. Reproducible numbers.
3. **Stripe Tax enablement + tax_id_collection** (1d to enable, ongoing for nexus). `automatic_tax: { enabled: true }` on checkout sessions. Add `tax_id` capture in customer portal. Solves Canadian + multi-state.
4. **Deferred-revenue table + monthly recognition worker** (4d). Annual subscriptions and credit packs flow through. Outputs GAAP-compatible recognized-revenue rows.
5. **Customer-concentration alert** (1d). Alert when any single customer >15% of MRR; hard alert at >25%. Surfaces on /founder-home.
6. **NRR + expansion/contraction decomposition** (2d). Cohort logic exists; surface NRR, gross-revenue-retention, expansion MRR, contraction MRR on /founder-home.
7. **COGS-per-customer rollup** (3d). Wire `usage_records` → cost ledger → per-org gross-margin view. Pro-tier customers pulling 30k AI requests/month should appear as red.
8. **Comp / beta-credit ledger** (2d). `comp_reason`, `comp_expires_at`, shadow-MRR. Founder can answer "what would we be billing if all comps converted?"
9. **Self-serve enterprise lead capture** (1d). Replace mailto with a real form → CRM. Track enterprise pipeline.
10. **Mid-cycle upgrade UX with proration preview** (2d). Show "you'll be charged $X today" before the customer commits, capture the upgrade decision in the audit log.

If I had to pick three for week one: #1, #2, #3. Without those, every other number we report is built on sand.

---

## Bottom line

The plumbing — Stripe webhooks, dunning, refund flow, audit-log table, idempotency keys, circuit breakers — is **better than I expected** for the stage. Whoever built `services/dunning.ts` and `webhookHandlers.ts` has done this before.

The accounting layer — single source of pricing truth, deferred revenue, tax, comp tracking, NRR, customer concentration — is **at pre-seed maturity**, not series-A.

The bones aren't broken; they're inconsistent. Three weeks of focused work and AcreOS is diligence-ready. Skip those three weeks and the term sheet has a "MRR validation contingency" clause that costs the founder dilution.

— Marisol
