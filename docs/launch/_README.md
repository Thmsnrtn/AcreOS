# AcreOS Customer Launch Kit

**Purpose:** The complete playbook for friendly-customer onboarding (first 5 paying customers, May–June 2026).

**Context:** AcreOS finished a rock-solid infrastructure sprint (21/24 P0 items + RS-1..RS-7 security sweep). The next 90 days measure whether that infrastructure converts to real business metrics: Net Revenue Retention ≥110%, Time-to-Value ≤4:00, Deal-Room Loop Conversion ≥3%, Customer Concentration <20%, and Founder-Letter Cadence unbroken for 24 weeks.

This kit is concrete, not theoretical. Every template, checklist, and script has specific file paths (e.g., `/api/founder/financials/nrr`) and endpoint names so you can execute immediately.

---

## How to Use This Kit

1. **Before first call:** Read docs 01 + 02 + 04. Know your pricing pitch and your onboarding script.
2. **On day 1 of customer #1:** Follow doc 05 (first 30 days). This is your playbook hour-by-hour.
3. **Daily/weekly/monthly:** Follow doc 03 (telemetry checklist). These are your gates.
4. **Throughout launch:** Keep doc 02 (pricing playbook) next to you for objection handling.

**Reading order:** `_README.md` → `01-friendly-customer-onboarding-script.md` → `02-pricing-conversation-playbook.md` → `04-intro-email-templates.md` → `05-first-30-days-runbook.md` → `03-telemetry-watch-checklist.md`.

---

## The 5 Verification Gates

These are your non-negotiable metrics by three horizons. If you hit all five by each date, you have proof that the product is working.

### Gate 1: Time-to-Aha ≤4:00 (by 2026-06-08)

**Measurement page:** `/api/founder/activation/time-to-aha?groupby=persona`

**What it is:** Minutes from signup to first artifact (Pax draft, scan result, or note yield calculation).

**Why it matters:** If onboarding is slow, customers churn in week 1 before feeling value. If it's fast, they stick.

**Your job:** Ship the persona-aware checklist (doc 05 Day 1). Measure daily. If P50 is still >4:00 by June 8, diagnose which step has drop-off (via `activation_events` table).

**Current baseline:** 7:30 (passive read of scan results). **Target:** ≤4:00 for all personas.

---

### Gate 2: NRR ≥110% (by 2026-08-08)

**Measurement page:** `/api/founder/financials/nrr` (computed monthly)

**What it is:** Net Revenue Retention = (MRR_end_of_period + upgrades + expansions) / (MRR_start_of_period). A score ≥110% means existing customers are spending more this month than last month (growth from existing base).

**Why it matters:** If NRR <110%, you're losing more revenue to churn/downgrade than you're gaining from expansion. That's a death spiral at scale.

**Your job:** 
- Track weekly via `/api/founder/financials/nrr` (updated every Monday).
- If it dips below 110%: audit the cohort (which customers churned? when? why?).
- Log churn reasons in `customer_churn_taxonomy` table (Camila spec).
- Call churned customers within 24h to understand why.

**Current:** Too early (need 4+ weeks of history). **Target:** ≥110% for the first full cohort by 2026-08-08.

---

### Gate 3: Deal-Room Loop Conversion ≥3% (by 2026-08-08)

**Measurement page:** `/api/founder/deal-room-loop` (weekly waterfall)

**What it is:** Of all deal-rooms shared (unauthenticated link), what % convert to a signup → aha moment → D7 return?

**Why it matters:** This is your growth loop. If it's <3%, it's not a loop; it's a feature. If it's ≥3%, it's your top-of-funnel.

**Your job:**
- Measure weekly (Monday morning, via `/api/founder/deal-room-loop`).
- Don't hard-sell the loop until it's ≥3%. If it's <1%, fix UX (CTA copy, signup speed, onboarding for loop-sourced users).
- If it's 1–2%, optimize (better copy, faster flow, better aha for this cohort).
- Once it's 3%+, fund paid acquisition.

**Current:** Not yet measurable (only 5 customers). **Target:** ≥3% by 2026-08-08.

---

### Gate 4: Customer Concentration <20% (by 2026-08-08)

**Measurement page:** `/founder/financials` (Section 2: Top-5 customers by MRR)

**What it is:** What % of your MRR comes from your single largest customer? If >20%, you have customer concentration risk (one customer leaving = 20% revenue drop).

**Why it matters:** Concentration kills venture narratives ("if one customer leaves, your ARR collapses"). But at 5 customers, some concentration is inevitable.

**Your job:**
- Check daily via `/founder-home` (concentration alert tile).
- If any customer >20%: flag in your daily scan. Schedule a retention call.
- Monitor via weekly `/founder/financials` (Section 2: Top-5 MRR breakdown).
- As you add customer #2–5, concentration should naturally decline (assuming even spread).

**Current:** ~20% (customer #1 is likely your largest). **Target:** <20% by 2026-08-08 (achieved by getting to 5+ customers with ~$100 MRR each).

---

### Gate 5: Founder-Letter Cadence 24 Weeks Unbroken (by 2026-11-08)

**Measurement page:** `/api/founder/community-letters/archive` (published letters + dates)

**What it is:** You commit to writing a weekly founder letter (500+ words) for 24 consecutive weeks. Archive is public. No gaps >8 days.

**Why it matters:** Founder-led community is the SMB acquisition flywheel (Diego spec). If you stop writing after 8 weeks, the community dies.

**Your job:**
- Set a standing calendar reminder: "Founder letter due Friday 5pm PT."
- Write 1 hour / week (Thursday evening or Friday morning).
- If you miss a week, log the reason (fundraising, emergency, travel). By month-end, you have 4–5 letters published.
- Build the habit early so by November, you're on week 24 without breaking.

**Current:** Not yet started. **Target:** 24 consecutive weeks by 2026-11-08.

---

## Quick Reference: Each Doc's Payload

| Doc | Audience | Length | What You'll Use It For |
|-----|----------|--------|----------------------|
| `01-friendly-customer-onboarding-script.md` | Founder | 30 min call script | First 5 calls: walk a customer through their wedge, get them to commit to 14-day trial, handle pricing objections |
| `02-pricing-conversation-playbook.md` | Founder / Sales | When they ask "how much?" | Tier structure (Solo $49, Operator $99, Pro $199), vertical-pack pricing, founder-comp accounts, "why $49 for a spreadsheet?" scripts |
| `03-telemetry-watch-checklist.md` | Founder | Daily 5min + weekly 15min + monthly 1hr | Monitor gates: NRR, concentration, deal-room loop, D30 verdicts, community-letter cadence, time-to-aha |
| `04-intro-email-templates.md` | Founder / Sales | When you need to reach out | 5 templates: cold outreach, warm referral, wedge customer, post-call follow-up, 14-day no-response re-engage |
| `05-first-30-days-runbook.md` | Founder | Day 1–30 of each customer | Day-by-day playbook: provision + welcome, dormancy check, NPS survey, D14 call, D30 verdict |

---

## File Locations (Absolute Paths)

```
docs/launch/
├── _README.md (this file)
├── 01-friendly-customer-onboarding-script.md
├── 02-pricing-conversation-playbook.md
├── 03-telemetry-watch-checklist.md
├── 04-intro-email-templates.md
└── 05-first-30-days-runbook.md
```

---

## Key Endpoints You'll Reference

**Authentication & User:**
- `/api/organizations/:orgId/settings` — Org settings (persona, region, billing).
- `/api/founder/executive-dashboard` — Org count, signup breakdown.

**Activation & Engagement:**
- `/api/founder/activation/time-to-aha` — Time from signup to aha (per persona).
- `/api/organizations/:orgId/today` — Daily activity for a customer org.
- `/api/organizations/:orgId/activation-summary?period=Xd` — Logins, features used, artifacts.

**Revenue & Metrics:**
- `/api/founder/financials/nrr` — Net Revenue Retention (monthly).
- `/api/founder/financials/mrr` — Monthly Recurring Revenue (daily history).
- `/api/founder/financials/top-n-customers?n=5` — Top 5 customers by MRR.
- `/api/founder/financials/cogs?category=ai_calls` — Cost of Goods Sold per customer.
- `/api/founder/financials/churn-detail?period=7d` — Customers who churned.
- `/api/founder/financials/expansion-detail?period=7d` — Customers who upgraded.

**D30 Verdicts:**
- `/api/founder/financials/d30-verdicts?groupby=cohort_week` — Retention by signup cohort.

**Growth Loops:**
- `/api/founder/deal-room-loop` — Deal-room conversion funnel (weekly).

**Community:**
- `/api/founder/community-letters/archive` — Published letters + dates.

**Health & NPS:**
- `server/services/customerHealthScoring.ts:recomputeHealthScore(orgId)` — Customer health score.
- `server/services/onboardingAutonomy.ts:sendScheduledEmail()` — Automated emails (D0, D3, D7, D14, D30).

---

## 90-Day Narrative (What to Tell Your Board)

**By 2026-06-08:**
- ✅ Persona-aware checklist live. Time-to-aha down to ≤4:00 (from 7:30).
- ✅ 5 friendly customers launched (all on free trial, measuring D7 NPS).
- ✅ Pricing conversation tested (3/5 converted to paid, 2/5 evaluating).
- ✅ D0, D3, D7, D14 emails shipping. D30 verdict logic ready.

**By 2026-08-08:**
- ✅ 5 customers live (mix of paid + trial).
- ✅ NRR ≥110% measured for first 4 weeks (or trending there).
- ✅ Concentration <20% (verified via top-5 breakdown).
- ✅ Deal-room loop measured weekly (even if <3%, you're tracking it).
- ✅ 8 weekly founder letters published (on pace for 24-week unbroken by Nov).

**By 2026-11-08:**
- ✅ 10–15 paying customers (MRR $500–$1K).
- ✅ NRR ≥110% sustained for 3+ months.
- ✅ Deal-room loop ≥3% (growth loop is live).
- ✅ 24 consecutive weeks of founder letters (community cadence unbroken).
- ✅ D30 activation verdict: ≥40% of cohorts are "active" (retention is working).

---

## What Success Looks Like (Day 90)

You have 5+ paying customers. At least one says: *"I can't imagine going back to spreadsheets."* Your NRR is 110%+ (meaning: expansions > churn). You've written 8 founder letters and you're in the rhythm. The deal-room loop is measured weekly (even if it's not yet 3%). When you call a customer, they're not surprised — they were expecting your call (founder voice is working).

You're not at scale. You're not at product-market fit. But you've proved one thing: the infrastructure works, the onboarding converts, the product keeps people, and the founder is in the room.

---

## What to Do If You Hit a Gate Problem

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Time-to-aha still >4:00 | Persona-aware checklist not live, or personas not set correctly | Ship checklist by June 8. Audit `onboarding-v2.tsx` persona logic. |
| NRR <110% | Customers are churning or downgrading faster than expanding | Call churned customers. Log churn reasons. Identify if it's activation (they never got aha) or value (they got aha but it wasn't deep enough). |
| Concentration >20% | One customer is too big relative to your base | This is fine at 5 customers. As you add #2–5, it naturally declines. If concerned, call the big customer to ensure they're happy. |
| Deal-room loop stuck at <1% | UX is broken or the viral signal isn't clear | Check `/deals` unauthenticated view (does CTA say "join AcreOS"?). Audit signup flow for loop-sourced users. Fast-track onboarding. |
| Founder letters missed week | Burnout, travel, or fundraising | Log it. Skip if critical. But commit: no gaps >8 days. By week 20, catch back up if you miss 1 week. |

---

**Version:** 2026-05-08  
**Owner:** Founder  
**Last Updated:** 2026-05-08 (synthesis release)

