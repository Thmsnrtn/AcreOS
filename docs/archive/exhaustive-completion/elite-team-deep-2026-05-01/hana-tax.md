# Hana Bashir — Tax Compliance Audit

**Role:** International tax engineer (ex-Stripe Tax, ex-Avalara), 7 years.
**Wave:** 2 of 87-persona AcreOS audit.
**Reviewing:** `server/stripeService.ts`, `server/stripeClient.ts`, checkout + portal flows, expansion plan.
**Date:** 2026-05-01.

---

## 1. One-line verdict

**AcreOS is collecting subscription revenue in 18+ states that tax SaaS without registering, without tracking economic nexus, and without a single line of `automatic_tax` in `stripeService.ts` — which means every active US customer is a latent state assessment.**

You are not "behind on tax." You are accruing a liability per invoice. The good news: Stripe Tax solves 80% of this in roughly five lines of code. The bad news: the registrations and the back-tax exposure don't disappear when you turn it on.

---

## 2. Nexus map — where AcreOS likely has obligations today

### How nexus works post-Wayfair (2018)

Two tests, either one triggers obligation:

1. **Physical nexus** — employee, contractor, server, or office in-state.
2. **Economic nexus** — revenue or transaction count thresholds (Wayfair v. South Dakota, 2018). Most states landed at **$100K in sales OR 200 transactions** in a rolling 12 months. Some states are revenue-only, some have higher thresholds, a couple have lower.

### States that tax SaaS as of 2026

The "SaaS is taxable" list shifts constantly. As of May 2026, **SaaS is taxable in roughly 22 states** for B2B (more for B2C). Your high-risk states for an AcreOS Land Investor customer base:

| State | SaaS taxable? | Economic nexus threshold | Risk for AcreOS |
|---|---|---|---|
| **New York** | Yes (B2B + B2C) | $500K AND 100 txns | HIGH — dense investor population |
| **Texas** | Yes (80% of SaaS) | $500K | HIGH — huge land market |
| **Pennsylvania** | Yes | $100K | HIGH |
| **Washington** | Yes | $100K | HIGH |
| **Massachusetts** | Yes | $100K | MEDIUM |
| **Connecticut** | Yes (1% reduced rate) | $100K AND 200 txns | MEDIUM |
| **Tennessee** | Yes | $100K | MEDIUM |
| **Ohio** | Yes (B2B exemption) | $100K OR 200 txns | MEDIUM |
| **Arizona** | Yes | $100K | MEDIUM |
| **Utah** | Yes | $100K OR 200 txns | LOW (small population) |
| **Hawaii** | GET (not sales tax, but applies) | $100K OR 200 txns | LOW |
| **South Dakota** | Yes | $100K | LOW |
| **South Carolina** | Yes | $100K | MEDIUM |
| **Iowa** | Yes | $100K | LOW |
| **Rhode Island** | Yes | $100K OR 200 txns | LOW |
| **District of Columbia** | Yes | $100K OR 200 txns | LOW |
| **New Mexico** | GRT (vendor, not customer) | $100K | LOW |
| **West Virginia** | Yes | $100K OR 200 txns | LOW |
| **Mississippi** | Yes | $250K | LOW |
| **Vermont** | Yes | $100K OR 200 txns | LOW |
| **Maryland** | Yes (digital products law, 2021) | $100K OR 200 txns | MEDIUM |
| **Chicago** (city) | 9% Personal Property Lease Transaction Tax on SaaS | $100K | MEDIUM if any IL customer |

**Notably NOT taxable (for now):** California, Florida, Virginia, North Carolina, Georgia, Illinois state-level (but Chicago is a trap).

### What this means for AcreOS today

If AcreOS has **even one customer in any of the 22 states above**, you're on the hook for sales tax on those subscriptions from invoice 1 — economic nexus thresholds aren't a free pass, they're the point at which you must register and remit. Below threshold you may not need to register, but you still owe nothing because you have no obligation. The minute a state's threshold is crossed, every prior month becomes back-tax owed.

**The trap:** thresholds are measured on **gross revenue or transaction count**, including non-taxable customers. A $99/mo plan × 200 transactions = nexus in any 200-txn state, regardless of revenue. Annual plans help; monthly billing is hostile.

### Best estimate of current exposure

Without telemetry, assume AcreOS has crossed transaction-count thresholds in: **NY, TX, PA, WA, MA**, and possibly Chicago. That's 5 registrations + back-tax + penalties + interest accruing daily. Voluntary Disclosure Agreements (VDAs) typically waive penalties and cap lookback at 3-4 years if you self-report before they audit.

---

## 3. Stripe Tax enablement plan

### Why Stripe Tax (vs Avalara, TaxJar)

For a SaaS company at AcreOS's stage (sub-$10M ARR, US-primary, expansion-ambitious):
- **Stripe Tax** is the right call. Native to Checkout + Subscriptions, no integration tax, calculates at the line-item level, files in 50 US states + 50 countries.
- **Avalara** is enterprise-grade; overkill until $20M+ or you have non-Stripe revenue streams.
- **TaxJar** (now Stripe-owned) was the indie choice; subsumed.

### Pricing impact

Stripe Tax is **0.5% of every transaction it calculates tax on, capped at $0.50 per transaction in the US**, and free in test mode. For AcreOS's price points ($X9–$X99/mo range, presumably), that's a few cents per invoice — trivial compared to a $50K Texas assessment.

### Code changes — the five-line fix

**`server/stripeService.ts` — `createCheckoutSession`:**

```ts
const sessionConfig: any = {
  customer: customerId,
  payment_method_types: ['card'],
  line_items: [{ price: priceId, quantity: 1 }],
  mode: 'subscription',
  success_url: successUrl,
  cancel_url: cancelUrl,
  metadata,
  // ADD:
  automatic_tax: { enabled: true },
  tax_id_collection: { enabled: true },
  customer_update: { address: 'auto', name: 'auto' },
  invoice_creation: { enabled: true }, // for one-off / payment mode only
};
```

**`createCreditPurchaseCheckout` — same additions.** Plus on the `price_data.product_data`:

```ts
price_data: {
  currency: 'usd',
  product_data: {
    name: packName,
    description: 'Credit pack for usage-based features',
    tax_code: 'txcd_10000000', // SaaS — General — "software as a service"
  },
  unit_amount: priceCents,
  tax_behavior: 'exclusive', // tax added on top, NOT included
}
```

**Subscription products** need `tax_code` set on the Stripe Product (Dashboard → Product → Tax Code → `txcd_10103000` for SaaS). Do this once per product; don't hardcode.

### Gotchas

1. **`tax_behavior` is permanent on a Price.** Once a Price has `inclusive` or `exclusive` set, you cannot change it — you must create a new Price. Set it correctly the first time. **Use `exclusive` for US** (tax added on top, US norm) and **`inclusive` for EU/UK** (VAT-included, EU norm). This means **separate Price IDs per region** if you go international.
2. **Customer address required.** Stripe Tax needs a billing address to determine jurisdiction. `customer_update: { address: 'auto' }` lets Checkout collect + persist it. Existing customers without an address will fail — backfill via Customer Portal or a one-time outreach.
3. **`tax_id_collection`** lets B2B customers enter a VAT number / EIN. For EU B2B, a valid VAT number triggers reverse-charge (zero-rated) — this is mandatory for EU, optional but professional for US.
4. **Registration is on you.** Stripe Tax calculates and reports; it does not register you in states. Each state where you've crossed nexus needs a sales tax permit before you can legally collect.
5. **Filing.** Stripe Tax now offers managed filing in select states (~$X/state/month). For others, you export the report and file via a partner (TaxJar Reports, Avalara Returns) or a tax accountant.
6. **Founder/exempt org plans.** If the founder herself is on a $0 internal plan, exclude with a `tax_exempt: 'exempt'` on the Stripe Customer.

---

## 4. International readiness — Canada / EU / UK gaps

The expansion plan flags Canadian Land Investors. Here's what breaks the moment a Canadian customer signs up:

### Canada (GST/HST + provincial)

- **GST 5% federal, applies everywhere.**
- **HST 13–15%** in ON, NS, NB, NL, PEI (combined federal + provincial, single rate).
- **PST/QST separately** in BC (7%), SK (6%), MB (7%), QC (9.975%).
- **Threshold:** CAD $30K in worldwide taxable supplies in 12 months → must register for GST/HST. Per-province PST/QST has separate registration.
- **Stripe Tax handles all of these** — once registered, Stripe calculates the right combo per province.
- **Indigenous / First Nations exemptions** exist but require a status card; Stripe Tax doesn't auto-handle these — flag for manual review.

### EU VAT (if AcreOS expands)

- **OSS (One-Stop Shop)** is the play: register in one EU country, file one return covering all 27.
- **B2C:** VAT charged at customer's country rate (5–27%, country-by-country).
- **B2B:** reverse-charge — collect VAT ID, charge zero, customer self-accounts. Stripe Tax does this if `tax_id_collection` is on and the VAT ID validates against VIES.
- **Threshold:** €10K cross-border B2C → OSS registration required.
- **Invoices must be VAT-compliant:** seller VAT number, customer VAT number (B2B), tax breakdown by rate, invoice number, date. Stripe Invoices handle this once tax is enabled.

### UK VAT (post-Brexit)

- **20% standard rate.**
- **Threshold:** £85K UK taxable turnover → register. Below threshold, voluntary registration possible.
- **Digital services to UK consumers:** register from £1 (no threshold for non-UK suppliers selling digital services to UK).
- Separate from EU OSS — UK is its own filing.

### What's missing in AcreOS today

- No currency support beyond USD (`currency: 'usd'` hardcoded in `createCreditPurchaseCheckout`). Canadian customers will be charged USD with FX surprise. **Fix:** use Stripe's multi-currency Prices, set per-region.
- No address localization in checkout (postal code validation differs by country).
- No tax-compliant invoice template — current Stripe receipts aren't invoices in EU/UK B2B sense.

---

## 5. Tax invoices vs receipts — B2B documentation

A **receipt** is "you paid." A **tax invoice** is a legal document required by buyers in most non-US jurisdictions to claim input tax credit / deduct as an expense.

### What's required on a tax-compliant invoice (EU/UK/CA model)

1. The word "Invoice" or "Tax Invoice."
2. Sequential invoice number (no gaps).
3. Issue date.
4. Seller name, address, **tax registration number** (VAT / GST / HST).
5. Buyer name, address, **buyer tax ID** for B2B.
6. Description of goods/services.
7. Net amount, tax rate, tax amount, gross amount — broken down per rate if mixed.
8. Currency.
9. For reverse-charge: the phrase "Reverse charge — VAT to be accounted for by the recipient."

### How AcreOS gets this for free

Enable Stripe **Invoices** on every Subscription (already implicit, but verify `collection_method: 'charge_automatically'` produces an Invoice object — it does). With Stripe Tax on, invoices auto-include all required fields. Provide a customer-portal link in the post-purchase email for "Download Invoice (PDF)" — Stripe hosts this at `invoice.hosted_invoice_url`.

### B2B-specific gap

US-B2B customers buying through Procurement want a **W-9 from AcreOS** and a **proper invoice with PO field**. Add a `metadata.po_number` field to Checkout and surface it on invoice line items via `invoice.custom_fields`. Without this, AP departments at any company over ~50 employees will reject your invoice.

---

## 6. Exemption handling

### Tax-exempt customers (US)

- **501(c)(3) nonprofits, government entities, schools, resale buyers** can claim exemption if they provide a valid exemption certificate (state-specific form, e.g., NY ST-119.1, TX 01-339).
- Stripe Tax supports per-customer **`tax_exempt: 'exempt'`** or **`tax_exempt: 'reverse'`** (B2B reverse charge in EU). Set this manually after collecting and storing the certificate.
- **Storage requirement:** you must keep exemption certificates on file for 4 years (NY) to 7 years (varies). They are audit-defense documents, not optional.
- AcreOS has zero infrastructure for this today. Build a minimal admin UI: upload PDF, store in S3/Replit Object Storage, link to Stripe Customer ID, set `tax_exempt` flag. Ten engineering hours.

### Resale certificates

Less relevant for SaaS, but if a reseller (e.g., a Land Investor coaching program rebundles AcreOS seats) wants to buy at zero tax to resell to their students, they provide a resale certificate. Same workflow as 501(c)(3).

---

## 7. The 1-2 week tax compliance sprint

### Week 1 — stop the bleeding

**Day 1 (4 hours):**
- Pull a customer-by-state revenue report from Stripe (export `customers.list` + `subscriptions.list`, group by `customer.address.state`, sum 12-month revenue and transaction count).
- Identify which states AcreOS has crossed nexus thresholds in.

**Day 2-3 (engineering, ~12 hours):**
- Set `tax_code` on every Stripe Product in Dashboard.
- Create new Prices with `tax_behavior: 'exclusive'` (US) — keep old Prices grandfathered for existing subscribers, route new sign-ups to new Prices.
- Add `automatic_tax`, `tax_id_collection`, `customer_update.address` to both `createCheckoutSession` and `createCreditPurchaseCheckout`.
- Test in Stripe test mode with addresses in NY, TX, CA, WA — confirm tax line items appear correctly.
- Deploy behind a feature flag (`stripe_tax_enabled`) gated to new customers first.

**Day 4 (legal/finance, founder + accountant):**
- Engage a sales tax accountant (TaxValet, Anrok, or Avalara Professional Services — $3K–$8K engagement) to handle state registrations.
- Decide on Voluntary Disclosure Agreement strategy for back-tax states. VDA caps lookback at 3-4 years and waives penalties; without VDA, an audit can go back further with full penalties.
- Begin registration in the 5 highest-risk states (NY, TX, PA, WA, MA).

**Day 5 (ops):**
- Backfill missing customer addresses via email outreach + Customer Portal nudge ("Update your billing details for accurate invoicing").
- Add a Stripe Tax dashboard widget to founder dashboard surfacing monthly liability by state.

### Week 2 — make it durable

**Day 6-7:**
- Flip `stripe_tax_enabled` to all customers. Communicate proactively: "Starting [date], applicable state sales tax will appear on invoices for customers in [list]. Your monthly subscription price is unchanged."
- Build the exempt-customer admin UI (upload certificate, flip `tax_exempt`).
- Add `metadata.po_number` to Checkout for B2B.

**Day 8-10:**
- International prep: create CAD-denominated Prices for Canadian expansion. Stub `tax_behavior: 'inclusive'` on EUR/GBP Prices for future EU/UK launch.
- Add multi-currency support to `createCreditPurchaseCheckout` — currency parameter, not hardcoded `'usd'`.
- Document the tax compliance process in `docs/runbooks/tax-compliance.md`: who registers AcreOS in new states, when nexus reviews happen (quarterly), how to onboard a tax-exempt customer.

**Day 11-14 (filing setup):**
- Sign up for Stripe Tax managed filing in supported states.
- For unsupported states, set up monthly export → accountant pipeline.
- Calendar the filing deadlines per state (most are 20th of month following).

### What this sprint does NOT solve

- **Back-tax owed.** Whatever's been collected without remitting since nexus was crossed — that's a separate workstream with the accountant. Budget 30-90 days and $10K–$50K all-in (back tax + accountant fees + state registration fees), depending on AcreOS's size.
- **1099-K** — Stripe issues a 1099-K to AcreOS for total processed volume. This is income reporting, not sales tax, and goes on AcreOS's federal return. Confirm with founder's CPA that QBO is reconciling Stripe payouts cleanly. **AcreOS does not issue 1099-Ks to customers** — they're paying us, not receiving payments through us.
- **Use tax** — separate from sales tax, applies to AcreOS's own purchases (software subscriptions, hardware) used in states without sales tax. Accountant problem, not engineering.

---

## Bottom line

The fix is small. The exposure is large. Every month without `automatic_tax: { enabled: true }` is a month of accruing penalties in 22 states. Ship the five-line code change this week, start state registrations in parallel, and engage a sales tax accountant before the end of next week. The Canadian expansion plan in particular cannot ship without this in place — Canada's CRA is faster and meaner than any US state, and a single $30K CAD threshold breach without GST registration is a legal mess.

— Hana
