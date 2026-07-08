# Hassiba Akkari — GAAP-Compatible Revenue Reporting, AcreOS

**Lens:** 9 years building financial-reporting at Mercury and KPMG. SaaS founders almost universally don't realize that ARR/MRR *is* GAAP deferred-revenue accounting wearing a marketing t-shirt. Marisol nailed the symptoms (six tier tables, no event log, no deferred-revenue schedule). My job here is to take her three-week sprint and write the spec at the level a controller could implement without ambiguity — schemas, recognition rules, ASC 606 mapping, edge cases she didn't have room for.

This is wave 2 of the audit; treat it as the build-doc that sits behind Marisol's findings.

---

## 1. One-line verdict

**GAAP-readiness today: F.** Annual cash is recognized at charge (front-loaded — wrong), tier changes mutate state in place (yesterday's MRR is unrecoverable from the DB), credits are sold as revenue at purchase rather than deferred until consumed (a liability misstatement), and there is no contra-revenue treatment for refunds. AcreOS today reports cash-basis MRR called "ARR" and would not survive a Big-4 audit-readiness review. **Two-week sprint below brings it to series-A-passable accrual reporting; full ASC 606 / SOX-light is a quarter.**

---

## 2. Deferred revenue table — spec

### 2.1 Why it must exist

ASC 606-10-25-30: revenue is recognized when (or as) the performance obligation is satisfied. For a SaaS subscription, the performance obligation is *access to the platform over the subscription period.* Cash collected up front for an annual plan is a **liability** (deferred revenue) until the access has been delivered. Today AcreOS has zero liability-side accounting; every dollar Stripe charges is treated as earned.

### 2.2 Schema

```sql
CREATE TABLE deferred_revenue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  source_type        text NOT NULL,          -- 'subscription_annual' | 'subscription_monthly'
                                              -- | 'credit_pack' | 'one_time_setup'
  source_id          text NOT NULL,           -- stripe invoice/charge id; credit_transactions.id
  contract_start     date NOT NULL,
  contract_end       date NOT NULL,           -- inclusive; for credit packs = expected burn end
  total_billed_cents bigint NOT NULL,         -- net of discounts at the time of sale
  total_recognized_cents bigint NOT NULL DEFAULT 0,
  recognition_method text NOT NULL,           -- 'straight_line_daily' | 'usage_based' | 'point_in_time'
  currency           char(3) NOT NULL DEFAULT 'USD',
  fx_rate_at_sale    numeric(12,6),           -- USD/local at recognition-day-1
  status             text NOT NULL DEFAULT 'open', -- 'open' | 'closed' | 'voided_refund'
  created_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  CHECK (total_recognized_cents <= total_billed_cents),
  CHECK (contract_end >= contract_start)
);

CREATE INDEX idx_def_rev_org_status ON deferred_revenue(organization_id, status);
CREATE INDEX idx_def_rev_open_for_worker ON deferred_revenue(status, contract_end) WHERE status = 'open';
```

### 2.3 Recognition schedule (sister table)

```sql
CREATE TABLE revenue_recognition (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deferred_revenue_id uuid NOT NULL REFERENCES deferred_revenue(id),
  organization_id    uuid NOT NULL,
  period_start       date NOT NULL,           -- always month-start in v1
  period_end         date NOT NULL,
  recognized_cents   bigint NOT NULL,
  category           text NOT NULL,           -- 'subscription' | 'usage' | 'one_time'
  posted_at          timestamptz NOT NULL DEFAULT now(),
  reversed           boolean NOT NULL DEFAULT false,
  reversal_reason    text,
  UNIQUE (deferred_revenue_id, period_start, period_end)
);
```

Append-only. Reversals (refunds, credit memos) write a *new* row with `reversed=true` and a negative `recognized_cents`. **Never UPDATE.**

### 2.4 Recognition formulas

| Source | Formula | Notes |
|---|---|---|
| Annual subscription ($1188/yr Pro) | `daily_rate = total_billed / days_in_contract`; recognized in month M = `daily_rate × days_of_M_in_contract` | Straight-line by day, not month. Customer who signs Jan 15 has 17 days of Jan recognition, not a full month. |
| Monthly subscription | One-shot at period-end OR daily straight-line within the month | Pick one and stay there. I recommend daily — handles mid-month upgrades cleanly. |
| Credit pack ($100 → 1000 credits) | Recognize per-credit consumed: `recognized = consumed_credits × (total_billed / total_credits_purchased)` | When credits expire un-consumed, recognize the residual on expiry date (breakage — see §5.3). |
| One-time setup fees | Point-in-time at delivery | None today; reserve the row for white-label later. |

### 2.5 The recognition worker

A nightly job (`server/jobs/revenueRecognition.ts`) that:

1. For each `deferred_revenue` row with `status='open'` and `contract_start <= today`:
   - Compute `expected_recognized_cents` for the closed month.
   - Insert a `revenue_recognition` row for `(period_start, period_end)` if not already present.
   - Increment `total_recognized_cents` on the parent.
2. If `total_recognized_cents == total_billed_cents`, set `status='closed'`, `closed_at=now()`.
3. Emit a `revenue.recognized` audit event.

Idempotent on `(deferred_revenue_id, period_start, period_end)` unique key. Re-run safe.

### 2.6 Backfill

For every existing Stripe `invoice.paid` since launch:
- If subscription was annual → write a `deferred_revenue` row, then run the worker over historical months to populate `revenue_recognition`.
- If monthly → write one `deferred_revenue` row per invoice; one `revenue_recognition` row per closed month.
- For credit packs: write `deferred_revenue` rows; reconstruct consumption from `creditTransactions.delta < 0` rows.

This is a one-time script; estimate 1 day if AcreOS has under ~50k invoices (it does).

---

## 3. Subscription event ledger — spec (echo + extend Marisol)

Marisol called this the second-most-important fix and she's right. Here is the schema at the level a controller signs off on.

### 3.1 Schema

```sql
CREATE TABLE subscription_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  event_type          text NOT NULL,
    -- 'trial_started' | 'trial_converted' | 'trial_expired'
    -- | 'subscription_created' | 'subscription_upgraded' | 'subscription_downgraded'
    -- | 'subscription_cancelled' | 'subscription_reactivated'
    -- | 'plan_interval_changed' | 'seat_added' | 'seat_removed'
    -- | 'discount_applied' | 'discount_removed'
    -- | 'comp_granted' | 'comp_expired'
    -- | 'paused' | 'resumed'
  effective_at        timestamptz NOT NULL,    -- when the change is in force (NOT now())
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  prior_tier          text,                    -- nullable; null on first event
  new_tier            text,
  prior_interval      text,                    -- 'month' | 'year' | null
  new_interval        text,
  prior_unit_price_cents bigint,
  new_unit_price_cents bigint,
  prior_seat_count    int,
  new_seat_count      int,
  discount_code       text,                    -- coupon id if applicable
  discount_pct        numeric(5,2),
  comp_reason         text,                    -- if event_type = 'comp_granted'
  comp_expires_at     timestamptz,
  stripe_event_id     text,                    -- idempotency key from Stripe
  stripe_subscription_id text,
  source              text NOT NULL,           -- 'stripe_webhook' | 'admin_action' | 'system'
  actor_user_id       uuid,                    -- for admin_action
  reason              text,                    -- free text justification
  metadata            jsonb,
  UNIQUE (stripe_event_id)                    -- replay-safe
);

CREATE INDEX idx_sub_events_org_effective ON subscription_events(organization_id, effective_at DESC);
CREATE INDEX idx_sub_events_effective ON subscription_events(effective_at);
```

### 3.2 The "current state" is a view, not a column

`organizations.subscription_tier` becomes a *materialized view* read from the latest event:

```sql
CREATE OR REPLACE VIEW v_org_subscription_current AS
SELECT DISTINCT ON (organization_id)
  organization_id,
  new_tier            AS tier,
  new_interval        AS interval,
  new_unit_price_cents AS unit_price_cents,
  new_seat_count      AS seat_count,
  effective_at        AS effective_since
FROM subscription_events
WHERE effective_at <= now()
ORDER BY organization_id, effective_at DESC, recorded_at DESC;
```

Migration: keep `organizations.subscription_tier` for one release behind a feature flag; cut over after backfill validates. **Do not delete the column** — keep it as a denormalized cache, refreshed by a trigger on `subscription_events` insert. Joins stay fast; ledger stays canonical.

### 3.3 Point-in-time MRR — single SQL query

Yesterday's MRR is now reproducible:

```sql
-- MRR active on any date :as_of
WITH active AS (
  SELECT DISTINCT ON (organization_id)
    organization_id, new_tier, new_unit_price_cents, new_seat_count, new_interval
  FROM subscription_events
  WHERE effective_at <= :as_of
  ORDER BY organization_id, effective_at DESC, recorded_at DESC
)
SELECT
  SUM(
    CASE
      WHEN new_interval = 'month' THEN new_unit_price_cents * COALESCE(new_seat_count, 1)
      WHEN new_interval = 'year'  THEN (new_unit_price_cents * COALESCE(new_seat_count, 1)) / 12
      ELSE 0
    END
  ) AS mrr_cents
FROM active
WHERE new_tier <> 'free' AND new_tier IS NOT NULL;
```

This is the **single source of truth** for MRR. Every dashboard, agent, founder home, and admin page reads from this query (or a daily-snapshot table built off it). The six conflicting tier tables Marisol found get deleted.

---

## 4. ARR/MRR computation — single source of truth design

### 4.1 The four ARR numbers a CFO must distinguish

Today AcreOS has one ARR number and it's wrong. A series-A board deck needs four:

| Metric | Definition | Use |
|---|---|---|
| **List ARR** | Σ (published list price × active subs), no discounts applied | Top-of-funnel sales reporting; "what we'd bill at sticker" |
| **Booked ARR** | Σ (contracted price × active subs), discounts applied, comps **excluded** | The number on the board deck |
| **Net ARR (Recognized)** | TTM recognized revenue from `revenue_recognition` table | The GAAP number; what auditors confirm |
| **Committed ARR** | Booked ARR + signed-but-not-started contracts | Forward-looking pipeline metric |

Annual subscriptions complicate this: an annual plan is 12 months of *committed* revenue but only the elapsed months are *recognized*. Both numbers must be reportable independently.

### 4.2 The canonical view layer

```
shared/billing/tier-pricing.ts            (constants — Marisol's #1)
        │
        ▼
subscription_events  (immutable ledger)
        │
        ├─► v_org_subscription_current     (current state)
        ├─► v_mrr_snapshot_daily           (one row per day, replayable)
        └─► deferred_revenue → revenue_recognition  (GAAP layer)
                                       │
                                       └─► v_arr_breakdown
                                            (list / booked / recognized / committed)
```

Every consumer reads from a *view*. No service computes its own ARR ever again.

### 4.3 Daily MRR snapshot table (the "fact table")

```sql
CREATE TABLE mrr_snapshots (
  snapshot_date  date PRIMARY KEY,
  list_mrr_cents bigint NOT NULL,
  booked_mrr_cents bigint NOT NULL,
  recognized_mrr_cents bigint NOT NULL,
  active_paid_orgs int NOT NULL,
  trial_orgs int NOT NULL,
  comp_orgs int NOT NULL,
  comp_shadow_mrr_cents bigint NOT NULL,    -- "what comps would bill at"
  new_mrr_cents bigint NOT NULL,            -- additions today
  expansion_mrr_cents bigint NOT NULL,      -- upgrades + seat adds
  contraction_mrr_cents bigint NOT NULL,    -- downgrades
  churned_mrr_cents bigint NOT NULL,        -- cancellations
  reactivated_mrr_cents bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
```

NRR derives directly: `(starting_mrr + expansion - contraction - churn) / starting_mrr`. Marisol asked for NRR; this is where it lives.

---

## 5. Discount + credit accounting rules

### 5.1 Discounts (coupon, promo, annual %)

ASC 606-10-32-32: discounts are a reduction of the transaction price. They reduce *both* booked ARR and recognized revenue proportionally over the service period — they are **not** a marketing expense.

Rules:
- **At sale**: `total_billed_cents` on `deferred_revenue` is **net of discount**. List price is captured separately on `subscription_events.metadata.list_price_cents` for variance reporting.
- **Promo codes valid for N months**: the discount window must be modeled as a separate `deferred_revenue` row OR as a stepped recognition schedule — easier as a step. Worker reads `discount_pct` per period.
- **Permanent annual discount (the 20% off)**: just a smaller `total_billed_cents`. No separate accounting.

### 5.2 Referral credits (issued to existing customers)

This is the trap. Most founders book a referral credit as marketing expense. **It's contra-revenue under ASC 606-10-32-25** because it's consideration payable to a customer.

Rule:
- When a referral credit is issued to org A: insert a row into `credit_grants` (a new table) with `source='referral'`, `value_cents`, `expires_at`.
- When org A applies the credit against an invoice: reduce that invoice's `deferred_revenue.total_billed_cents` by the credit applied. **Do not** book it to a marketing expense GL account.
- Reporting must show "Gross Revenue / Less: Customer Credits Applied / Net Revenue."

```sql
CREATE TABLE credit_grants (
  id              uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  source          text NOT NULL,        -- 'referral' | 'comp' | 'goodwill' | 'promo'
  value_cents     bigint NOT NULL,
  applied_cents   bigint NOT NULL DEFAULT 0,
  expires_at      timestamptz,
  granted_by_user_id uuid,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

### 5.3 Pre-paid credit packs (the $100 → 1000 credits product)

Multi-element arrangement:
- Cash collected day 1 → liability (deferred revenue).
- Each consumed credit → recognized revenue at the per-credit rate.
- **Breakage**: credits that expire unused. ASC 606-10-55-46 to -49: recognize breakage in proportion to the pattern of redemption *only if* you can estimate the breakage rate from history. AcreOS doesn't have history yet → recognize breakage at the moment of expiry only.
- Once 12+ months of redemption data exists, switch to proportional breakage and disclose the change in estimate.

### 5.4 Founder comps / beta accounts

These are NOT revenue. But CFO needs **shadow MRR** — what the comp would bill at list. Surface as `comp_shadow_mrr_cents` on `mrr_snapshots`. Never include in booked/recognized ARR. Never deduct as marketing expense from non-existent revenue.

### 5.5 Refunds — contra-revenue, not expense

ASC 606-10-32-10: variable consideration (refunds) reduces the transaction price. Treatment:
- Full refund within original recognition period: reverse the matching `revenue_recognition` rows by inserting negative-amount rows with `reversed=true`. Update `deferred_revenue.status='voided_refund'`.
- Partial refund: pro-rate; reverse only the unrecognized + the proportional recognized portion.
- Refund of a prior-period invoice: contra-revenue in the *current* period (not a restatement) unless material — disclose to auditors at YE.

---

## 6. Audit-readiness checklist — pre-Series-A

Mark each as Pass / Fail today. Pre-Series-A target = all Pass.

| # | Control | Today | After 2-week sprint |
|---|---|---|---|
| 1 | Single source of pricing truth | **Fail** | Pass |
| 2 | Immutable subscription event ledger | **Fail** | Pass |
| 3 | Deferred revenue table + recognition worker | **Fail** | Pass |
| 4 | Cash → accrual reconciliation report | **Fail** | Pass |
| 5 | Refunds booked as contra-revenue | **Fail** | Pass |
| 6 | Customer credits separate from marketing expense | **Fail** | Pass |
| 7 | Credit-pack breakage policy documented | **Fail** | Pass |
| 8 | Comp accounts flagged with shadow-MRR | **Fail** | Pass |
| 9 | Customer-concentration alert (>15% / >25%) | **Fail** | Pass |
| 10 | Stripe MRR ↔ DB MRR nightly reconcile job | **Fail** | Pass |
| 11 | NRR / GRR / expansion / contraction reportable | **Fail** | Pass |
| 12 | Multi-currency revenue handled (FX-translated at sale, hedged liability) | **Fail** | Deferred (no FX exposure yet) |
| 13 | Sales-tax collected ledger | **Fail** | Deferred to Marisol's tax sprint |
| 14 | All subscription mutations write audit-log entry | **Partial** | Pass |
| 15 | Recognition reversibility (negative-row pattern, no UPDATE) | **N/A** | Pass |
| 16 | Auditor-replayable: any past day's MRR/ARR reproducible from ledger alone | **Fail** | Pass |
| 17 | SOC 2 separation of duties: founder cannot post a recognition entry | n/a | Pass via DB role |

### 6.1 Customer-concentration disclosure (the audit-risk flag)

Every Big-4 audit asks "what % of revenue is from your top customer?" If >10% → disclose by name in the financial statements (concentration risk). At >30% you have a going-concern flag. AcreOS today has no view; an SMB SaaS at AcreOS's stage will commonly have one founder-friend org at 20%+ of MRR and not know.

Implementation: a `v_revenue_concentration` view computing `org_mrr / total_mrr`, alerting via the audit-log when any org crosses 15%. Five lines of SQL plus an alert.

### 6.2 Multi-currency (forward-looking — flagged for the record)

Not blocking series-A while AcreOS is USD-only. When CAD/GBP customers come online:
- Record `currency` on `deferred_revenue` and `fx_rate_at_sale` (locked rate at point of recognition).
- Translate to USD for reporting at month-end at average rate; remeasure liabilities at spot.
- FX gain/loss is a separate income-statement line, not contra-revenue.
- Do not hedge until FX exposure exceeds ~5% of total revenue; not worth the operational overhead.

---

## 7. The 2-week reporting foundation sprint

Two engineers, parallelizable. ROI-ranked.

### Week 1 — ledger + truth

| Day | Task | Owner | Output |
|---|---|---|---|
| 1 | `shared/billing/tier-pricing.ts` single-source pricing module. Delete the six conflicting tables. CI test: every Stripe price ID resolves to this table. | Eng A | Marisol's #1, unblocks everything |
| 1 | Schema migration: `subscription_events`, `deferred_revenue`, `revenue_recognition`, `credit_grants`, `mrr_snapshots`. | Eng B | DDL + drizzle types |
| 2 | Webhook handlers (`webhookHandlers.ts`) write `subscription_events` rows on `customer.subscription.created/updated/deleted` and `invoice.paid`. Idempotency via `stripe_event_id` UNIQUE. | Eng A | Forward-only event capture works |
| 2 | Backfill script: replay last N months of Stripe events into `subscription_events`. | Eng B | Historical reproducibility |
| 3 | `v_org_subscription_current` view + cutover plan. Keep `organizations.subscription_tier` as a denorm cache via trigger. | Eng A | Read-side migration |
| 3 | Recognition worker (`server/jobs/revenueRecognition.ts`), idempotent, daily cron. | Eng B | Deferred-revenue mechanics live |
| 4 | Backfill `deferred_revenue` from Stripe invoices; replay worker over historical months to fill `revenue_recognition`. | Eng B | Historical accrual books |
| 5 | Reconciliation job: nightly `Stripe MRR vs DB MRR` diff; alert on >$50 mismatch. | Eng A | Marisol's audit-trail unblock |

### Week 2 — reporting + controls

| Day | Task | Owner | Output |
|---|---|---|---|
| 6 | `mrr_snapshots` daily cron. Computes new/expansion/contraction/churn/reactivated decomposition. | Eng A | NRR derivable |
| 7 | Refund handling: refund webhook writes negative `revenue_recognition` row, sets `deferred_revenue.status='voided_refund'`. | Eng B | Contra-revenue treatment |
| 7 | `credit_grants` table + referral credit migration off marketing-expense pathway. | Eng A | Customer-credit GAAP fix |
| 8 | Credit-pack breakage policy: expiry job recognizes residual deferred revenue. Document the policy in `/docs/accounting-policies.md`. | Eng B | ASC 606-10-55 compliance |
| 9 | Comp accounts: `comp_reason`, `comp_expires_at` columns on orgs (or as comp `subscription_events`). Shadow-MRR computation. | Eng A | Marisol's CFO question answerable |
| 9 | Customer-concentration view + alert at 15% / 25%. | Eng B | Audit-disclosure ready |
| 10 | `/founder-home` widget: List ARR / Booked ARR / Recognized ARR / Committed ARR + NRR + concentration top-5. Replace the wrong MRR number. | Both | Founder sees real numbers |
| 10 | Documentation: `/docs/accounting-policies.md` (recognition methods, breakage, refund, comp, credits) — what an auditor reads first. | Eng A | Pre-diligence artifact |

**Deliverable at end of week 2:** auditor can ask "what was MRR on March 14?" and the controller runs one SQL query. Auditor asks "show me the deferred-revenue waterfall for Q1." One query. Auditor asks "any customer over 10% of revenue?" View. AcreOS goes from F to a defensible B+ in 10 working days.

The remaining gap to A (full SOC 2 + Stripe Tax + multi-currency + COGS-per-customer) is a quarter of work and overlaps with Marisol's broader sprint and Naima's observability buildout. Do not attempt it in this sprint; you will not finish and the foundation work will suffer.

---

## Bottom line

Marisol diagnosed it correctly: the plumbing is better than expected, the accounting layer is at pre-seed maturity. Where I extend her: **the fix is not "track more numbers," it's "add the two missing tables — `subscription_events` and `deferred_revenue` — and recompute every metric off them.** Once those exist as immutable ledgers, NRR, ARR breakdown, customer concentration, refund treatment, comp shadow-MRR, and credit accounting all fall out as views. Without them, every metric AcreOS reports is a point-in-time guess that cannot survive an auditor saying "show me last March."

Two weeks. Two engineers. Series-A-defensible.

— Hassiba
