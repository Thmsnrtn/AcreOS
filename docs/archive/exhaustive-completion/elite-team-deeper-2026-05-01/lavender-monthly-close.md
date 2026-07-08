# Lavender Fox — Monthly Close, AcreOS

**Lens:** 44, ex-Mercury controller (4 years), before that senior accountant at a mid-tier SaaS that went through Big-4 audit twice. AcreOS retains me to close the books each month. I do not design pricing, I do not architect schemas — Marisol and Hassiba did that. My job: WD-1 through WD-10, journal entries cut, reconciliations signed, package to the audit committee. This memo is what I need on my desk to close, and what AcreOS gives me today vs the gap.

This is the operational layer beneath Hassiba's ledger spec and Marisol's diligence findings. If their two weeks ship, my close goes from "impossible" to "5 working days." Until they ship, every month I close is a forensic exercise.

---

## 1. The close calendar — what a controller needs by which day

| Day | Activity | Source system | AcreOS today |
|---|---|---|---|
| WD-1 | Cut-off freeze. All Stripe webhooks landed. No more invoices written to the prior month. | Stripe + `webhook_events` | Webhooks land but no cut-off flag |
| WD-1 | Bank rec start: Mercury / SVB statements pulled | Bank | Out of scope of platform |
| WD-2 | Subscription billings rec'd: Stripe MRR ↔ DB MRR | `mrr_snapshots` | **Does not exist** — six tier tables disagree |
| WD-2 | Deferred revenue waterfall closed for the month | `deferred_revenue` + `revenue_recognition` | **Does not exist** |
| WD-3 | Credit-pack consumption posted; breakage on expired packs | `credit_transactions` + `deferred_revenue` | Balance tracked, no liability ledger |
| WD-3 | Refund / contra-revenue posted | `revenue_recognition` reversals | Refunds adjust org tier only |
| WD-4 | COGS accrual: AI calls (Anthropic/OpenAI), data providers, Twilio, Lob, Mapbox | Provider invoices + `usage_records` | **Not categorized; no per-customer attribution** |
| WD-4 | Accrued payroll / PTO / 401k match | HRIS | Out of scope |
| WD-5 | Sales tax accrual by state/jurisdiction | Stripe Tax | **Stripe Tax not enabled** |
| WD-5 | Comp / beta shadow-MRR memo | `subscription_events` with comp flag | **No comp metadata** |
| WD-6 | Flux analysis (MoM variance >10% explained) | TB | Manual |
| WD-7 | Customer concentration disclosure | `v_revenue_concentration` | **View doesn't exist** |
| WD-7 | NRR / GRR / expansion / contraction decomposition | `mrr_snapshots` | **Not computed** |
| WD-8 | Management package drafted | All of the above | Cannot draft without #2-#7 |
| WD-9 | Founder review + sign-off | — | — |
| WD-10 | Books locked, GL period closed, audit folder filed | NetSuite/QBO | No GL — Stripe is the GL today |

**Verdict:** I cannot close from AcreOS's system of record today. WD-2 through WD-7 are blocked. I would close in spreadsheets pulling Stripe directly, mark every figure "preliminary," and tell the founder "this is cash-basis with manual accruals." That is fine for a 5-person company. It is **not** fine on the day a series-A term sheet shows up.

---

## 2. What AcreOS produces vs what I need

| What I need | What AcreOS produces |
|---|---|
| Frozen MRR as of last day of month | Live MRR computed off conflicting tier tables (Marisol §1) |
| Deferred revenue beginning balance, additions, recognition, ending balance | Nothing. Every annual sale recognized at cash. |
| Credit-pack liability balance at month-end | `creditTransactions` shows balance; not booked as liability |
| Refunds aged by original-period recognition | Refund record + downgrade event, no contra-revenue row |
| GL by account: revenue (subscription / usage / one-time), discounts, COGS (AI / data / comms / payments), customer credits applied | None — no chart of accounts exists |
| Top-5 customer concentration | Computable but not surfaced |
| Tax collected by state | Not collected at all |
| Comp shadow-MRR | No flag, no field |
| Audit log of every subscription mutation | `auditLog` exists, billing changes inconsistently logged (Marisol §6) |
| Per-customer gross margin | No COGS attribution |
| Recognized revenue by month, replayable from ledger | Not reproducible — `subscription_tier` mutates in place |

The pattern: AcreOS captures **events** (Stripe webhooks, usage, credit transactions). It does not roll those events into **ledgers** (deferred revenue, contra-revenue, COGS by category). I close ledgers, not event streams. The translation from event to ledger is the gap.

---

## 3. The journal entries I cut every month — what they require

| # | Entry | Cr/Dr pattern | Required data | Today |
|---|---|---|---|---|
| 3.1 | Subscription recognition | Dr Deferred rev / Cr Subscription rev | `revenue_recognition` rows | Blocked — no DR table |
| 3.2 | Annual sale (deferral) | Dr Cash / Cr Deferred rev | `deferred_revenue` on `invoice.paid` annual | Blocked |
| 3.3 | Credit-pack sale + consumption + breakage | Dr Cash / Cr Customer deposits → Dr Customer deposits / Cr Usage rev (or Breakage rev at expiry) | Per-credit recognition rate + consumption tracker | Consumption tracked; liability/recognition layer absent |
| 3.4 | Refund (contra-revenue) | Dr Subscription rev (contra) / Cr Cash | Negative `revenue_recognition` row | Blocked — refunds only flip org tier |
| 3.5 | Customer credits applied (referral, goodwill) | Dr Sales discounts / Cr Customer credits payable | `credit_grants` table | Blocked — risk of booking as marketing expense (ASC 606-10-32-25 trap) |
| 3.6 | COGS accrual | Dr Cost of revenue (AI / Data / Comms / Payments) / Cr Accrued vendor payable | Internal usage × unit cost, by category | Categories exist; cost-of-revenue rollup absent |
| 3.7 | Sales tax payable | Dr Cash / Cr Subscription rev + Cr Sales tax payable | Stripe Tax jurisdictional split | Stripe Tax not enabled (Marisol §2); nexus accruing in TX/WA/TN/CA |
| 3.8 | Comp shadow-MRR (footnote, not JE) | — | `comp_reason` + `comp_expires_at` flags | Blocked — no comp metadata |

---

## 4. Accruals I have to book — and where the data lives

| Accrual | Frequency | Data source needed | Status |
|---|---|---|---|
| Stripe processing fees (2.9% + $0.30) | Monthly | Stripe `balance_transactions` | Available via Stripe API; no AcreOS table |
| Anthropic / OpenAI usage | Monthly | API portal + internal `usage_records` | **No production cost rollup** |
| Data provider lookups (skip-trace, AVM, owner data) | Monthly | `provider_cache` + provider invoices | Categories exist; cost not attached |
| Twilio (SMS) | Monthly | Twilio invoice + send logs | No internal cost ledger |
| Lob (postcards) | Monthly | Lob invoice + send logs | No internal cost ledger |
| Mapbox / Geo | Monthly | Mapbox usage | Not tracked |
| Stripe Connect take-rate (platform fee revenue) | Monthly | Connect application fees | `stripeConnect.ts` exists; no take-rate dashboard (Marisol §5) |
| Refund reserve (estimated future refunds on current-period revenue) | Monthly | Historical refund rate | Not computed |
| Chargeback reserve | Monthly | Historical dispute rate | Webhook data captured; no reserve calc |
| Annual subscription deferred-revenue rollforward | Monthly | `deferred_revenue` table | **Does not exist** |
| Credit-pack liability rollforward | Monthly | `deferred_revenue` for credit packs | **Does not exist** |

The accruals I can produce today are limited to: cash-basis Stripe revenue, Stripe processing fees (from balance_transactions), and rough estimates of vendor COGS pulled from each vendor portal manually. **No customer-level attribution for any of it.**

---

## 5. COGS / cost of revenue — the categorization I need

A series-A SaaS income statement has these COGS lines at minimum:

1. **Hosting & infrastructure** (Fly.io, Cloudflare, database)
2. **Payment processing** (Stripe fees, Plaid if used)
3. **AI / model inference** (Anthropic, OpenAI) — variable per request
4. **Data providers** (skip-trace, AVM, owner-data, parcel data) — variable per lookup
5. **Communications** (Twilio SMS, SendGrid email, Lob mail)
6. **Customer success allocation** — typically a portion of CS salaries
7. **Third-party software embedded in the product** (Mapbox, etc.)

**What AcreOS has:** the *categories* live in `simulatedActions` and the provider registry (`server/services/providers/`). The schema knows that an action is `ai_paid` vs `data_provider` vs `sms`. It does not know the **dollar cost** of that action. So gross margin per customer is uncomputable and gross margin in aggregate is a vendor-portal-scraping exercise I do by hand.

**The fix Marisol called #7 in her sprint** (COGS-per-customer rollup, 3 days) is the unlock here. I need:
- A `cost_of_revenue_unit_costs` table: `{category, provider, unit, unit_cost_cents}`. Updated quarterly from vendor pricing.
- Every production action that calls a paid provider writes a `usage_record` with `org_id`, `category`, `provider`, `units`, `cost_cents` (= units × unit_cost).
- Monthly rollup view: `v_cogs_by_org_by_month` and `v_gross_margin_by_org_by_month`.
- Reconciliation: monthly vendor invoice ÷ rollup ≤ ±5% variance, else investigate.

Without this, I close on cash-basis COGS and the founder cannot answer "is Pro at $49 profitable?" The risk: a power user on Pro pulling 50k AI requests/month is margin-negative and nobody notices until cash burns faster than projected.

---

## 6. Revenue recognition timing — the four traps I watch for

### 6.1 Annual plans — **front-loaded today**
Customer pays $1188 on day 1 for Pro annual. Stripe records cash. AcreOS treats it as revenue. **GAAP says recognize $99/month for 12 months.** The MoM growth chart on the founder dashboard treats day-1 cash as new MRR, which inflates the month of sale and creates artificial dropoff in months 2-12. Fix: Hassiba's `deferred_revenue` table. Until then I manually amortize for the close package and footnote it.

### 6.2 Mid-cycle upgrades — **the proration trap**
Customer on Pro upgrades to Scale on day 15. Stripe prorates: refunds 15 days of Pro, charges 15 days of Scale. In AcreOS, `subscription_tier` flips in place. Yesterday's MRR is unrecoverable from the DB. For the close, I need to know **how many days of the month** were at each tier. Without `subscription_events`, I reconstruct from Stripe events one customer at a time. **Hours of manual work for a 200-customer book; impossible at 2,000.**

### 6.3 Trial-to-paid conversion timing
Trial converts on day 14. First charge hits day 14. AcreOS recognizes from day 14 forward. **That is correct** — but only because Stripe's trial mechanics carry the cut-off date. The platform itself does not enforce it. If anyone changes the `trialEndsAt` field manually (admin override), recognition timing breaks silently. Need: trial-end as a `subscription_event` row, immutable.

### 6.4 Credit-pack consumption — **breakage policy**
$100 buys 1000 credits. Customer uses 700. Credits expire after 12 months. **GAAP (ASC 606-10-55-46): recognize breakage in proportion to the redemption pattern if estimable; otherwise at the moment of expiry.** AcreOS has zero history → recognize at expiry only. Once 12 months of redemption data exists, switch to proportional and disclose the change in estimate. **I need this written into `/docs/accounting-policies.md` before the first credit pack expires** — otherwise auditors will ask why we deferred recognition with no policy.

---

## 7. Expense categorization — minimum chart of accounts

Today AcreOS has no GL. Stripe is treated as the GL by default, which is fine for cash-basis but not for an income statement. Minimum CoA for series-A:

```
4000  Subscription revenue (recurring)
4010    — discounts (contra)
4020    — referral credits applied (contra)
4030    — refunds (contra)
4100  Usage revenue (credit-pack consumed)
4110    — breakage revenue
4200  Connect platform-fee revenue
4900  Other revenue

5000  Cost of revenue
5010    — Hosting & infrastructure
5020    — Payment processing fees
5030    — AI / model inference
5040    — Data providers
5050    — Communications (SMS / email / mail)
5060    — Embedded third-party software
5070    — Customer success allocation

6000  Sales & marketing
6100  R&D / engineering
6200  G&A
6300  Bad debt / chargeback expense
```

This lives in QuickBooks or NetSuite, not in the AcreOS database — but the *AcreOS-side journal export* must map cleanly to these lines. Today no export exists. I would build a flat CSV from `revenue_recognition` (once it exists) with `gl_account` derived from `category`, ready for upload to QBO. Two days of work after Hassiba's tables ship.

---

## 8. Audit prep — what the auditor will ask, and whether I can answer

| Auditor question | Can I answer today? | After Hassiba's sprint? |
|---|---|---|
| What was MRR on March 14, 2026? | **No** (org tier mutates in place) | Yes (one SQL query off `subscription_events`) |
| Show me the deferred-revenue waterfall for Q1. | **No** (no DR table) | Yes |
| Any customer over 10% of revenue? | **No view** (manually computable) | Yes |
| How are referral credits accounted for? | "Currently no formal policy" | "Contra-revenue per ASC 606-10-32-25, see policy doc" |
| Refund treatment? | "Stripe refund + org downgrade" — **insufficient** | "Negative `revenue_recognition` row in current period" |
| Breakage policy on prepaid credits? | None | Documented |
| Sales tax nexus monitoring? | **None** | Deferred (separate sprint) |
| Stripe MRR ↔ DB MRR reconciliation? | Manual | Nightly automated job |
| All subscription mutations have an audit trail? | Partial | Yes (`subscription_events` is the audit trail) |

I would not pass an audit-readiness review today. After Hassiba's two weeks, I pass at a B+. After Marisol's three weeks (including tax + COGS + concentration alerts), A-. SOC 2 and FX layer the term after.

---

## 9. Reconciliations I run every close

1. **Stripe gross volume → DB recognized + deferred** — must tie to the penny. Today: cannot run. After fix: nightly job, alert >$50 variance.
2. **Bank deposits → Stripe payouts** — operational, not platform-side.
3. **Credit-pack liability rollforward** — beginning balance + sold − consumed − breakage = ending balance. Today: cannot run.
4. **Subscription-tier population → MRR view** — counts at each tier × price = MRR. Today: six tier tables disagree, so this rec produces six different answers.
5. **Refunds issued → contra-revenue posted** — Stripe refund total = sum of negative `revenue_recognition` rows for the period. Today: not posted, so the rec is "manual list of refunds Stripe issued, no GL impact captured."
6. **Vendor invoices → COGS rollup** — Anthropic invoice ÷ AcreOS-side AI usage × unit cost ≤ ±5%. Today: no AcreOS-side number.
7. **Comp accounts → shadow-MRR memo** — count of comp orgs × tier price = shadow figure. Today: no comp flag.

Of seven reconciliations, **five are blocked** by missing tables. Two are operational and not platform-dependent.

---

## 10. The week-one ask, from the controller's chair

If Hassiba and Marisol are right that two engineers for two weeks unlocks all of this, I have a narrower ask for **week one** to make the *next* close survivable, even if the full sprint slips:

1. **`shared/billing/tier-pricing.ts` single source of truth.** Without this every number I produce is provisional. Marisol's #1; Hassiba's day-1. Cheap; non-negotiable.
2. **`subscription_events` table with backfill.** I do not need the views or the worker yet. Just the immutable ledger so when an auditor asks "what was MRR on March 14" in three months, the data exists to answer even if the query layer doesn't yet.
3. **A monthly `mrr_snapshots` row, even if hand-computed.** One row per month-end with list / booked / recognized / new / expansion / contraction / churn. Even a manual fill-in beats nothing — preserves the time series so when the proper job runs, history is intact.

That is three days of work and gives me a defensible close package at month-end with footnotes documenting the in-progress remediation. The rest of the sprint can land over the following nine days without a controller-level emergency.

---

## Bottom line

Marisol identified the diligence gaps. Hassiba spec'd the schemas. I'm the controller who has to actually close on the 5th of next month, and from where I sit:

- **AcreOS produces:** event streams (Stripe webhooks, usage records, credit transactions, audit log fragments) at a quality better than most pre-seed companies.
- **A controller needs:** ledgers (deferred revenue, contra-revenue, COGS by category, customer credits, comp shadow, sales tax). These do not exist.
- **The translation gap is the entire close blocker.** Once events flow into ledgers (Hassiba's two weeks), the close goes from forensic spreadsheet exercise to a one-page management package the founder reviews on WD-7.

I can close month-end on the current platform. It will take me 80 hours and 40% of the numbers will carry "preliminary, manual estimate" footnotes. After the sprint: 12 hours, all numbers tie, audit folder files itself.

Pay the two engineers. The math is obvious.

— Lavender
