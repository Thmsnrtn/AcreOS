# Alaric Gaston — Refund & Chargeback Audit, AcreOS

**Lens:** Eleven years on disputes — two SaaS companies and one
marketplace. AcreOS volume today (~5 chargebacks + ~10 refunds/month) is
small, but the *plumbing* is where pre-Series-A SaaS quietly bleeds. A
1.5% chargeback rate flips Stripe's monitoring program at $20k MRR; a
single $5k Pro-annual dispute lost on "product not received" pays a
year of tooling.

Read `vikram-stripe.md` (§2 lifecycle, §8 #9 evidence stub). Vikram owns
API shape, Marisol owns GAAP, I own *outcomes* — what happens after a
customer hits "Refund" or a card network issues a retrieval request.

Files walked: `routes-billing.ts:780-940`, `webhookHandlers.ts:142-751`,
`shared/schema.ts:5535-5552`, plus a fruitless grep of `client/src` for
refund/dispute UI.

---

## 1. One-line verdict

**Disputes/refunds maturity: 1.5 / 5.** Refund flow ships auto-approve
under $50 and a 30-day rate-limit — both correct instincts. Everything
else missing: no admin approve/deny endpoint despite a 4-state status
enum, no client UI, no dispute evidence packet, no partial/prorated
math, no abuse signals, no outcomes tracking, no `charge.refunded`
webhook (Vikram §2.4). The first $2k+ chargeback will be lost on
procedural grounds because evidence is "log into Stripe and write
something."

---

## 2. Refund flow holes (`routes-billing.ts:783`)

The happy path is fine. The edges are not:

1. **No admin approve/deny endpoint.** `status` enum is
   `pending|approved|denied|processed` (`schema.ts:5543`) but only
   `auto` reaches `processed`. Pending refunds sit forever — there is
   no `POST /api/admin/refunds/:id/{approve,deny}`. Founder gets a
   system alert, opens Stripe directly, processes manually, leaves
   `refundRequests.status = 'pending'` permanently misleading.
2. **"Latest charge" is the wrong target half the time.** A customer
   who upgraded Starter→Pro mid-cycle has *two* charges in 30 days;
   the refund hits the more recent (small proration delta), not the
   actual full-period charge. Add explicit `stripeChargeId` payload,
   or query `latest_invoice` on the active subscription.
3. **No idempotency key on `stripe.refunds.create`.** Retry catches
   the throw and flips status to `pending`, but if the refund *did*
   succeed and we lost the response (network blip), the row stays
   "pending" while Stripe holds a real refund. Pass
   `Idempotency-Key: refund:${request.id}` (Ines's pattern). Stripe
   returns the original on retry.
4. **Subscription cancellation is unconditional.** A $25 partial
   refund on a $49 charge still cancels the entire sub. Should be:
   full → cancel; partial → keep.
5. **No `denialReason` field.** Legitimate denial (TOS violation,
   prior chargeback abuse, post-30-day request) has nowhere to go;
   supportAgent can't surface it, customer emails support asking why.
6. **Email is HTML-inline, English only.** Camille (FR-CA) and
   Esperanza (ES) personas get English confirmations. Move to
   `emailTemplates.ts` with locale.

---

## 3. Partial-refund math — entirely absent

Schema field is `amountCents`; `stripe.refunds.create` omits `amount`.
**AcreOS only does full refunds.** Six real scenarios it gets wrong:

| Scenario | Correct | AcreOS today |
|---|---|---|
| Churns day 8 of monthly | Pro-rate 22/30 of $49 = $35.93 | Full $49 |
| Annual, churns month 4/12 | 8/12 of $588 = $392 | Full $588, **$196 loss** |
| 50k credits, used 3k | $25 × 47/50 = $23.50 | Full $25, leaves credits |
| Double-charge (Ines §1.2) | One of two | "Latest" — sometimes wrong |
| Pro→Starter mid-cycle credit | Pro-rate unused Pro days | Not modeled |
| Goodwill (outage during demo) | Custom amount, sub stays | Force-cancels |

Schema: add `requestedAmountCents`, `refundedAmountCents`, `refundType`
(`full|partial|prorated|goodwill|duplicate`), `creditsClawedBack`,
`subscriptionAction` (`cancel|keep|downgrade_at_period_end`).
Helper `services/refundCalculator.ts` with `prorateRefund(charge,
periodStart, periodEnd, cancelAt)` returning `refundCents` =
`charge.amount × unusedDays / totalDays` rounded. Pick one convention
("refund unused", banker's rounding) and use it across refund email,
audit log, supportAgent answers.

---

## 4. Chargeback evidence — the $2k bug

`webhookHandlers.ts:712` handles `charge.dispute.{created,updated,closed}`
but **only creates a system alert.** No evidence packet, no submission
flow, no outcomes tracking.

Stripe gives ~5–7 days to submit. Visa CE3.0 needs ≥4 of 8 specific data
elements; Mastercard compelling-evidence differs. Today: founder gets
alert, opens Stripe, hand-writes a response, loses ~70% because
evidence is sparse.

### Pre-pack on `charge.dispute.created`

Schema (Vikram §8 #9, expanded):

```ts
export const disputeEvidencePackets = pgTable("dispute_evidence_packets", {
  id: serial("id").primaryKey(),
  stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
  stripeChargeId: text("stripe_charge_id").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  evidenceDueBy: timestamp("evidence_due_by").notNull(),
  packet: jsonb("packet").notNull(),
  outcome: text("outcome"),  // won|lost|warning_closed|charge_refunded
  outcomeAt: timestamp("outcome_at"),
  submittedAt: timestamp("submitted_at"),
  netLossCents: integer("net_loss_cents"),  // amount + $15 fee on loss
  createdAt: timestamp("created_at").defaultNow(),
});
```

`packet` auto-collects: signup IP + UA, all paid invoices, customer
portal session count (kills "I never used it"), audit-log rows since
charge, onboarding completion timestamp, statement-descriptor text
actually shown (Vikram §5), most-recent TOS-acceptance + version hash.

**Reason-driven dispatch** (this is the win-rate lever):

```ts
const evidenceByReason: Record<string, string[]> = {
  fraudulent: ['ip_match', 'aav_match', 'login_history', 'portal_sessions'],
  product_not_received: ['login_history', 'feature_usage'],
  product_unacceptable: ['support_tickets', 'feature_usage', 'tos_acceptance'],
  subscription_canceled: ['cancel_attempts', 'tos_link', 'cancel_email'],
  duplicate: ['both_charges_with_diff_metadata', 'idempotency_keys'],
  credit_not_processed: ['refund_record', 'refund_arn', 'date_issued'],
};
```

Reason-routed evidence flips win rate ~30% → ~65% in my experience.

---

## 5. Dispute outcomes tracking — currently zero

`charge.dispute.closed` arrives with status `won|lost|warning_closed|
charge_refunded`. AcreOS logs an "info" alert and moves on. Track:
net loss per dispute (`amount + $15 fee` on loss, fee-only on
warning_closed), win rate by reason, win rate by acquisition channel
(flags Ezra's paid campaigns as higher-fraud), dispute rate ratio
(Stripe thresholds: 0.75% normal, 1% warning, 1.5% monitoring).
Surface as founder widget: "3 won / 2 lost this quarter, $187 net,
0.42% rate." Without measurement, no signal before Stripe puts you in
monitoring.

---

## 6. Abuse signals — chargeback fraud detection

Today: nothing. Bad actor signs up, uses 28 days, chargebacks-as-fraud,
signs up again under a new org, repeat. Stripe Radar catches some;
SaaS-specific signals belong in AcreOS:

1. Same email + new payment method post-chargeback → Radar block.
2. Same `signupIP` + new email within 7d of dispute on that IP → flag.
3. ≥2 refund requests in 90d across orgs (same email/IP) → soft-block
   self-serve, route to manual.
4. Credit-pack velocity: buy 50k, use 45k in 24h, then request refund.
   Rule: `if creditsUsedRatio > 0.5, deny auto-approval`.
5. Stripe network-updater rotates a card that lost a prior dispute →
   treat as same actor.

Persist on `organizations`: `riskScore` (0–100), `riskFlags` (jsonb),
`manualReviewRequired`. Auto-approve gates on `riskScore < 30`.

---

## 7. Refund-rule policy engine

Current policy is two lines. Codify so support, supportAgent, and
self-serve read the same source:

```ts
// services/refundPolicy.ts
export const REFUND_RULES = {
  windowDays: 30,
  rateLimitDays: 30,
  autoApproveCeilingCents: 5000,
  riskScoreMaxForAuto: 30,
  proratedDefault: true,
  cancelOnFullRefund: true,
  cancelOnPartialRefund: false,
  clawbackUnusedCredits: true,
  goodwillCapCents: 10000,
};
```

Surface at `/legal/refund-policy` — currently the terms page references
"our refund policy" but no policy page exists (broken link).
Sebastian and Bartholomew personas will demand the policy text in
writing; ship it.

---

## 8. Two-week sprint

### Week 1 — close the loss-leak

1. **`charge.refunded` webhook handler** (Vikram §2.4 — out-of-band
   refund never closes loop). 1/2 day, joint w/ Vikram.
2. **Admin approve/deny endpoint** with `denialReason`. Closes the
   pending-forever bug. 1 day.
3. **Partial-refund math + schema** (§3). 2 days.
4. **Idempotency key on `stripe.refunds.create`**. 30 min.
5. **Reason-specific dispute evidence packet** (§4). 2 days.

### Week 2 — outcomes, UI, abuse

6. **Admin UI at `/founder/billing/disputes`** — pending refunds
   approve/deny + amount input; open disputes one-click "submit
   pre-packed evidence." 2 days.
7. **Customer refund UI in Settings → Billing.** Zero React surface
   exists today. Form with prorate preview. 1 day.
8. **Outcome tracking on `dispute.closed`** (§5). 1 day.
9. **`/legal/refund-policy` page** — MDX from §7 rules. 1/2 day.
10. **Abuse signal v1** (§6 #1, #3). 1 day.

---

## Closing note

The refund code reads like v0 in an afternoon — right instincts, never
revisited. The dispute code reads like "we'll deal with it." Both
cheap to fix now, expensive at $500k MRR with 1,000 historical refund
rows lacking `refundType` and `outcome`.

Highest-leverage line: **dispute evidence packet** (§4). Three lost
disputes per quarter at $200 avg + $15 fee = $645 quarterly bleed
today, scaling linearly with revenue. Reason-routed evidence pays
back the engineering in two months.

**Vikram's `automatic_tax` is upstream of my work**: tax-line confusion
("why $52.40 not $49?") is a top-5 dispute reason. Ship his §8 #1
before my customer refund UI; otherwise I'm writing dispute responses
to dispute responses.

— Alaric
