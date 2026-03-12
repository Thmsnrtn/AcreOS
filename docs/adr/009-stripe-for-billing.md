# ADR 009: Stripe for Subscription Billing and Marketplace Payments

**Status**: Accepted
**Date**: 2025-01-10
**Deciders**: Engineering team, Business

## Context

AcreOS requires a billing system for SaaS subscription management and a payment processor for marketplace transactions (land deals, note securitization). We need subscription lifecycle management, webhook processing, and marketplace fee collection.

## Decision

We use **Stripe** for all payment processing:
- SaaS subscription billing (tiered plans: free/starter/pro/enterprise)
- Marketplace transaction processing (1.5% fee on property sales)
- Hard money lending referral commission tracking (20%)
- Note servicing payments via ACH

**Implementation:**
- Stripe customer created on organization creation (not first payment)
- Idempotency keys on all Stripe API calls to prevent double charges
- Webhook signature validation on `/api/stripe/webhook` (registered before rate limiting middleware)
- Stripe test/live mode controlled by `STRIPE_SECRET_KEY` prefix (sk_test vs sk_live)
- Subscription tier enforced in real-time via `subscriptionTier` on organization record
- Dunning handled via Stripe's built-in retry logic + custom `dunningEvents` table

## Rationale

| Concern | Stripe | Braintree | Square |
|---|---|---|---|
| **Subscription billing** | Excellent | Good | Limited |
| **Marketplace support** | Excellent (Connect) | Limited | Limited |
| **Webhook reliability** | Excellent | Good | Good |
| **ACH/bank payments** | Native | Via partner | Limited |
| **Fraud protection** | Radar (built-in) | Basic | Basic |
| **Developer experience** | Industry-leading | Good | Adequate |

## Consequences

- `STRIPE_WEBHOOK_SECRET` must be set in production (rotated before launch)
- `/api/stripe/webhook` is excluded from all rate limiting (Stripe IPs not rate-limited)
- Stripe Connect required for marketplace seller payouts
- Trial period: 7 days (configured in Stripe Product, enforced in code)
- Failed payments: dunning flow creates `dunningEvents` records for tracking
