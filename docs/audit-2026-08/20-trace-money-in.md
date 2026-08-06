# 20 — TRACE T1: Money In (signup → pay → receive product)

*Slice T1. Read-only vertical trace of the paying path. Exhaustive over the billing region.*

**State of the region:** The subscription money-in path (stranger pays AcreOS) is
**sound and reliably provisions**. The platform webhook (`server/index.ts:221`,
`server/webhookHandlers.ts`) verifies signatures cryptographically, claims events
atomically (`INSERT … ON CONFLICT DO NOTHING RETURNING`), and — post-W1.8 —
**releases the claim and re-throws on handler failure** so Stripe redelivers.
Tier resolution has a price-ID fallback. Be-the-rail money custody is enforced by
a real runtime chokepoint (`customerMoneyRouting.ts`), not a comment. Dunning,
downgrade, cancellation, and read-only enforcement are all wired.

**The one defect class that survives every gate here:** the W1.8 "release-claim-on-
failure" fix was applied to the **platform** webhook but **never to the Stripe
Connect webhook** (`routes-billing.ts:1094`). The Connect lane still marks events
processed in a `finally` block even when the handler throws — the exact charged-but-
not-provisioned failure mode W1.8 existed to kill, left live in the customer-money
(borrower payment) lane. Classic wave blindness: one lane fixed, its twin missed.

---

### F-20-1 — Stripe Connect webhook marks events processed even when the handler throws (borrower payment charged-but-never-recorded, no retry)
**Severity:** P1 serious (P0-class consequence when it fires; conditional trigger)
**Surfaced by:** T1
**Survives which gates:** No test exercises the Connect webhook's failure path
(`grep` for `STRIPE_CONNECT_WEBHOOK` / `handleWebhookEvent` in `*.test.ts` → only
`customerMoneyRouting.test.ts`, which tests routing, not the webhook loop). The
`workflowActionHonesty`/reachability ratchets can't see control-flow ordering. `npm
run check` (tsc + lints) is type-correct — the bug is a `try/finally` semantics error,
not a type error. The platform webhook was fixed (W1.8) but the ratchet/lint set never
pinned the invariant, so its twin drifted uncaught.
**Evidence:** `server/routes-billing.ts:1150-1162`:
```
try {
  await stripeConnectService.handleWebhookEvent(event);
} finally {
  // Always mark processed to prevent infinite Stripe retries
  await db.insert(stripeProcessedEvents).values({ stripeEventId: event.id, ... })
    .onConflictDoNothing();
}
```
The `finally` runs the "processed" insert **even when `handleWebhookEvent` throws**.
The throw then propagates to the outer catch (`:1170`) → `Errors.internal` (500) →
Stripe retries → retry hits the duplicate check at `:1142-1145` → returns 200 without
processing. `handleWebhookEvent` genuinely throws: the `checkout.session.completed`
borrower branch calls `processBorrowerPortalPayment` (re-throws, `webhookHandlers.ts:1500`)
and `payment_intent.succeeded` calls `handleSuccessfulPayment`, which does
`storage.createPayment` + `updateNote` with **no internal try/catch**
(`stripeConnect.ts:505-560`).
**What's wrong:** A borrower's card is charged (money settles on the lender's connected
account), but any transient DB error while recording the payment marks the event
processed and suppresses Stripe's retry. The note balance is never decremented; the
borrower shows as still owing money they paid. Contrast the platform webhook, which
does exactly the opposite on failure (`webhookHandlers.ts:87-93`: `releaseClaim` +
re-throw so Stripe redelivers).
**Impact:** Burns trust after sale — hits an AcreOS customer's borrower (the
customer's own counterparty), and leaves a financial-record discrepancy on a
seller-financed note. Fires only when a handler throws (DB blip, lock contention),
so it is latent, not deterministic.
**Fix:** Mirror the platform pattern. Move the "processed" insert to run **only on
success** (after `handleWebhookEvent` resolves), or claim-before-process atomically
and delete the claim in the catch before returning non-2xx. Never mark processed in
a `finally` that also covers a throwing body.
**Gate it:** Add a unit test that makes `handleWebhookEvent` reject and asserts (a) the
row is NOT in `stripeProcessedEvents` afterward and (b) the route returns non-2xx —
mirror it for both webhook endpoints so the invariant is pinned in one shared assertion
(the W1.8 lesson: pin the invariant, don't just fix the site). No measured ratchet
baseline exists for this; add the test.
**Effort:** S (<2h)
**Blast radius:** `server/routes-billing.ts` (1 route), one new test. No schema change.
**Confidence:** high — the `finally`+duplicate-skip mechanism is fully in-file and the
throwing handlers are confirmed to lack internal catches. What would raise it further:
a live redelivery trace, unavailable in a read-only audit.

---

### F-20-2 — Paying customer can be stranded on free entitlements when both Stripe tier signals are absent (active subscription, free tier, no alert)
**Severity:** P2 real (config-dependent; mitigated + logged)
**Surfaced by:** T1
**Survives which gates:** Deployment-config dependent, so no static gate fires. The
price-ID fallback (`tierForStripePriceId`) is the mitigation, but it silently degrades
to a logged error with no founder alert or hard failure.
**Evidence:** `server/webhookHandlers.ts:800-822`. Tier is read from
`product.metadata.tier`; if unset it falls back to `tierForStripePriceId(priceId)`
(`shared/billing/tier-pricing.ts:337-347`), which matches against the `STRIPE_PRICE_*`
env vars. If **both** are missing/mismatched: `logger.error("… org ${org.id} tier NOT
updated")` and the org keeps `subscriptionTier` unchanged (free), while
`processSubscriptionCheckoutCompleted` has already set `subscriptionStatus:'active'`
(`webhookHandlers.ts:334-347`).
**What's wrong:** The customer is charged and marked active but receives free-tier
limits (`TIER_LIMITS.free`: 50 leads / 3 properties / 75 AI turns). The two tier
signals are independent Stripe-dashboard/env config; a single misconfigured product or
an unset `STRIPE_PRICE_EMPIRE_MONTHLY` at deploy produces a silent under-provision.
**Impact:** Blocks first sale's *value delivery* — the customer paid but can't use what
they bought, and only a log line records it. With zero customers, a first-sale deploy
with incomplete Stripe config would hit this before anyone notices.
**Fix:** When tier cannot be resolved on an `active` paid subscription, raise a
founder `system_alert` (the code already does this for new subscribers at `:886-901`)
AND record an activation/health flag, so an unresolved-tier paying org pages someone
rather than sitting silent. Optionally block deploy: a startup check that every visible
`Tier`×interval has a configured `STRIPE_PRICE_*` id.
**Gate it:** Startup/boot assertion `isTierPurchasable(tier, interval)` for every
visible tier (the helper already exists, `tier-pricing.ts:324`); fail fast if a visible
tier has no price id. Measured baseline: 3 visible paid tiers × 2 intervals = 6 required
env ids.
**Effort:** S (<2h)
**Blast radius:** `webhookHandlers.ts` (alert), one boot check. No schema change.
**Confidence:** high on mechanism; medium on likelihood (depends on prod Stripe config I
cannot read).

---

### F-20-3 — Connect webhook idempotency is check-then-insert (TOCTOU), inconsistent with the atomic claim used on the platform webhook
**Severity:** P2 real
**Surfaced by:** T1
**Survives which gates:** DEFECT-0006's atomic-claim fix was applied to the platform
webhook only; no ratchet/lint asserts the pattern, so the Connect lane kept the racey
form. Type-clean, so `npm run check` passes.
**Evidence:** `server/routes-billing.ts:1136-1148` does a `SELECT … WHERE
stripeEventId = event.id` then (in the `finally`) an `INSERT … onConflictDoNothing`.
Two concurrent redeliveries can both pass the SELECT and both run
`handleWebhookEvent`. Compare `webhookHandlers.ts:40-53` (`claimEvent`), which uses a
single `INSERT … ON CONFLICT DO NOTHING RETURNING` and processes only if a row came
back — the DEFECT-0006 fix.
**What's wrong:** Under concurrent Stripe delivery of the same Connect event, the
borrower-payment / note-update handler can run twice. `processBorrowerPortalPayment`
has a secondary dedup (transactionId = session.id, `webhookHandlers.ts:1394-1399`), but
`handleSuccessfulPayment` (`stripeConnect.ts:505`) has no such guard — a double
`createPayment` on the same `paymentIntent.id` is possible.
**Impact:** Burns trust after sale — potential duplicate payment records / double note
credit on a seller-financed loan. Requires concurrent redelivery (rare but real under
Stripe's at-least-once delivery).
**Fix:** Replace the SELECT-then-INSERT with the same atomic `INSERT … ON CONFLICT DO
NOTHING RETURNING` claim used on the platform webhook (and combine with the F-20-1 fix:
claim first, release on throw). Add a transactionId uniqueness guard to
`handleSuccessfulPayment`.
**Gate it:** Fold into the F-20-1 shared webhook-idempotency test (assert single
processing under concurrent claim). No separate baseline.
**Effort:** S (<2h)
**Blast radius:** `routes-billing.ts`, `stripeConnect.ts`. No schema change.
**Confidence:** high on the TOCTOU shape; medium that it fires in practice (needs
concurrent redelivery + the un-guarded PI path).

---

## Verdict (T1)

**Can a stranger pay money today and reliably receive the product? YES** — for the
subscription money-in path (the payment that is actually *to AcreOS*). Signature
verification holds (`webhookHandlers.ts:23-32`, route mounted before `express.json` at
`index.ts:221`/`264`), idempotency is atomic (`:40-53`), failures release the claim and
re-throw for Stripe retry (`:87-93`), tier is granted with a price-ID fallback
(`:800-822`), and limits/dunning/cancellation are enforced. The one residual code risk
to "reliably receive" is **F-20-2** (unresolved tier → active-but-free), and it is
config-dependent and logged, not a deterministic code break. The Connect-webhook defect
(**F-20-1**, breaking point `server/routes-billing.ts:1150-1162`) sits on the
**customer-money (borrower) lane, not AcreOS's own money-in**, so it does not block the
first *subscription* sale — it degrades a customer's downstream loan-payment integrity.

---

## Coverage ledger

**Examined exhaustively (read in full or the load-bearing spans):**
- `server/webhookHandlers.ts` (all 1,548 lines) — every Stripe event branch.
- `server/index.ts:210-278` — platform webhook mount, raw-body ordering, on-call alert.
- `server/routes-billing.ts` — checkout create (`:701-768`), portal (`:770`), Connect
  webhook (`:1094-1177`), cancellation (`:1239`), route inventory (grepped, 40+ routes).
- `server/services/stripeConnect.ts` — `handleWebhookEvent` (`:416-499`),
  `handleSuccessfulPayment` (`:505-560`), `createPaymentIntent` /
  `createCustomerMoneyPaymentIntent` (`:282-355`), customer creation (`:383-414`).
- `server/services/customerMoneyRouting.ts` (all 430 lines) — the be-the-rail chokepoint.
- `server/services/dunning.ts` — `handlePaymentFailed` (`:128-215`), stage math,
  auto-downgrade (`:620-648`); `shared/schema.ts:4599-4663` stage/config maps.
- `server/middleware/dunningAccessGate.ts` (all 78 lines) + mount at
  `getOrCreateOrg.ts:353`.
- `server/middleware/usageLimitGate.ts` (all 165 lines) + mount sites (grepped: leads,
  notes, campaigns, ai_requests, properties inline).
- `shared/billing/tier-limits.ts` (all 292 lines), `shared/billing/tier-pricing.ts`
  (`:1-75`, `:270-347`).
- `server/services/usageLimits.ts:120-240` (checkUsageLimit, getAllUsageLimits).

**Examined by sampling:** `server/services/credits.ts` and `shared/billing/allowanceEngine.ts`
(credit-purchase webhook branch confirmed at `webhookHandlers.ts:1254-1280`; deep
allowance-TOCTOU already re-verified holding in 00-orientation, DEFECT-0007 — not
re-audited). `server/routes-subscription.ts` / `routes-dunning.ts` (grepped, not
line-read). `stripeService.ts` `createCheckoutSession` (behavior inferred from call
site + `enableAch`/trial params; not line-read in full).

**Did NOT examine:** live Stripe dashboard config (product metadata, `STRIPE_PRICE_*`
secrets) — un-inspectable from a read-only repo audit; this is exactly F-20-2's
unknown. The vertical-pack (S3) and ACH mandate (`achMandateSetup.ts`/`achAutopay.ts`)
sub-lanes were confirmed present but not traced end-to-end. `recognitionWorker` /
`financial-ledger` posting correctness (dollar-accuracy of GL splits) is slice-16/T3
territory, not re-derived here.

## Constitution Collisions

**None.** Every path traced upholds the constitution:
- **Be the rail** — subscription payments go to the AcreOS platform account
  (allowed: "the only payments AcreOS is a party to"); borrower/customer money is
  forced onto the org's OWN connected account via `resolveOrgCardProcessor` +
  `prepareCustomerMoneyCall`, which throws on any `application_fee_amount` /
  `transfer_data` / `on_behalf_of` (`customerMoneyRouting.ts:263-351`). No platform-
  balance fallback exists. F-20-1/F-20-3 are integrity bugs on that lane, not custody
  violations — no money routes onto AcreOS's balance.
- **Hard-stops founder-only** — pricing/tier changes flow from Stripe events, not
  customer-writable routes; no new nav/AI-destination/marketplace surface introduced.
