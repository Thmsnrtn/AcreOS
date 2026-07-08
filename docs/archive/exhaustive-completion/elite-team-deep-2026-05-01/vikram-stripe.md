# Vikram Rao — Stripe Integration Audit, AcreOS

**Lens:** Six years on Stripe Billing engineer-relations. AcreOS is closer
to "good integration" than I expected, but footguns will hurt the moment a
non-USD customer signs up, a UK card hits 3DS, or Texas notices the missing
sales tax.

Read `marisol-cfo.md` (six-tier-table fiasco — confirmed) and
`ines-reliability.md` (client mutation retry without idempotency-key —
confirmed). Marisol owns *accounting*, Ines owns *delivery*, I own the
*Stripe-API-shape* layer in between.

Files walked: `server/stripeService.ts`, `webhookHandlers.ts`,
`routes-billing.ts`, `services/dunning.ts`, `services/stripeConnect.ts`,
`seed-products.ts`, `shared/schema.ts` (subscription/dunning/pricingConfig),
`ai/supportAgent.ts`.

---

## 1. One-line verdict

**Stripe integration maturity: 2.5 / 5.** Plumbing is competent (atomic
webhook claim, deterministic idempotency keys, dunning with auto-downgrade,
refund flow with rate-limit). But it's a US-card-only single-currency setup
with no Stripe Tax, no proration UX, and only Starter/Pro seeded as Stripe
products while the rest of the app pretends Scale and Enterprise exist. It
will start shedding revenue the moment any of those four assumptions breaks.

---

## 2. Subscription lifecycle audit — transition coverage

### What's wired (`webhookHandlers.ts:78-154`)

| Stripe event | Status |
|---|---|
| `checkout.session.completed` (mode=subscription) | OK — eagerly sets `stripeSubscriptionId`, marks `trialUsed`, sends welcome email |
| `customer.subscription.{created,updated}` | OK — maps status, derives tier from `price.product.metadata.tier` |
| `customer.subscription.deleted` | OK — downgrades to free, logs event, emails owner |
| `customer.subscription.{paused,resumed}` | OK |
| `customer.subscription.trial_will_end` | OK — system alert, no email yet |
| `invoice.payment_failed` → dunning | OK |
| `invoice.payment_succeeded` / `invoice.paid` → dunning resolve | OK (two paths to same outcome) |
| `charge.dispute.{created,updated,closed}` | Founder alert only — **no evidence packet, no response flow** |

### What's missing

1. **`invoice.upcoming`** (7 days pre-renewal) — canonical hook for
   "card expiring," "renews on the 14th," "coupon ends this invoice."
   Not subscribed; coupon expiry is silent.
2. **`payment_method.{attached,detached,updated}`** — when Stripe Network
   Updater silently rotates an expired card, AcreOS has no surface
   saying "we updated your card." Customer assumes decline.
3. **`customer.updated`** — billing email changed in the Stripe portal
   isn't synced back. Stale `users.email`.
4. **`charge.refunded`** — handled via the in-app refund flow, but **a
   refund issued from the Stripe Dashboard out-of-band will not trigger
   downgrade**. Real hole.
5. **`customer.tax_id.*`** — required when Stripe Tax flips on.
6. **No `resurrected` lifecycle.** A previously-cancelled org
   re-subscribing takes the same code path as net-new. `trialUsed`
   never reset, no "welcome back" email, no `resurrection_count`. NRR
   cohorts (Marisol §3) cannot distinguish resurrection from net-new.

### State-machine concerns

`subscription_events` (`shared/schema.ts:5500`) only logs `change`,
`cancel`, `pause`, `resume`. No `trial_start` / `trial_convert` even
though the schema comment lists them. "Of the customers who started a
trial in March, how many converted?" — unanswerable from the DB.

After dunning resolution, tier is never re-checked against Stripe; if
the user upgraded during dunning, the locally-cached tier drifts.

---

## 3. Proration + tax correctness

### Proration

**AcreOS does not do proration in code.** Plan changes go via the
Stripe Customer Portal (Stripe defaults to
`proration_behavior: 'create_prorations'` — math correct, AcreOS has
zero visibility into the delta, no "$X today" preview) or a fresh
Checkout Session (free → paid, no proration needed).

Missing standard B2B pattern: call `stripe.invoices.upcoming` to
preview proration, then `stripe.subscriptions.update` to commit. Gives
you (a) "$7.42 today, $49/mo on the 14th" preview, (b) the audit-log
row Marisol §2 wants, (c) `proration_behavior: 'none'` for downgrades
effective at next renewal — CFO-friendly default.

**Verdict: math right (Stripe does it). Invisible to customer and audit
log. First support ticket about an unexpected mid-cycle charge will
validate this. Medium risk.**

### Tax — nonexistent

Confirmed via grep: zero references to `automatic_tax`, `tax_behavior`,
`tax_id_collection`, or `tax_rates` in `stripeService.ts`,
`stripeConnect.ts`, or `routes-billing.ts`. Both checkout sessions hardcode
`currency: 'usd'`. Credit-pack uses ad-hoc `price_data` with no
`tax_behavior`.

Practical exposure:
- **US sales-tax nexus**: collecting from TX, FL, WA, etc. without
  registering. Crossing the economic-nexus threshold (~$100k or 200
  txns) without remitting is a compliance event with penalty interest.
- **Canada GST/HST/PST**: any Canadian customer pays USD with no tax
  line. CRA might notice; customer won't.
- **EU/UK VAT**: same problem, far higher penalty exposure if AcreOS
  ever takes a UK customer.

**Fix (~1 day code, ongoing tax-registration work):**

```ts
sessionConfig.automatic_tax = { enabled: true };
sessionConfig.tax_id_collection = { enabled: true };
sessionConfig.customer_update = { name: 'auto', address: 'auto' };
// And set tax_behavior: 'exclusive' on credit-pack price_data
```

Then enable Stripe Tax in the dashboard, register where you cross
thresholds. **This is the highest-leverage one-line change in the
integration.**

---

## 4. Payment-method coverage — card / ACH / others

| Method | Subscription | Credit pack | Connect (note payments) |
|---|---|---|---|
| Card | yes | yes | yes |
| ACH (`us_bank_account`) | **no** | **no** | **yes** (stripeConnect.ts:286) |
| Apple Pay / Google Pay / Link | **no** | **no** | inferred via PaymentElement |
| SEPA / Bacs / iDEAL / Klarna / Cash App | **no** | **no** | **no** |

The contradiction is striking: Stripe Connect (borrower → land-investor
flow) offers `["card", "us_bank_account"]`. Subscriptions (your $49/mo
Pro customer) get `['card']` only. So a borrower paying $1,500/mo on a
land contract uses ACH (0.8% capped vs 2.9%+30¢ on card), but your own
subscriber cannot.

**Recommended:**

1. **Replace `payment_method_types: ['card']` with
   `automatic_payment_methods: { enabled: true }`** on both checkout
   creators. Adds Apple Pay, Google Pay, Link automatically; adds
   3DS/SCA handling automatically (currently EU/UK cards fail SCA
   silently — Marisol §2); lets Stripe pick optimal method per locale.
2. **Add `us_bank_account`** to subscription path. ACH is ~$16/yr/
   customer cheaper at $49/mo Pro (card ~$1.72/mo in fees vs ACH
   ~$0.39/mo).
3. **For Connect**: 2.5% application fee is flat across ACH/card.
   ACH is a margin win for the platform — fine, but make it explicit on
   the take-rate dashboard so Marisol's CFO close can attribute it.

---

## 5. Invoice + receipt quality

**Native invoice generation: none.** No `stripe.invoices.create` or
`stripe.invoiceItems.create` anywhere relevant (the
`supportAgent.ts:3550-3752` references are read/pay/void of existing
invoices, not create). All invoices are Stripe-default — plain HTML +
PDF, no AcreOS branding.

Missing for B2B-SaaS at series-A:

1. **Custom invoice branding** (Dashboard → Settings → Branding). No
   code, founder afternoon.
2. **Statement descriptors** — `STRIPE *ACREOS` on the customer's card
   statement. Set on account (`statement_descriptor`) and per-sub
   (`statement_descriptor_suffix`). Unrecognized descriptors are a
   top-3 chargeback driver.
3. **Line-item attribution** (Marisol §2): credit-pack line currently
   "Credit pack for usage-based features" (stripeService.ts:81). Should
   read "AcreOS — 50,000 credits — $25.00 — Order #cs_…".
4. **Receipt emails** — Stripe sends by default if `customer_email`
   set. Confirm dashboard; the in-app "Welcome to AcreOS Pro!" + Stripe
   receipt landing the same minute looks unfocused.
5. **PDF retention** — GAAP needs 7 years. Stash
   `invoice.invoice_pdf` URL on `invoice.finalized` for local
   reproducibility.
6. **`hosted_invoice_url`** — surface in `/settings` so customers can
   re-download without opening the portal.

**Verdict: "Stripe default" — acceptable at <$50k MRR, embarrassing at
$500k+.**

---

## 6. Failed-payment recovery — dunning vs Smart Retries

`services/dunning.ts` is the part of the integration I most enjoyed
reading. The author understands Stripe billing semantics.

### What dunning does

Retry attempts at days 3/5/7/14. Stages: `grace_period (≤3d) → warning
(≤7d) → restricted (≤14d) → suspended (≤21d) → cancelled (>21d)`.
Email cadence: payment_failed (d0), reminder (d2), warning (d6),
final_notice (d13). Auto-downgrade to free at suspended/cancelled.
Revenue-at-risk alert ≥ $100. Resolution clears stage, resolves alerts,
sends recovery_success email.

### Collision with Stripe Smart Retries

**Smart Retries are on by default** (Dashboard → Billing → Retry rules).
ML-based timing, ~4 attempts over 3 weeks, adapted to issuer windows.

**The two retry systems run independently.** Stripe retries the charge;
dunning increments its own 3/5/7/14 calendar.
`invoice.attempt_count` (read at `webhookHandlers.ts:259`) is Stripe's
counter, not yours. Dunning's "next retry at day 3" *isn't* the next
retry — Stripe decides. Dunning is doing email cadence + stage
management; the actual charge retries are Stripe's.

Issues:

1. **`nextRetryAt` (dunning.ts:164) is informational only.** The
   `retryPayment` API at line 521 calls `stripe.invoices.pay` — manual
   admin-triggered, not scheduled. Misleading field name; rename to
   `notificationDueAt`.
2. **`finalCancellationDays: 21`** vs Stripe-side cancellation policy.
   If the two timeouts disagree you get `canceled` on AcreOS but
   `past_due` on Stripe. **Verify Dashboard policy aligns.**
3. **Keep Smart Retries, treat dunning as email-only.** Stripe's ML
   beats hand-coded calendars. Rename `retryScheduleDays` →
   `notificationOffsetDays`.
4. **Email-only** (Marisol §2): no SMS, no in-app banner. Dismissible
   banner on `org.dunningStage !== 'none'` is one afternoon's work and
   recovers measurable involuntary churn.
5. **Send timing.** Fixed offsets ignore time zone. Optimal recovery-
   email time is 9–11am customer-local. Use `customer.address.country`
   + tz library.

**Verdict: solid B+ system. Two-week sprint to A-:** in-app banner,
document dual-retry architecture, instrument recovery rate per stage.

---

## 7. Coupon + credit ledger — GAAP-readiness

### Coupons / promo codes

Schema: `pricing_config` (`shared/schema.ts:11357`) — `stripeCouponId`,
`allowPromoCodes`, `promoEndsAt`. Applied at checkout only
(`routes-billing.ts:307-322`).

- **No subscription-side revocation.** To remove a coupon mid-flight
  you'd need `stripe.subscriptions.update({ coupon: '' })` — no AcreOS
  code calls it.
- **No expiration enforcement on existing subs.** A `forever` coupon
  applied at checkout keeps applying until cancel. `promoEndsAt` is
  honored only for new checkouts after that date. Stripe-correct,
  founder-expectation-wrong.

### Referral credits / credit packs

Stored in `creditTransactions`. **Linkage to subscription: none.** Pack
is a separate `mode: 'payment'` checkout — resulting charge isn't
attached to subscription invoice. **GAAP attribution: zero** (Marisol
§4 deferred-revenue). Stripe-side fix: route through `invoiceItems`
attached to the subscription, so they appear on next renewal invoice.
Trade-off: bills at renewal, not immediately. For prepaid usage,
"pay now" is probably right; just don't expect GAAP out of it without
a separate ledger.

### Founder comp accounts

No flag; `is_founder` exists but doesn't short-circuit billing.
Stripe-side answer: a `100% off forever` coupon applied to a real
subscription. Gives you the artifact (shadow MRR visible in
`subscription_events`) without billing them.

---

## 8. The 2-week Stripe hardening sprint

Ranked by risk-reduction × leverage. Dovetails with Marisol/Ines, no
overlap.

### Week 1 — close silent-revenue-leak holes

1. **Enable `automatic_tax: { enabled: true }` and `tax_id_collection`
   on every checkout session.** *(½ day code; ongoing tax registration
   owned by Marisol.)* Highest-leverage line in the integration.
2. **Replace `payment_method_types: ['card']` with
   `automatic_payment_methods: { enabled: true }`** on subscription and
   credit-pack. Adds Apple Pay/Google Pay/Link/SCA. *(½ day)*
3. **Add `us_bank_account` to subscription checkout.** ~$16/yr/customer
   savings on Pro. Stripe adds the mandate flow automatically. *(½ day)*
4. **Subscribe to `invoice.upcoming`, `payment_method.*`,
   `customer.updated`, `charge.refunded`.** `charge.refunded` closes the
   out-of-band-refund loophole. *(1 day)*
5. **Wire client-side `Idempotency-Key` UUIDs through to Stripe.**
   Ines's P0 #1.2; on the Stripe side, also pass the same UUID as the
   `idempotencyKey` on `stripe.checkout.sessions.create` so duplicate
   clicks dedupe at the *Stripe* level too. *(½ day, joint with Ines)*

### Week 2 — proration UX, branding, lifecycle gaps

6. **Mid-cycle upgrade preview UI.** New `/api/stripe/proration-preview`
   calls `stripe.invoices.upcoming`. Pricing page upgrade button shows
   "You'll be charged $X today, then $Y/mo on the Zth" before confirm.
   Capture upgrade via `subscriptions.update`, not new checkout.
   *(2 days, depends on Marisol §1 single-source-of-pricing.)*
7. **Stripe Tax + branding setup in the Dashboard.** Logo, accent color,
   statement descriptor, support email, footer. No code, one founder
   afternoon.
8. **Resurrection lifecycle.** Distinct
   `subscription_events.eventType = 'resurrect'`, "welcome back" email,
   `resurrection_count` on org for cohort analytics. *(½ day)*
9. **`charge.dispute.created` evidence flow.** Stub
   `dispute_evidence_packets` table; auto-collect signup IP/email/
   timestamp, paid invoices, portal session history, audit-log rows.
   Pre-pack so submitting evidence is a click, not a research project.
   *(2 days)*
10. **Founder-comp coupon mechanism.** `100% off forever` Stripe coupon;
    when admin marks an org as comp, apply it to a $0-invoice
    subscription on the appropriate tier. Gives you shadow MRR visible
    in `subscription_events`. *(1 day, depends on Marisol §1.)*

### Stretch (week 2 if time)

- Custom line items on credit-pack purchases (description with pack
  size + AcreOS order ID).
- `hosted_invoice_url` surfacing in `/settings` billing tab.
- In-app dunning banner on `org.dunningStage !== 'none'`.
- Per-tier `statement_descriptor_suffix` ("ACREOS PRO" vs "ACREOS
  STARTER") — marginal dispute-rate reduction.

---

## Closing note

The Stripe code is upper-quartile for pre-Series-A: deterministic
idempotency keys (stripeService.ts:6), atomic webhook claim
(webhookHandlers.ts:32), circuit breaker (stripeService.ts:14), dunning
with stage progression and revenue-at-risk alerting. Architectural
instincts are right.

What's missing is the *outer ring*: tax (huge), payment-method diversity
(medium), proration UX (medium), invoice branding (small but visible),
and resurrection/dispute/comp lifecycle gaps (small individually,
collectively a "founder is flying blind" pattern).

Two weeks of focused work moves AcreOS from 2.5/5 to 4/5. The gap to 5/5
is full multi-currency, EU/UK launch, and Stripe Sigma — post-PMF.

**Marisol's six-tier-table fix is upstream of nearly everything in my
sprint.** Until there's one source of pricing truth, my proration preview
shows the customer one number and the founder dashboard another. Sequence
Marisol week one, me week two.

— Vikram
