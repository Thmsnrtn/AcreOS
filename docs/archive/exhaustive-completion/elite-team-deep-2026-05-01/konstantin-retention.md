# Konstantin Arseniev — Retention Engineering Audit, AcreOS

**Lens:** 6 yrs retention engineering at Notion + Loom. The bias I bring: at Series A, retention is the only metric that matters. Acquisition fixes the present month; expansion fixes the next quarter; **retention compounds for the life of the company**. A 5-pt lift in Month-3 retention is worth more than a 30% lift in top-of-funnel because it multiplies every dollar of CAC for every cohort going forward. So I read AcreOS through one question: **does the product create a daily reason to come back, and does the company know within 14 days when it's losing someone?**

I read Camila's CS audit (D1/D7/D30 arc, two parallel health systems, no email transport, no win-back) and Marisol's CFO audit (NRR not on `/founder-home`, six conflicting tier tables, no cohort-decomposed expansion/contraction). I also looked at `server/services/churnEngine.ts`, `cohortAnalysis.ts`, `customerHealthScoring.ts`, and `client/src/pages/cohort-analysis.tsx`.

---

## 1. One-line verdict

Retention readiness: **machinery for diagnosis exists, almost nothing for *intervention or measurement* — AcreOS can compute a churn-risk score nightly but it cannot tell you what D30 retention was for the March cohort, what daily action correlates with 12-month survival, or how many of last quarter's churners would respond to a win-back email** — and until those three are answered the founder is flying retention by feel, which at Series A is the single most expensive feel in SaaS.

---

## 2. Cohort-tracking infrastructure — what's needed

**What exists:**
- `cohortAnalysis.ts` service (signup-month buckets, basic survival).
- `cohort-analysis.tsx` page surfaced under founder area.
- `churn_risk_scores` table + nightly recompute in `churnEngine.ts:296`.
- `nps_responses` table (no UI surfaces it — Camila flagged).

**What's broken / missing for actual cohort retention:**

1. **No standardized cohort definition.** Cohorts should be keyed by `signup_week` (ISO week) for early-stage — month-buckets are too coarse when you have 30 customers/month. After 200 paying orgs, switch to `signup_month`.

2. **No retention-event ledger.** Retention is not "did they log in" — it's "did they hit a *retention-defining action*." For AcreOS, the action is **morning briefing engaged** (reviewed ≥1 lead from `/today` overnight queue). That event is computable but not stored as a discrete `retention_events` row.

3. **No D-N retention SQL.** The canonical SaaS retention query —
   ```
   for each cohort C:
     denominator = orgs in C
     numerator(D) = orgs in C with retention_event in [signup+D-3, signup+D+3]
     retention(D) = numerator(D) / denominator
   ```
   — isn't implemented. `cohortAnalysis.ts` tracks revenue retention loosely; user retention (the leading indicator) isn't there.

4. **No cohort-comparison API.** Compare any two cohorts on D7/D30/D90/D365 retention curves. Requires the events ledger above + a `/api/founder/cohort-retention?metric=user|revenue&days=7,30,90,365` endpoint.

5. **No churn-reason taxonomy persisted.** Cancellation surveys exist (Camila) but the categorical reason isn't structured (`pricing | missing_feature | wrong_fit | competitor | timing | inactive_user`). Without that, win-back targeting is impossible.

**Required net-new schema (3-day build):**
```
retention_events (org_id, user_id, event_type, occurred_at, metadata_jsonb)
  -- event_type: signup, first_scan, first_lead_owned, first_artifact,
  --   morning_briefing_engaged, weekly_active, monthly_active

cohort_assignments (org_id, cohort_week, cohort_month, signup_at)

churn_reasons (org_id, reason_category, reason_text, churned_at, source)
  -- source: in_product_survey | win_back_reply | sophie_inferred | founder_call

winback_attempts (org_id, attempt_n, sent_at, opened_at, replied_at,
                  reactivated_at, channel)
```

---

## 3. Aha-moment + habit triggers — top-5 to instrument

The Notion lesson: **users who edit ≥1 doc/week in their first 4 weeks have 5× higher 12-month retention than those who don't.** That's the only kind of insight that matters. AcreOS needs the same single-action correlate, instrumented and surfaced.

**Hypothesis ranking — the 5 daily/weekly actions to instrument and watch:**

| # | Action | Hypothesis | How to test |
|---|---|---|---|
| 1 | **Morning-briefing engagement** (opened `/today` AND clicked ≥1 lead between 6am-11am local, ≥3 days/week) | The habit-forming action. If they make AcreOS the first 5 minutes of their workday, they keep paying forever. | Track `morning_briefing_engaged` event; correlate with D90 + D365 retention |
| 2 | **First import within 48hr of signup** | Camila's "irreversibility" moment — once their lead list is in AcreOS, switching cost is real. | `first_import_at - signup_at < 48h`; compare D30 retention |
| 3 | **≥3 distinct features touched in week 1** | Single-feature users churn at 3x rate (industry norm); commodity-substitutable. | Distinct feature-event count week 1; compare D90 |
| 4 | **First Pax artifact generated** (offer letter / comp report / outreach) | Identity-shift moment — they've used the AI to produce something they'd otherwise have done themselves. | `first_artifact_generated` event; compare D60 |
| 5 | **Weekly cadence sustained for 4 consecutive weeks** | The "habit lock" threshold — once 4 weeks are in, the brain has folded AcreOS into the workweek. | `weekly_active` for 4 consecutive ISO weeks post-signup; 70%+ of these survive year 1 in healthy SaaS |

**The leading-indicator action — bet:** **#1 (morning-briefing engagement, ≥3 days in week 2)**. This is the *output* of every other thing AcreOS does well. If they don't open the briefing, the overnight scans don't matter, the agents don't matter, the dashboard doesn't matter. If they do, retention is almost mechanical.

**Instrumentation requirement:** every one of these 5 events must write a `retention_events` row, regardless of whether any analytics tool also captures it. **Owning the event ledger in your own DB is the difference between answering this question in 10 seconds and waiting 3 days for a data person.**

---

## 4. Power-user identification

Camila proposed `/admin/power-users`. I'd extend it with **predictive-scoring**, not just reactive-listing.

**The model (logistic regression, ~50 lines of code, no ML platform required):**
```
P(survives_12mo) = sigmoid(
    1.4 * morning_briefing_streak_w2
  + 1.1 * first_import_within_48h
  + 0.9 * features_touched_w1
  + 0.7 * first_artifact_w1
  + 0.6 * weekly_active_w4_consecutive
  - 0.4 * support_tickets_w1
  - 0.3 * payment_failures
)
```

Train weekly on actual retention outcomes from cohorts ≥365 days old. Surface `predicted_12mo_survival` per org on `/admin/power-users` and on `/founder-home`. **The number to act on: orgs scoring <40% in week 2.** Those are the saveable losses; week 2 is the last cheap intervention window.

**Cluster output to surface to founder:**
- **Power cluster:** who they are, what they share (per Camila's Sophie-Friday-digest pattern).
- **At-risk cluster:** P<40% at day 14, what feature they *didn't* touch that the power cluster did. **This is the product-roadmap input** — the missing onboarding touch that gates retention.

---

## 5. Pre-churn intervention design — spotting it 14 days early

Camila's 4-tier ladder (5d/10d/14d/21d/30d) is right but reactive — it triggers on *days-since-login*. The real predictor is **rate-of-change in retention-event frequency**, not absolute days.

**The earlier signal: declining-week-on-week event rate.**

```
weekly_event_rate(org, week) = count(retention_events in week)
trend = weekly_event_rate(now-1) / avg(weekly_event_rate(now-4..now-2))

if trend < 0.5 AND health_score > 60:
   fire "fading" intervention 14 days before they'd hit "5 days no login"
```

**Why this matters:** by the time a user has gone 5 days without logging in, they've already mentally churned. By the time they're at 14 days, they've replaced AcreOS in their workflow. Catching the *rate decay* in week 3 of decline — when they're still showing up but less often — is the only intervention window where you save them cheaply.

**The 4-stage early ladder (proposed, augments Camila's):**

| Trigger | Window | Action | Channel |
|---|---|---|---|
| `trend < 0.7` for 2 consecutive weeks | Day -28 to -21 from likely churn | Pax in-product nudge: "Want me to spotlight what's most important this week?" — re-personalize the briefing | In-product |
| `trend < 0.5` AND health 50-70 | Day -21 to -14 | Email: "We noticed your scans are running but you're not opening them — anything we can fix?" + 1-click reply taxonomy (too noisy / not relevant / too busy / other) | Email |
| `trend < 0.3` | Day -14 to -7 | Sophie outreach: "15-min call?" — Calendly link, real human (Thomas pre-50, then Sophie-screened) | Email + call |
| Stopped + low health | Day 0 — likely churn imminent | Founder personal note + retention offer (downgrade not cancel; pause-not-cancel) | Founder direct |

**The "saving the saveable" math:** in healthy B2B SaaS, ~40% of users showing trend<0.5 at day -21 can be saved with one well-timed intervention. ~10% of users at day 0 can be saved. **Catching them 21 days early is 4× cheaper.** Build the trend computation; everything else is templates.

---

## 6. Win-back program design — 50% comeback rate

Camila proposed 5 touches over 90 days. The 50% reactivation benchmark requires **segmenting by churn reason** — sending the same sequence to "wrong fit" and "missing feature" wastes both.

**Win-back segmentation (depends on §2's `churn_reasons` taxonomy):**

| Reason | Win-back probability | Sequence |
|---|---|---|
| `pricing` | 35-45% | T+0 empathy, T+14 discount (50% off 3 months), T+45 plan-options email |
| `missing_feature` | 50-60% | T+0 empathy + capture feature, T+30 ship-update email IF feature shipped, T+60 personalized "we built what you asked for" |
| `wrong_fit` | 5-10% | T+0 empathy only — don't burn cycles |
| `competitor` | 25-30% | T+0 empathy + capture which competitor, T+30 differentiation email, T+90 "have they raised prices yet?" |
| `timing` | 60-70% | T+0 "we'll keep your data warm 90d", T+45 "season changed, want to come back?", T+90 final ping |
| `inactive_user` | 10-15% | T+0 "what would have made this stick?", T+30 simplified onboarding offer |

**The single biggest lever:** the `missing_feature → ship-update` email at T+30. If you've actually shipped the feature, this routinely returns 60%+ of those churners. Requires (a) feature requests from cancellation survey logged into `feature_requests` table, (b) when feature ships, query who asked and email them. Build effort: 1 day for the join + email template. Tie shipping to the win-back automatically.

**Reactivation tracking surface:** `winback_attempts` table (per Camila) plus a `/admin/winback-rate` view: by-segment reactivation rate, time-to-reactivation, MRR recovered. Number-on-the-wall metric: **% of last quarter's churners reactivated within 90 days.** Healthy: 15-25%. Excellent: 30-40%. Best-in-class: 50%+ for the saveable segments.

---

## 7. The "I forgot about it" risk — dormant-user emailing without spam-flag

The bigger risk than not emailing dormant users is emailing them so badly that you teach Gmail your domain is spam — which kills *every other email* including critical billing dunning and morning briefings to active users.

**The discipline:**

1. **Sender-reputation segmentation.** Two sending subdomains:
   - `briefings.acreos.io` — high-engagement transactional (morning briefings, milestone celebrations). Active-user-only.
   - `re-engage.acreos.io` — re-engagement only. Lower deliverability OK; isolated reputation.

   Dormant emails *never* go through `briefings.` — protects the active-user pipeline.

2. **Engagement gating.** Don't email someone who hasn't opened any email in 60 days *via the re-engage subdomain*. After 90 days no engagement, suppress entirely or hand off to founder for personal outreach.

3. **Plain-text re-engagement.** Re-engagement emails should be plain-text, from a person (`thomas@acreos.io`), no HTML, no images, no tracking pixel. Looks like a personal email; deliverability triples; reply rate 5×.

4. **One-question subject lines.** "Want to come back?" beats "We've shipped 12 things since you left." Best-in-class: "{{first_name}} — quick question." Reply-bait, not click-bait.

5. **Unsubscribe in two clicks max** — and an *opt-down* option ("just monthly recap") not just opt-out. Captures 30%+ who'd otherwise unsubscribe entirely.

6. **Frequency cap on re-engage subdomain:** max 1 email per 30 days, ever. Anything more and you become spam in their head before you become spam at Gmail.

7. **Hard block on re-engage to <15-day-old users.** Re-engagement is for true dormancy. New-user nudges live on `briefings.`

**Build effort:** 1 day for subdomain setup + DKIM/SPF/DMARC; 1 day for engagement-gating logic in `communications.ts`. Most critical infrastructure piece in the whole retention stack — bad sender reputation is the only retention bug that's irreversible.

---

## 8. Cohort-comparison reporting for the founder

Marisol called out that NRR isn't on `/founder-home`. I'd add a dedicated **`/founder/retention`** page (link from `/founder-home`) that the founder visits weekly:

**Retention dashboard — required surfaces:**

1. **Retention curves panel** — D7/D30/D90/D365 user-retention by signup-month cohort. Overlay 3 most recent cohorts; toggle previous quarters. Y-axis: % retained. Sparkline trends per D-band.

2. **Cohort-quality scorecard** — for each cohort: D30 retention, D90 retention, fraction-hitting-power-user, % survived-to-paid, MRR-per-survivor. *This is the single best signal for whether onboarding/product is improving cohort-over-cohort.*

3. **NRR / GRR panel** (see §9). Net + gross + decomposed (new / expansion / contraction / churn).

4. **Saveable-loss queue** — orgs in §5's Day -21 / Day -14 windows. Founder can intervene directly. Replaces Camila's "decisions inbox for churn" with a forward-looking action queue.

5. **Win-back funnel** — quarterly cohort: churned → emailed → opened → replied → reactivated. With reason-segment breakdown.

6. **Habit-action correlation** — a single "if-then" sentence: "Users who hit morning-briefing engagement in week 2 retain 4.2× longer at D90 than those who don't." Auto-generated weekly. Founder sees the actionable pattern, not the dashboard.

7. **Power-user share of MRR** — Marisol-adjacent. Concentration risk + champion identification.

**Build effort:** 4 days for the page, assuming §2's events ledger is in place. Reuses existing `cohort-analysis.tsx` shell.

---

## 9. NRR / GRR measurement

Marisol called out the gap; this is the implementation.

**Definitions (industry-standard, ASC-606-friendly):**
```
For cohort C measured at month M (typically M = M0 + 12):
  Starting MRR (S)         = MRR of cohort C at M0
  Expansion MRR (E)        = MRR added by C at M from upgrades + add-ons (credit packs)
  Contraction MRR (D)      = MRR lost by C at M from downgrades
  Churn MRR (X)            = MRR lost by C at M from cancellations

  GRR = (S - X - D) / S          // gross — never exceeds 100%
  NRR = (S - X - D + E) / S      // net — can exceed 100%
```

**For SaaS at AcreOS's stage, healthy bands:**
- GRR: 85-90% acceptable, 90-95% strong, 95%+ exceptional
- NRR: 100-110% acceptable, 110-120% strong, 120%+ excellent (Notion-tier)

**Implementation requirements:**

1. **Subscription-history immutable ledger** (Marisol's #2 — Series-A finance hardening). Every Stripe webhook that changes `tier` or `status` writes to `subscription_history`. Without this you cannot reconstruct cohort MRR retroactively.

2. **MRR-attribution function** — per `(cohort, month)`, walk subscription_history to compute starting / expansion / contraction / churn components. ~150 lines of SQL or a TS service against the ledger.

3. **Monthly recompute job** — on the 5th of each month, compute NRR/GRR for all cohorts mature enough (≥90 days). Persist to `cohort_retention_metrics` table; cache the dashboard reads.

4. **Comp accounts excluded.** Marisol flagged comp shadow-MRR. NRR should be computed on *paying* MRR only, with a parallel "if-comps-converted" view.

5. **Credit packs** — treat as expansion when *consumed*, not when *purchased*. Aligns with GAAP recognition (Marisol §4) and gives a more honest NRR.

**Build effort:** 5 days, sequenced *after* Marisol's subscription-history ledger (which is a prerequisite). Without that ledger, NRR is derived from `organizations.subscription_tier` overwritten in place — yesterday's MRR is unreconstructable, and so is any historical NRR.

---

## 10. The 2-week retention foundation sprint

Sequenced for highest leverage first. Each item builds on the prior. **No item ships in isolation; every item makes the next item possible.**

### Week 1 — instrument the ledger

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | **`retention_events` table + write hooks** in `routes-organization.ts`, `pax/*`, `leads/*`. The 5 events from §3. | 2d | Without this nothing else in retention is measurable. The single most important infra item in this whole audit. |
| 2 | **Cohort assignment** — `cohort_assignments` table populated on signup; backfill from existing orgs. | 0.5d | Cheap; required for §3 dashboard. |
| 3 | **D7/D30/D90/D365 retention computation service** — `cohortRetentionService.ts`, takes cohort+metric, returns retention curve. | 1.5d | Powers founder dashboard and §3 hypothesis testing. |
| 4 | **Subscription-history ledger** (depends on Marisol's audit prerequisite). | 3d | NRR/GRR impossible without this. Coordinate with finance hardening sprint. |

### Week 2 — close the loop with intervention + reporting

| # | Item | Effort | Why |
|---|---|---|---|
| 5 | **Trend-based pre-churn detection** (§5) — week-on-week event-rate delta; fire intervention at trend<0.5. | 2d | The 14-days-early signal that everything else hangs on. |
| 6 | **`/founder/retention` dashboard** (§8). 7 panels listed above. | 3d | The founder's weekly retention review surface. |
| 7 | **NRR/GRR computation** (§9). Depends on #4. Surfaces on `/founder/retention` and `/founder-home`. | 2d | The number every Series-A investor asks for. |
| 8 | **Win-back segmentation by churn reason** (§6). Cancellation survey taxonomy + segment-specific sequences. | 1d build, 1d templates | 50% reactivation benchmark requires this. |
| 9 | **Re-engagement subdomain + sender reputation isolation** (§7). | 1d | Protects deliverability of every other email. |

**Total: ~17 dev-days, parallelizable across 2 engineers in 2 weeks.**

**Prioritization if I had to pick three:** #1 (events ledger), #5 (trend-based pre-churn), #7 (NRR). Without #1 nothing is measurable; without #5 there's no intervention before it's too late; without #7 the founder cannot answer the single question Series-A investors ask first.

---

## What I'd tell the founder

The agent layer (Sophie, churn engine, onboarding journey) is sophisticated *diagnostic* infrastructure. What's missing is the *measurement* layer — you can compute a churn-risk score per org but you cannot answer "what was my D30 retention for the March cohort?" That gap is invisible day-to-day and catastrophic at the diligence call.

The two highest-leverage retention investments at AcreOS's stage are:
1. **Own the event ledger.** Three days of work; powers every retention question forever.
2. **Watch the trend, not the absence.** A user whose weekly event count halved is leaving — they just haven't told you yet. Catching them in the *fading* window (14-21 days early) is 4× cheaper than catching them at the *gone* window.

Build those, surface NRR + cohort curves on `/founder/retention`, and AcreOS goes from "we have a churn engine" to "we know which 12 customers we'll lose this quarter unless we intervene, and we have an intervention firing." That's a Series-A retention story.

Skip them, and 6 months from now the metric on the deck is "we think retention is good" — which to an investor reads as "we don't know what retention is." Same fact pattern, different valuation.

The 2-week sprint above is the foundation. Camila's CS sprint is the activation layer on top. Marisol's subscription-history ledger is the prerequisite for honest NRR. All three audits converge on the same handful of tables — build them once.

— Konstantin
