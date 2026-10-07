# Plan 3 — Stripe test mode, end to end

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Drive AcreOS's own subscription billing through Stripe **test mode** from
checkout to cancellation, with webhooks delivered by Stripe and signed with a
real webhook secret, and confirm that the app's entitlements, dunning state
and refund records follow what Stripe says. Separately, confirm the custody
rule for customer-managed money holds against real Stripe objects.

## The rule this plan must respect

**Be the rail, not the provider** (founder ruling 2026-07-29, CLAUDE.md
DO-NOT-DO list). Subscription payments **to AcreOS** are the only payments
AcreOS is a party to. Customer-managed money — borrower note payments, rent,
escrow, distributions — runs on the **customer's own connected processor
account** or is routed out entirely: no platform-account fallback, no
application fee, no funds through AcreOS's balance. The chokepoint is
`server/services/customerMoneyRouting.ts`, pinned by
`tests/unit/moneyCustodyHardStop.test.ts` and
`tests/unit/customerMoneyRouting.test.ts`. Part B of this plan checks that
rule against Stripe's own records rather than against the code.

The account is shared with other applications under the convention in
`docs/stripe-shared-account.md` (every object carries an `app` tag; each app
acts only on its own). The webhook endpoint therefore receives other tenants'
events; Part A includes that case.

## Why the campaign could not cover it

The campaign ran with billing unconfigured — no Stripe keys and no live
webhook delivery. It exercised signature rejection of unsigned and forged
events locally, but no checkout, subscription lifecycle, signed delivery from
Stripe, dunning transition or refund against Stripe.

## Environment and prerequisites

- Staging, or a local build exposed to the Stripe CLI. **Test mode only** —
  never live keys. Use a test-mode environment of the account (or a Stripe
  sandbox) so no live object is touched.
- Secrets by name: `STRIPE_SECRET_KEY` (test), `STRIPE_PUBLISHABLE_KEY`
  (test), `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`; optionally
  `STRIPE_WEBHOOK_ENDPOINT_ID`, `STRIPE_BILLING_PORTAL_URL`.
- Test-mode products and prices created with
  `scripts/setup-stripe-subscription-products.ts` (read it first; confirm it
  targets test mode with the key you supply).
- The Stripe CLI, logged in to the test-mode environment.
- Two test organizations: one that will subscribe (S1); one that acts as a
  note-servicing lender (L1) with a **test-mode Connect account** of its own.

Endpoints involved (from `server/index.ts` and `server/routes-billing.ts`):
`POST /api/stripe/webhook` (platform events, signature-checked in
`server/webhookHandlers.ts`), `POST /api/stripe/connect/webhook` (connected
account events), `POST /api/stripe/checkout`, `POST /api/stripe/portal`,
`GET /api/stripe/subscription`, `POST /api/billing/packs/checkout`,
`POST /api/subscription/cancel`, `POST /api/subscription/refund-request`,
and the `/api/stripe/connect/*` routes.

## Procedure

### Part A — AcreOS subscription billing

1. **Signed delivery.** Run `stripe listen --forward-to
   <base>/api/stripe/webhook` and, separately,
   `--forward-connect-to <base>/api/stripe/connect/webhook`. Set
   `STRIPE_WEBHOOK_SECRET` to the secret the CLI prints for the session and
   restart the app. Confirm one `stripe trigger` event is accepted (2xx) and
   recorded once.
2. **Checkout.** As S1, start checkout from Settings and pay with Stripe's
   documented success test card. Confirm the subscription appears in Stripe,
   every event Stripe sends for it reaches the endpoint and is recorded once
   (the claim table read by `server/webhookHandlers.ts`), and S1's tier and
   limits change in the app. Record which event (or which redirect/sync path)
   actually changed the tier — the platform handler's event switch names
   `invoice.*`, `customer.subscription.deleted`,
   `customer.subscription.trial_will_end` and `charge.dispute.created`, so
   the path for activation and plan changes should be identified, not
   assumed.
3. **3-D Secure.** Repeat with a test card that requires authentication;
   complete and then abandon the challenge. The abandoned case must not grant
   the tier.
4. **Lifecycle with a test clock.** Attach S1's customer to a Stripe test
   clock. Advance through a renewal, an upgrade, a downgrade (proration), a
   trial end if trials are offered (`customer.subscription.trial_will_end`),
   and a cancel-at-period-end via `POST /api/subscription/cancel` followed by
   the period end (`customer.subscription.deleted`). After each advance,
   compare the app's tier and limits with Stripe's subscription state.
5. **Dunning.** Swap S1's payment method for a test card that declines on
   charge and advance the clock to the next invoice. Confirm
   `invoice.payment_failed` moves S1 into the dunning state enforced by
   `server/middleware/dunningAccessGate.ts` (reads allowed, writes refused, per
   the gate), that the customer-facing message is accurate, and that a
   successful retry (`invoice.payment_succeeded`) restores access.
6. **Refunds.** Submit `POST /api/subscription/refund-request` as S1. Process
   the refund through the manual flow in `server/routes-billing.ts`. Confirm
   Stripe's refund object and the app's record agree on amount and status.
   (The autopilot `apply_refund` hand in
   `server/services/autopilot/hands/apply-refund.ts` is capped and approval-
   gated; exercising it is optional and must not exceed its ceiling.)
7. **Disputes.** `stripe trigger charge.dispute.created`; confirm the handler
   records it and nothing else changes silently.
8. **Replay and ordering.** Use `stripe events resend` to redeliver an already
   processed event; confirm no double effect. Deliver two lifecycle events out
   of order; confirm the final state matches Stripe's.
9. **Foreign-tenant events.** Create a test-mode object tagged with another
   app (per `docs/stripe-shared-account.md`) and let its events reach the
   endpoint. Confirm AcreOS acknowledges and ignores them.
10. **Billing portal.** Open `POST /api/stripe/portal`; change card and
    cancel from the portal; confirm webhooks bring the app into line.

### Part B — customer money stays on the customer's rail

11. As L1, connect the test-mode Connect account via
    `/api/stripe/connect/link` and generate a borrower payment link
    (`GET /api/stripe/connect/payment-link/:noteId`). Pay it with a test card.
12. In the Stripe dashboard, confirm the resulting payment object exists **on
    L1's connected account**, that there is **no application fee**, and that
    **no corresponding charge, transfer or balance movement exists on the
    platform account**.
13. Disconnect L1 (`/api/stripe/connect/disconnect`) and attempt the same
    borrower payment. The expected behaviour is a refusal or a route-out — the
    payment must not fall back to the platform account.

## Pass criteria

- After every Part A step, the app's tier, limits and dunning state equal
  what Stripe reports for the subscription.
- Every webhook delivery is accepted once; replays produce no second effect;
  foreign-tagged events produce no effect.
- Part B: zero customer-money objects on the platform account; zero
  application fees; disconnected lenders are refused rather than rerouted.
- **Fail:** any entitlement granted without a successful payment; any lost
  entitlement after a successful one; any double-processed event; any
  customer-money object on the platform account.

## Results

Not yet run.

## Still owed

- An owner and a date.
- Confirmation of which test-mode environment to use given the shared account.
- Founder confirmation of the dunning policy (retry schedule, grace period,
  what a dunning org may do) so step 5 has an expected result to compare to.
- Founder confirmation of the refund policy for step 6.

## Run log

_(empty — append entries per the format in [README](README.md))_
