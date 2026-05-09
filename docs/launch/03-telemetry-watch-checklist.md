# Telemetry Watch Checklist — Daily/Weekly/Monthly Founder Duties

**Audience:** Founder.  
**Context:** You're launching with 5 customers. These are the gates to hit by 2026-08-08 (90d). Monitor them obsessively.  
**Duration:** 5 min/day, 15 min/week, 1 hour/month. Set calendar reminders.

---

## Daily Scan (5 minutes)

**Time: 9am PT, before anything else.**

Open `/founder-home` (your dashboard). You should see:

- **Today's headline tiles:**
  - MRR (current month revenue)
  - Customer count
  - Churn alert (if any customer marked at_risk in the last 24h)
  - Concentration alert (if any single customer > 20% of MRR)

### Checks (in order):

1. **Concentration alert triggered?** (> 20% of MRR from one customer)
   - If yes: note org name. Schedule a call for today / tomorrow.
   - Endpoint: `/founder-home` (concentration % computed on-load from `subscription_events` → rollup in `organizations` table).
   - Alert threshold: set in `server/services/financialAggregator.ts:concentration_threshold = 0.20`.

2. **Churn risk flag?** (customer health score dropped >10 points in 24h)
   - If yes: open their org profile (`/founder-home` → click org name).
   - Check `/today` activity: did they log in yesterday? Are they stuck on a feature?
   - Endpoint: health score computed by `server/services/customerHealthScoring.ts:getCustomerHealth(orgId)`.

3. **MRR delta** (did MRR move >5% up or down from yesterday)?
   - If down: audit `subscription_events` table for churn/downgrades.
   - Endpoint: `/api/founder/financials/mrr` (returns current month + daily history).
   - SQL: `SELECT SUM(amount_cents) / 100 FROM subscription_events WHERE event_date >= TODAY() AND event_type IN ('new_subscription', 'upgrade', 'downgrade', 'churn')`.

4. **New signup?** Check if org count incremented.
   - If yes: open `/founder-home` → sort by `created_at` desc → call them today or tomorrow.
   - Endpoint: `/api/founder/executive-dashboard` (org count + onboarding status breakdown).

**If anything is red, spend 5 more minutes now.** Otherwise, done.

---

## Weekly Review (15 minutes)

**Time: Every Monday 10am PT.**

Open `/founder/financials`. This is your growth dashboard. You should see:

### Section 1: Revenue Summary

| Metric | Endpoint | Gate? | Target by 2026-08-08 |
|--------|----------|-------|-----|
| NRR (Net Revenue Retention) | `/api/founder/financials/nrr` (computed monthly) | YES | ≥110% |
| GRR (Gross Revenue Retention) | `/api/founder/financials/grr` | Informational | ≥70% |
| MRR (Monthly Recurring Revenue) | `/api/founder/financials/mrr` | Informational | $500+ |
| ARR | Computed: MRR × 12 | Informational | $6K+ |

**Action if NRR < 110%:** You're losing more than you're expanding. Audit the cohort (which customers downgraded? when? why?). Log findings in `your founder notes` table.

### Section 2: Top 5 Customers by MRR

| Rank | Customer | MRR | % of Total | Trend |
|------|----------|-----|-----------|-------|

**Endpoint:** `/api/founder/financials/top-n-customers?n=5` (returns MRR %, cohort, signup_date, last_expansion_date).

**Action if any customer > 20%:** Flag in your daily check (above). Schedule a retention call.

### Section 3: COGS Per Customer (Costs of Goods Sold)

| Metric | Endpoint | What it measures |
|--------|----------|------------------|
| AI call costs per org | `/api/founder/financials/cogs?category=ai_calls` | Sum of `server/services/autonomousHealthMonitor.ts:callCost` per org |
| Data costs per org | `/api/founder/financials/cogs?category=data_costs` | County-scan API, comps data, title data per org |
| Hosting costs per org | `/api/founder/financials/cogs?category=hosting_costs` | Pro-rata Fly.io + database per org |
| **Total COGS per org** | Aggregated | Should be < 30% of MRR |

**Action if COGS > 30% of MRR:** You're burning cash on this customer. Audit why (are they running scans every 6 hours? Are they generating 1000 Pax drafts/month?). Log in `your founder notes` table ("customer XYZ has high AI usage; understand why").

### Section 4: Churn & Expansion This Week

| Metric | Source | Action if red |
|--------|--------|---------------|
| Customers who churned this week | `subscription_events` WHERE `event_type = 'churn'` AND `created_at >= LAST WEEK` | Call them same day if possible ("What happened?"). Log in churn taxonomy (see Camila memo). |
| Customers who expanded (upgraded tier or added pack) | `subscription_events` WHERE `event_type IN ('upgrade', 'pack_added')` AND `created_at >= LAST WEEK` | Send a 1-line Slack note thanking them. This is signal that the product is working. |
| Customers who downgraded | `subscription_events` WHERE `event_type = 'downgrade'` AND `created_at >= LAST WEEK` | Call them within 48h ("Why downgrade? Can we fix it?"). |

**Endpoints:** `/api/founder/financials/churn-detail?period=7d`, `/api/founder/financials/expansion-detail?period=7d`.

### Section 5: Verification Gate Progress

By 2026-08-08 you need:

- ✅ NRR ≥110% measured for the past 4 weeks (scroll to "Historical NRR")
- ✅ Customer concentration <20% (check Section 2 above)
- ✅ Deal-room loop conversion ≥3% (see Monthly section below)
- ✅ Deal-room loop is **measured weekly** (you're tracking it, not guessing)

**Current status:** Record in a hidden Slack thread (#founder-gates) each Monday. By month-end, you have a 4-week trend.

---

## Monthly Review (1 hour)

**Time: First Tuesday of every month, 2pm PT.**

This is your full-system health check. You're auditing: activation, retention, deal-room loop, community signal.

### Section 1: D30 Verdict Cohort Analysis

**Context:** Every customer lands in D30 with a verdict (active / at_risk / churned). This is your cohort-level retention signal.

| Cohort | Signups | D30 Active | D30 At-Risk | D30 Churned | Retention % |
|--------|---------|-----------|-----------|-----------|------------|
| 2026-04-XX | 2 | 2 | 0 | 0 | 100% |
| 2026-05-XX | 3 | 2 | 1 | 0 | 67% |
| 2026-06-XX | (TBD) | | | | |

**Endpoint:** `SQL on onboarding_journeys (post-pilot endpoint TBD)` (returns signup_week, active_count, at_risk_count, churned_count).

**SQL query (manual):**
```sql
SELECT
  DATE_TRUNC('week', o.created_at) as cohort_week,
  COUNT(DISTINCT o.id) as signups,
  COUNT(DISTINCT CASE WHEN d.verdict = 'active' THEN o.id END) as d30_active,
  COUNT(DISTINCT CASE WHEN d.verdict = 'at_risk' THEN o.id END) as d30_at_risk,
  COUNT(DISTINCT CASE WHEN d.verdict = 'churned' THEN o.id END) as d30_churned
FROM organizations o
LEFT JOIN onboarding_journeys oj ON o.id = oj.organization_id
WHERE o.created_at >= NOW() - INTERVAL '12 weeks'
GROUP BY DATE_TRUNC('week', o.created_at)
ORDER BY cohort_week DESC;
```

**Gate by 2026-08-08:** D30 active retention ≥40% for any cohort with N≥5 customers. (Camila spec: FW-CAMILA-1 shipped this logic in email branching; measure the input signal.)

**Action:** If a cohort is <40% retention, audit why. Call the churned customers. Log in churn taxonomy.

### Section 2: Deal-Room Growth Loop Conversion

**Context:** Mireille's metric. You measure: shares → signups → aha → retention.

**Endpoint:** `direct query of deal_rooms (waterfall endpoint TBD)` (returns weekly waterfall).

| Week | Deal-Rooms Shared | Shares → Signup | Signup → Aha | Aha → D7 Return | % Converting (D7 return / shared) |
|------|------------------|-----------------|-------------|-----------------|--------------------------------|
| 2026-05-06..05-12 | 2 | 0 | 0 | 0 | 0% |
| 2026-05-13..05-19 | 5 | 1 | 1 | 1 | 20% |
| 2026-05-20..05-26 | 8 | 1 | 1 | 0 | 0% |

**SQL query (manual):**
```sql
SELECT
  DATE_TRUNC('week', d.shared_at) as week,
  COUNT(DISTINCT d.id) as deals_shared,
  COUNT(DISTINCT CASE WHEN s.created_at >= d.shared_at THEN s.id END) as new_signups_from_share,
  COUNT(DISTINCT CASE WHEN a.aha_event_id IS NOT NULL THEN s.id END) as signups_with_aha,
  COUNT(DISTINCT CASE WHEN l.last_login >= a.completed_at + INTERVAL '7 days' THEN s.id END) as d7_return
FROM deal_rooms d
LEFT JOIN organizations s ON d.share_token = s.signup_source_token
LEFT JOIN activation_events a ON s.id = a.org_id AND a.event = 'instant_hunt_completed'
LEFT JOIN org_logins l ON s.id = l.org_id
WHERE d.shared_at >= NOW() - INTERVAL '12 weeks'
GROUP BY DATE_TRUNC('week', d.shared_at)
ORDER BY week DESC;
```

**Gate by 2026-08-08:** Deal-room loop conversion ≥3% (meaning: of all deal-rooms shared, ≥3% convert to a paying customer at D7). Current: too early to measure (only 5 customers).

**Action:** Don't hard-sell the loop until it's 3%. If it's <1%, fix the UX (CTA copy, signup flow, aha funnel). If it's 1–2%, optimize (better CTA, faster signup, better onboarding for loop-sourced users). Once 3%+, fund acquisition.

### Section 3: Community Letter Cadence (24-week unbroken target)

**Context:** Diego's metric. Founder-letter shipped in FW-DIEGO-1. By 2026-11-08 (180d), you need 24 weeks of unbroken founder-letters in the archive.

**Endpoint:** `/api/letters` (returns list of published letters + dates).

| Week | Letter Published? | Word Count | Themes | Emoji |
|------|------------------|-----------|--------|-------|
| 2026-05-02 | ✅ | 847 | Shipping RS-1..RS-7, persona-aware aha | 🚀 |
| 2026-05-09 | ✅ | 612 | D30 verdict branching, customer call 1 | 🎯 |
| 2026-05-16 | ❌ | — | [Conflict or skip?] | — |

**SQL query (manual):**
```sql
SELECT
  DATE_TRUNC('week', published_at) as week,
  published_at,
  LENGTH(content) as word_count,
  array_agg(tag) as themes
FROM community_letters
WHERE published_at >= NOW() - INTERVAL '24 weeks'
GROUP BY DATE_TRUNC('week', published_at)
ORDER BY week DESC;
```

**Gate by 2026-11-08:** 24 consecutive weeks with ≥1 letter per week. (Minimum 500 words; no gaps > 8 days.)

**Action:** 
- Set a standing calendar reminder: "Founder letter due Friday 5pm PT."
- Commit: 1 hour / week to write (Thursday evening or Friday morning).
- If you miss a week, note the reason (fundraising, emergency, travel).
- By month-end, have 4–5 letters published. Show the archive in board updates.

### Section 4: Time-to-Aha Measurement

**Context:** Yuna's metric. By 2026-06-08, time-to-aha should be ≤4:00 (down from 7:30 baseline).

**Endpoint:** `SQL on activation_events table (endpoint TBD)` (returns percentiles 50th/75th/95th for each persona).

| Persona | P50 TTA | P75 TTA | P95 TTA | Gate (≤4:00?) |
|---------|---------|---------|---------|---------------|
| land_investor | 3:45 | 5:30 | 8:15 | ✅ |
| note_investor | 6:12 | 9:40 | 14:20 | ❌ |
| wholesaler | (n<1) | — | — | ⏳ |

**SQL query (manual):**
```sql
SELECT
  o.persona,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.aha_timestamp - o.created_at)) / 60) as p50_minutes,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.aha_timestamp - o.created_at)) / 60) as p75_minutes,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (a.aha_timestamp - o.created_at)) / 60) as p95_minutes
FROM organizations o
LEFT JOIN activation_events a ON o.id = a.org_id AND a.event IN ('instant_hunt_completed', 'first_pax_draft', 'first_note_uploaded')
WHERE a.aha_timestamp IS NOT NULL AND o.created_at >= NOW() - INTERVAL '6 weeks'
GROUP BY o.persona;
```

**Gate by 2026-06-08:** P50 for all active personas ≤4:00.

**Action:** If a persona is stuck >4:00, audit the persona-aware checklist (did you ship it? Is it working?). Identify the step where people drop off (using `activation_events` table). Fix UX or copy.

### Section 5: Customer Interview Synthesis

By month-end, you should have:
- 3–4 weekly founder calls done
- 3–4 interviews logged in `your founder notes` table
- 1 churn-reason logged in `founder churn-notes` table (if applicable)

**Endpoint:** None (manual table). Query:
```sql
SELECT
  customer_name,
  vertical,
  wedge_articulated,
  feedback_one_line,
  stumbling_block
FROM your founder notes
WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
ORDER BY created_at DESC;
```

**Action:** Cluster themes. If 3+ customers mention the same problem ("offer-letter copy is generic," "no bulk-export feature," "payment tracking is confusing"), write a Slack thread with the raw quotes and assign a sprint item.

---

## Verification Gates Scorecard

**By 2026-06-08 (30d):**
- [ ] Time-to-aha P50 ≤4:00 for all personas (measured daily via `SQL on activation_events`)
- [ ] Persona-aware checklist live (check `/today` for new user → should see 3-item persona-specific list)
- [ ] D0, D3, D7, D14, D30 emails shipping (audit `onboardingAutonomy.ts:sweepAndFireDueSteps()` cron + check customer inboxes manually for first 5)

**By 2026-08-08 (90d):**
- [ ] NRR ≥110% (measured via `/api/founder/financials/nrr` for past 4 weeks)
- [ ] Customer concentration <20% (measured via `/founder/financials` Section 2)
- [ ] Deal-room loop ≥3% conversion (measured via `direct query of deal_rooms (waterfall endpoint TBD)` weekly)
- [ ] D30 activation verdict ≥40% active rate for cohorts N≥5 (measured via SQL on `onboarding_journeys.activationStatus`)

**By 2026-11-08 (180d):**
- [ ] Community-letter cadence 24 weeks unbroken (measured via `/api/letters`)
- [ ] NPS micro-survey D7 wired + response rate ≥40% (measured via `/api/founder/activation/nps?days=7`)

---

## Slack Reminder Bot (DIY Setup)

Set these recurring Slack reminders in your `#founder` channel:

- **Daily 9am:** "Founder, check `/founder-home` for concentration + churn + MRR delta. 5 min."
- **Weekly Monday 10am:** "Time for `/founder/financials` deep-dive. 15 min. NRR + COGS + top-5 + churn."
- **Monthly (1st Tuesday 2pm):** "Full telemetry review: D30 verdicts, deal-room loop, community letters, time-to-aha. 1 hour."

**Implementation:** Use `/slash` commands or Workflow Builder to queue these.

---

**Version:** 2026-05-08  
**Owner:** Founder  
**Dependency:** `/founder/financials` live, `/founder-home` concentration alert live, D30 verdict branching live by 2026-06-08, community-letters archive live by 2026-06-08

