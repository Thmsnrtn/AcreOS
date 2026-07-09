# Shared Stripe Account — Operating Convention

**Account:** `acct_1SATMcRx25BFZ1Jm` (Thomas Norton, live)
**Applies to:** Foundry, AcreOS, and every app added later.
**Status:** canonical. This file is kept identical in every repo that bills through this account.

---

## Why this exists

One live Stripe account is shared by three unrelated concerns:

| Tenant | What it is | Ownership tag |
| --- | --- | --- |
| **Land sales** (personal) | Owner-financed lots + fees (Luna County lots, Down Payment, Doc Fee), created by hand in the dashboard. The only live money in the account. | `app=land` |
| **AcreOS** | Land-investor SaaS — tiers, seats, vertical packs. | `app=acreos` |
| **Foundry** | AI ops layer for solo founders — subscription tiers. | `app=foundry` |

A Stripe webhook endpoint **cannot** be scoped to "only my products" — every endpoint receives
every event on the account, including the other tenants'. So isolation is not achieved by Stripe
configuration; it is achieved by this convention, enforced in code.

---

## The one rule

> **Every object an app creates carries an `app` tag naming its owner, and every app only ever
> reads or acts on objects where `app == itself`.**

`app` is the single namespace dimension. Values: `foundry`, `acreos`, `land`.

Everything below is an application of that rule.

---

## 1. Metadata schema

A small, fixed set of keys. Set them on **create**; never rely on an object being untagged.

| Object | Key | Values / format | Required |
| --- | --- | --- | --- |
| All objects | `app` | owner slug: `foundry` · `acreos` · `land` | **yes** |
| All objects | `env` | `live` · `test` | optional |
| Products | `app_object` | `plan` · `seat` · `pack` | **yes** |
| Products | `plan_key` | stable key: `starter`, `pro`, `scale`, `solo`, `growth`, … | **yes** |
| Prices | `plan_key` | matches the product's key | **yes** |
| Prices | `billing_period` | `monthly` · `yearly` · `one_time` | **yes** |
| Customers | `app` + ref | `app` plus the app's own id — `org_id` (AcreOS) or `founder_id` (Foundry) | **yes** |

Existing app-specific keys (AcreOS's `acreos_product`, `acreos_key`, `type`, `tier`) remain valid.
`app` simply becomes the primary filter everywhere.

---

## 2. Prices resolve by `lookup_key`, not env vars

Every price gets a native Stripe `lookup_key`:

```
<app>_<plan>_<period>
```

Examples: `acreos_pro_monthly`, `acreos_pro_yearly`, `foundry_solo_monthly`,
`acreos_pack_note_investor_monthly`, `acreos_seat_scale_monthly`.

Code resolves prices by lookup key instead of a wall of `STRIPE_PRICE_*` secrets:

```ts
// before
const priceId = process.env.STRIPE_PRICE_OPERATOR_MONTHLY;

// after
const [price] = (await stripe.prices.list({ lookup_keys: ['acreos_pro_monthly'], active: true })).data;
```

Benefits: one secret (the API key) instead of ~20 price-ID secrets that drift between `.env`,
`env.ts`, and Fly; a human-readable price identity; and price IDs never hardcoded.

---

## 3. Isolation

**Webhooks — one endpoint per app, each filters to itself.**
Each app keeps its own endpoint and its own signing secret. Because every endpoint receives every
event on the account, each handler **must** establish ownership before acting:

- resolve the object's `app` metadata and early-return when it isn't ours, **or**
- resolve the customer → our own record (`getOrganizationByStripeCustomerId` / founder lookup) and
  early-return on no match.

Any list / reconcile / aggregate call must filter to `app == self` (products/prices) or to
customers that resolve to one of our records. Never sum "all invoices/subscriptions on the account."

**API keys — one restricted key per app.**
`foundry-live`, `acreos-live`. Restricted keys don't isolate by product, but they give per-app
rotation, revocation, and audit — one app's key can be revoked without touching another. Land sales
stay dashboard-only.

**Statement descriptors — customers recognize the charge.**
Per-app suffix: `ACREOS`, `FOUNDRY`. Land keeps `LandPymnt~ThomasNorton`.

---

## 4. Adding app #3 — checklist

1. Pick a slug (e.g. `myapp`). Every object you create sets `app: myapp` in metadata — no exceptions.
2. Create products with `app_object` + `plan_key`; name them `MyApp — Pro` so the dashboard stays readable.
3. Give every price a `lookup_key` of `myapp_<plan>_<period>`; resolve prices by that in code — never hardcode price IDs.
4. Create one restricted API key `myapp-live` and one webhook endpoint with its own secret.
5. Every list / reconcile / webhook path filters to `app == myapp` (or customer → your own record) before acting.
6. Set a statement-descriptor suffix.
7. Never touch objects tagged `app: land`, or any product/price without your own `app` slug.

---

## 5. Never touch

- Objects tagged `app: land` — the personal land sales.
- The active land-note subscription and its prices.
- Any product or price that does not carry your app's `app` slug.

When in doubt, filter positively (`app == self`), never by exclusion.
