# Camila Herrera — Customer Success Audit, AcreOS

**Lens:** ex-Intercom, ex-Plaid CS lead, 8 years building programs from zero. CS is a *product feature*, not a hire. The QBR is a lagging indicator — by the time you're on a Zoom with the customer, the loss has already happened in-product. So I read AcreOS through one question: **does the product itself do the work of a CSM, or are we trying to build a CS team to paper over a product that doesn't?**

I read Olu's COO audit (12 founder bottlenecks; agent layer above-bar; runbook gap), Yuna's activation audit (TTFV 7:30 → target 1:30), and the actual CS infrastructure (`server/services/customerHealthScoring.ts`, `server/services/scpCustomerLifecycle.ts`, `server/services/onboardingAutonomy.ts`, `server/services/communications.ts`).

---

## One-line verdict

AcreOS has **two parallel customer-health systems that don't talk to each other**, a **30-day onboarding journey with no email transport wired**, **zero in-product first-run hand-holding past the wizard**, **no win-back motion**, and **no NPS-or-CSAT loop firing on the customer side** — so the agent layer is making sophisticated decisions on data the customer never directly contributes. Fix that and Sophie becomes a real CSM, not a sophisticated logger.

---

## What exists, what's stubbed, what's missing

| Capability | Status | Where |
|---|---|---|
| Health scoring (DB-backed) | **Real** | `server/services/customerHealthScoring.ts` — 4 components, weighted, returns a 0-100 score per org |
| Health scoring (in-memory) | **Real, parallel** | `server/services/scpCustomerLifecycle.ts` — different formula, in-memory `Map`, AARRR stages |
| Churn risk | **Real** | `churn_risk_scores` table; nightly recompute referenced from `customerHealthScoring.ts:104` |
| 30-day onboarding journey | **Scheduled, no transport** | `server/services/onboardingAutonomy.ts` — handlers return `{ intent, description }` *strings* and never actually send |
| Email service | **Real** | `server/services/communications.ts` → `emailService` (SES per Olu) |
| NPS capture | **Backend only** | `npsResponses` table + day-14 trigger logic in `routes-organization.ts:1593`; no in-product survey UI surfaced |
| CSAT post-resolution | **Missing** | Olu flagged this — `metrics.avgSatisfaction` computed, no capture |
| Pre-churn intervention email | **Stubbed** | `onboardingAutonomy.handleWeek1Checkin` writes to `decisionsInboxItems` if "stalled" — no email out |
| Win-back motion | **Missing** | `autonomyBootstrap.ts:278` literally has the *intent* memorized ("Empathy email → discount → CEO note") but no executor |
| Power-user dashboard | **Missing** | No surface that says "these 5 customers got 3x value, what do they share?" |
| Customer interview cadence | **Missing** | No structured loop, no booking link, no template, no recording archive |
| In-product tooltips | **Sparse** | 37 files import `Tooltip`, but ~95% are icon hover labels, not first-run hints |
| Coach-marks / progressive disclosure | **Missing** | Only `ProductTour.tsx` (6-step overlay, fires once); no contextual "is this your first?" |

The pattern: **the data layer is overbuilt, the action layer is underbuilt.** AcreOS knows who's about to churn — it just doesn't *do* anything about it that a customer would notice.

---

## D1 / D7 / D30 activation arc design

Yuna sized the first 5 minutes. I'm sizing the first 30 days — what fires, what milestone, what unlocks "I can't go back."

### D0 (signup → end of session)
- **Aha #1 — first scan completes.** Yuna's milestone (`activation.county_picked`). In-product confetti (subtle), single sentence: *"You just searched 1,847 parcels. That used to be a week of work."*
- **D0 email at +5 min:** "Your AcreOS workspace is live — here's what happens overnight." Sets expectation for the morning briefing.
- **D0 email at +6 hours (only if no return visit):** "Pax found 3 more opportunities while you were away." Re-entry hook.

### D1 (the morning after)
- **Aha #2 — the morning briefing.** Email at 7am local: *"Last night, AcreOS scanned 41,832 parcels in your county. 7 new opportunities scored 75+. Top one is ready for you to review."* This is the moment they realize the product runs without them. Re-engagement metric: did they click within 4 hours.
- **In-product:** `/today` is now populated. The empty-state pattern Yuna flagged (Pulse showing zeros) is *gone* by D1 because the overnight cron has produced data.
- **Coach-mark trigger:** first-time visitor to `/leads/:id` gets a one-line bubble: *"This is your lead detail. Pax can draft an offer letter — try the button on the right."* Dismisses on first interaction with that button. Persisted server-side so it doesn't re-show on a different device.

### D3
- **Aha #3 — first artifact owned.** "Try Pax's offer-letter generator" prompt — a real lead from their list, one click, watch it draft. Time-to-outcome: 8 seconds.
- **D3 email if no D1/D2 return:** "We scanned 38,000 more parcels for you — but Pax doesn't draft offers without your green light. Want to see what's waiting?"

### D7 — **the activation verdict moment**
- **Aha #4 — cohort milestone.** *"You've reviewed 14 opportunities. Top operators in your county review 9 in their first week. You're ahead."* This is identity reinforcement; CSAT lifts here.
- **D7 in-product:** soft pricing prompt (Yuna's recommendation; the day-7 paywall move). NPS micro-survey eligible to fire here per `routes-organization.ts` day-14 trigger — **move this to D7**, when the value memory is freshest.
- **D7 onboardingAutonomy step (`day7_checkin`):** currently writes a "stalled" decision-inbox item if no leads ≥ 5. Add: *fire the email* with persona-flexed CTA. The decision-inbox item is the founder fallback; the email is the customer-facing arm.

### D14 — habit formation
- **Aha #5 — first import celebration.** Yuna's Candidate A. *"You uploaded 247 leads. 89 score 70+ on motivation. Show me the 89."* The irreversibility moment — they have to come back to act on those 89.
- **D14 in-product: NPS survey** if not yet captured.
- **D14 email:** "Your second week of overnight scans recap" — quantify scans run, opportunities surfaced, comparisons to first week. Trend graph.

### D30 — graduation
- **`day30_activation_verdict` step** classifies as `active` / `at_risk` / `churned` (already wired in `onboardingAutonomy.ts`). Add three diverging email branches:
  - `active`: "You're a power user. Here's what most operators don't know yet." → unlocks advanced features (Deal-Hunter automation, mailer campaigns).
  - `at_risk`: "We noticed you've slowed down. 15-min call?" → real Calendly link, real human (Thomas while ≤50 customers; Sophie pre-screens after).
  - `churned`: "Before you go — what didn't work?" 1-question form, no escape hatch needed because they've already left mentally.

### Activation milestone summary table

| Day | Milestone event | What unlocks |
|-----|-----------------|--------------|
| 0:00 | `signup_complete` | Workspace, scan-pending |
| 0:01 | `first_scan_completed` | InstantDealHunt cards |
| 0:02 | `first_lead_owned` | Lead detail with enrichment |
| 0:04 | `first_artifact_generated` | Pax draft history |
| 1:00 | `morning_briefing_clicked` | Habit signal |
| 7:00 | `cohort_milestone_seen` | Identity moment |
| 14:00 | `first_import_celebrated` | Irreversibility |
| 30:00 | `activation_verdict: active` | Advanced surfaces |

These six events become the **CS team's horizon**, not the page-views or session-counts.

---

## Health-scoring formula proposal

**The problem:** two scoring systems with different formulas, neither captures the activation milestones above, neither updates fast enough to drive intervention.

`customerHealthScoring.ts` weights: activity 35% / payment 25% / engagement 25% / inverse-churn 15%. Recency-only activity (binary: how many days since login). Engagement is "did they create leads/deals at all" — flat across the entire range past 10.

`scpCustomerLifecycle.ts` weights: activity-recency, feature-adoption %, support tickets, NPS, payment-failures, login-frequency. **Better, but in-memory only — restarts wipe it.**

### Unified formula (proposal)

```
HealthScore =
  35% * ActivationProgress  // 0-100, % of D1/D7/D30 milestones hit
+ 25% * EngagementDepth     // breadth of features touched in last 14d
+ 20% * RecencyVelocity     // logins/week trend (rising/flat/falling)
+ 10% * PaymentHealth       // plan, dunning state, usage vs cap
+ 10% * SentimentSignals    // NPS + CSAT + ticket sentiment
```

**Why these weights:**
- **Activation progress weighted highest** because in pre-launch / early customers, the question isn't "are they happy?" — it's "did they ever *become* a customer mentally?" A user 60 days in who never hit D7's first artifact is at 4x the churn risk of one who hit all six milestones.
- **Engagement depth, not breadth** — using 7 features lightly is healthier than using 1 feature heavily. Single-feature users are commodity-substitutable.
- **Recency velocity, not just recency** — a user logging in once a week, 4 weeks straight, is healthier than one who logged in 5 times last week and zero this week. Trend > level.
- **Payment health weighted lower than the v1** because at pre-launch, plan tier is more about acquisition channel than health.
- **Sentiment** captures NPS/CSAT/sentiment from `supportBrain.ts` — currently uncaptured on the customer-feedback side.

### Score bands and what fires

| Band | Range | Auto-action | Founder visibility |
|---|---|---|---|
| Healthy | 75-100 | None — let them work | Weekly digest only |
| Watching | 60-74 | Re-engagement nudge if no login 5d | Weekly digest |
| At-risk | 40-59 | Immediate pre-churn email + in-app banner | Decisions inbox |
| Critical | 20-39 | Sophie outreach + offer 15-min call | `/founder/onboarding` flagged |
| Lost | 0-19 | Win-back sequence (see §6) | Founder direct intervention |

**Implementation move:** consolidate into `customerHealthScoring.ts`, drop the in-memory parallel, recompute on event (not nightly cron — the cron is fine for batch trends, but an event-driven recompute on milestone-hit, ticket-open, login keeps the score current enough to drive action).

---

## Email lifecycle — sequence design

**Current state:** `onboardingAutonomy.ts` schedules 6 touchpoints (D0/D1/D3/D7/D14/D30) but the handlers return *intent strings*, not emails. Side-effect transport is unwired. `communications.ts` exists. The connection is missing.

**Below is the full 11-message first-month sequence, with trigger, body sketch, and exit conditions.**

| # | Day | Trigger | Subject | Purpose |
|---|---|---|---|---|
| 1 | D0 +5min | signup_complete | "Your workspace is live — here's what runs overnight" | Set expectation; reassure the scan is happening |
| 2 | D0 +6h | no return after first session | "Pax found 3 more opportunities while you were away" | Re-entry hook |
| 3 | D1 7am | morning_briefing_ready | "{{count}} new opportunities scored 75+ in {{county}}" | Aha #2; the habit-forming touch |
| 4 | D2 | morning_briefing_ready | (same template, different data) | Reinforcement — demonstrate "every morning" |
| 5 | D3 | first_artifact not yet | "Want Pax to draft your first offer letter?" | Drive Aha #3 |
| 6 | D5 | engagement < threshold | "{{firstName}} — quick check-in" | Personal-tone re-engage; short body, single CTA |
| 7 | D7 | scheduled | "Your week-1 recap: {{leads_reviewed}} reviewed, {{compares_to_top}}" | Cohort milestone; identity reinforcement |
| 8 | D10 | first_import not done | "Your existing leads in 30 seconds" | Drives Yuna's irreversibility moment |
| 9 | D14 | scheduled | "Your scan ran {{nights}} nights this week — 41,000 parcels reviewed" | Quantify the unseen work |
| 10 | D21 | scheduled | "What's missing? 2-min survey" | Discovery → product feedback loop |
| 11 | D30 | activation verdict | (branched: active / at_risk / churned) | Graduation |

**Rules across the whole sequence:**
- **Persona-flexed** — pull from `personaVocabulary.ts`. A note investor's email #3 should mention "yield-to-maturity" not "tax-delinquent."
- **Skip rules** — if user hits the milestone before the email fires, suppress it. Email #5 doesn't send if `first_artifact` already happened.
- **Reply-able** — `from: thomas@acreos.io` while pre-50, `from: pax@acreos.io` after. All replies route to `/admin/support` and trigger Sophie classification.
- **Frequency cap** — never more than one email per 24h, never more than 4 per week.
- **Telemetry** — log `email_sent`, `email_opened`, `email_clicked`, `email_replied` per template; surface in `cohort-retention-dashboard.tsx` so the team can see template-level conversion.

**Build effort:** ~3 days. Wire `emailService.send()` into each `onboardingAutonomy` handler, add 5 missing handlers (D2 morning briefing, D5 nudge, D10 import-prompt, D21 survey, D30 branched), add template files in a new `server/templates/lifecycle/`.

---

## In-product CS surfaces — tooltips / NUX gaps

**The honest state:** AcreOS has *one* first-run experience — `ProductTour.tsx`, a 6-step overlay that fires once at first login and never again. After that, the user is in production with no scaffolding. That's a product designed for someone who already knows what they're doing.

### What's missing (ranked by leverage)

1. **Contextual coach-marks per first-time-visit page.** `/leads`, `/deals`, `/properties`, `/finance`, `/campaigns`, `/pax` should each fire one bubble on first visit. Server-tracked (per-user, not localStorage — Olu noted multi-device matters), one-shot, dismissible. Pattern:
   ```
   {pageId, userId, dismissed: bool, dismissedAt}
   ```
   Stored in a new `ux_hints_dismissed` table. New CS rule: every new top-level surface ships with a one-bubble first-run hint.

2. **"Is this your first {{thing}}?" pattern.** When a user creates their first lead, generates their first offer letter, runs their first scan — show a brief celebration + "what to do next" panel. Currently zero of these fire. Wire into the milestone events from §2.

3. **Empty-state-as-onboarding (Yuna's pattern).** Pax-suggests on `/today` when empty should not say "Pax is monitoring your pipeline" — it should say *"Try asking Pax: 'find tax-delinquent parcels in my county'"*. Convert every empty state from punishment to invitation.

4. **Inline help in complex screens.** `/admin/safety-gates`, `/command-center`, `/founder-dashboard` are engineer-grade UIs (per Olu). For customer-facing complexity (`/finance`, `/campaigns`), each form field with non-obvious semantics needs a `?` icon → 1-sentence tooltip. Audit: 37 files use `Tooltip` but ~95% are icon-button labels, not learning content.

5. **Checklist completion celebration.** `GettingStartedChecklist` items currently fade to 50% opacity when done — no animation, no toast, no unlock. Add: confetti burst + "you unlocked X" toast on each item. Notion does this; it works because completion is the variable-reward of the whole product.

6. **In-product NPS micro-survey.** Backend exists (`npsResponses` table, day-14 trigger logic). Front-end UI doesn't render it. Add `NpsMicroSurvey.tsx` — a single 0-10 slider + one-text-field follow-up — fires on D7 (per the new schedule), dismissible, persists per-user.

7. **Pax-as-CSM moments.** When a user lands on `/today` after 3+ days of inactivity, Pax should open with: *"Welcome back. While you were away I scanned 124,000 parcels and found 12 new opportunities. Want to see them?"* — rather than the generic empty-state. Pax already has this capacity (`pax-copilot-rail.tsx`, `conversation-tray.tsx`); it just isn't wired to a re-engagement context.

8. **Help center / "ask Pax" inline on every page.** Floating "?" button bottom-right that opens a Pax chat seeded with current page context. Lower escalation rate, higher self-serve. Olu's customer-side support stub (12 lines) is the gap; this fills it.

---

## Pre-churn + win-back automation

### Pre-churn intervention (the "we noticed you haven't logged in 14 days" question)

**Today:** `onboardingAutonomy.handleWeek1Checkin` (line ~276) detects "stalled" verdict and writes a `decisions_inbox_item` of type `churn_risk_intervention`. That goes to the **founder** — not the customer. Customer hears nothing.

**The fix is a 4-tier intervention ladder, all automated:**

| Trigger | Action | Channel |
|---|---|---|
| 5 days no login (was healthy) | Soft re-engage email: "Pax found 4 things while you were away" | Email |
| 10 days no login | In-app banner on next visit: "Welcome back — here's what changed" + Pax recap | In-product |
| 14 days no login | Pre-churn email: "Quick question — is the product working for you?" with thumb up/down | Email + reply hook |
| 21 days no login | Sophie outreach: "Want a 15-min call with Thomas? Or 5-min async video Q&A?" | Email + Calendly |
| 30 days no login + low health | Founder ping (decisions inbox + SMS): personal note from Thomas | Founder |

**Each tier is conditional on the prior not converting** — i.e., if the 5-day email gets a click, the 10-day banner doesn't fire. Wire into the unified `HealthScore`'s "Watching"/"At-risk"/"Critical" bands.

### Win-back (post-churn)

**Today:** zero motion. `autonomyBootstrap.ts:278` literally has the *concept* memorized ("Churn rescue: empathy email → discount after 48h → CEO note after 7d") but no executor. This is a 1-day build sitting unbuilt.

**Win-back sequence (T0 = cancellation event):**

| Day | Action |
|---|---|
| T+0 | Empathy email: "Sorry to see you go. One question: what would have made AcreOS stick?" — single text-field, no marketing |
| T+2 | Reactivation offer: "If it was timing, we'll keep your data warm for 90 days. Click here to pause-not-cancel." |
| T+7 | Personal note from Thomas (while ≤500 cust): "Read your reason. Here's what we shipped this week that addresses it." |
| T+30 | Soft check-in: "We've shipped {{N}} things. Want to see if it's different now?" |
| T+90 | Final ping: "Last reminder before we delete your data. Reactivate or confirm." |

**Reactivation tracking:** new `winback_attempts` table. Surface a "comeback rate" metric on `cohort-retention-dashboard.tsx`.

---

## Power-user identification

**Today:** no surface answers "who are my power users?" The closest is `getExpansionCandidates()` in `scpCustomerLifecycle.ts` — but it's in-memory and never populated.

**What I'd build (1 day):**

1. **Power-user query**, run nightly:
   - HealthScore ≥ 80 for 14 consecutive days, AND
   - Used ≥ 5 distinct features in last 7 days, AND
   - Generated ≥ 10 artifacts (offer letters / comp reports / scans), AND
   - Logged in ≥ 5 of last 7 days.

2. **`/admin/power-users` page** — table of these orgs, what features they use, what they generate, when they joined. Two cohorts: "power users" and "expansion candidates" (HealthScore 70-79 trending up).

3. **Pattern extraction**: every Friday, a Sophie-generated digest: "Your top 5 power users have these 3 things in common: (a) imported within first 48 hours, (b) used Pax offer-letter ≥ 8 times, (c) on weekly mailer cadence." This is the data the rest of CS plans against.

4. **Power-user concierge**: at HealthScore ≥ 90 for 30+ days, fire a one-time email: "You're in the top 5%. Want a 30-min call to talk about what's coming next?" Builds champions, surfaces feature gaps, drives word-of-mouth.

5. **Anti-pattern detection**: same dashboard surfaces *negative* cohort — users who hit "Critical" within 14 days of signup. Compare features-used / pages-touched / errors-hit. Find the leading indicator. This is where the next product fix comes from.

---

## Customer interview cadence

**Today:** no structured loop. No booking link surfaced, no template, no recording archive, no synthesis pipeline. The feedback that exists is `feedbackSubmissions` (random in-app submissions) and `npsResponses` (numeric ratings, no qualitative).

**The minimum viable program (2-3 hours/week of founder time):**

- **Weekly cadence:** 3 × 30-min calls per week, every week. ~150 customer-conversations per year, which is enough to know your customer base by name through ~50 customers.
- **Who:** rotate across cohorts — 1 power-user, 1 watching/at-risk, 1 newly-activated. Auto-suggested by the `HealthScore` bands.
- **Booking:** Calendly link in CS-segment emails (D7, D14, D30 verdict, win-back T+7). Sophie pre-screens to avoid wasting the founder slot on tire-kickers.
- **Template:** 5-question script. (1) What were you doing before AcreOS? (2) What made you sign up *that day*? (3) Show me how you used it last — any moment of friction or surprise? (4) What's the one thing you wish it did? (5) If we removed AcreOS tomorrow, what would you replace it with?
- **Recording + synthesis:** record (Otter / Fathom), Sophie auto-generates a 3-bullet synthesis, drops into a `customer_interviews` table, surfaces in `/admin/insights`.
- **Pattern detection:** monthly, Sophie clusters synthesis bullets — recurring complaints become product roadmap input.

**Build effort:** Calendly integration is no-code. The `customer_interviews` table + Sophie summarization is ~1 day. The discipline of doing 3 calls a week is the actual hard part — and the *only* moat at pre-launch.

---

## The 2-week CS-program sprint

Sequenced for impact-per-day. No new infrastructure required — every item is wiring existing pieces together or thin UI on existing data.

### Week 1 — wire the loop closed

| # | Item | Effort | Why first |
|---|---|---|---|
| 1 | **Wire emails into `onboardingAutonomy` handlers.** Replace each handler's intent-string return with an actual `emailService.send()` call. Add D2/D5/D10/D21 handlers. | 3d | Without this the entire 30-day journey is theatre |
| 2 | **Consolidate health scoring** — drop the in-memory `scpCustomerLifecycle` formula, unify into `customerHealthScoring.ts` with the new formula from §3. Event-driven recompute on milestone-hit. | 2d | Two systems disagree silently; one source of truth |
| 3 | **Pre-churn ladder** (5d/10d/14d/21d/30d) — five new automation rules using the existing `evaluateAutomationRules` machinery, transport via `communications.ts`. | 2d | Highest-leverage fix; turns the "stalled" decision-inbox item into customer-visible action |

### Week 2 — close the in-product gap

| # | Item | Effort | Why |
|---|---|---|---|
| 4 | **`ux_hints_dismissed` table + first-run coach-marks** for `/leads`, `/deals`, `/properties`, `/finance`, `/campaigns`, `/pax`. One bubble each, one-shot, server-tracked. | 2d | Yuna's "first 5 minutes" is well-covered; minutes 5-500 are not |
| 5 | **`NpsMicroSurvey.tsx` + checklist celebration toasts** (item 5 from §5) | 1d | Closes the customer→product feedback loop that's currently backend-only |
| 6 | **Win-back sequence** — `winback_attempts` table, 5-touch automation, kick off on `subscription.canceled` Stripe webhook. | 2d | Free MRR; literally zero today, sequence already memorized in `autonomyBootstrap.ts:278` |
| 7 | **`/admin/power-users` dashboard** + nightly cohort query + Friday Sophie digest. | 1d | The data the rest of the CS program plans against |
| 8 | **Customer-interview infrastructure** — Calendly link in CS emails, `customer_interviews` table, Sophie synthesis pipeline, founder discipline of 3 calls/week. | 0.5d build + ongoing | The only moat at pre-launch |

**Two-week order:** 1 → 2 → 3 (transport + scoring + intervention) → 4 → 5 (in-product surfaces) → 6 (win-back) → 7 (power-user) → 8 (interviews).

**Total: ~13 dev-days + ongoing 3hrs/week founder time.**

---

## What I'd tell the founder

The agent layer (Sophie, churn engine, onboarding journey) is genuinely impressive — pre-launch SaaS rarely has this much scaffolding. But scaffolding without transport doesn't move customers; it just *describes* moving them. The 30-day journey schedules emails it never sends. The health score updates nightly but nothing acts on the change. The pre-churn detection writes to the founder's inbox, not the customer's. NPS captures into a backend table no UI surfaces.

Wire those pieces together — three days of work in week one — and AcreOS suddenly has the CS program of a Series-B company with no CS team. That's the difference between "Sophie is smart" and "Sophie is making customers stick." The former is a demo; the latter is a moat.

The 2-week sprint above is the CS program. The 3-calls-a-week founder discipline is what makes it survive contact with reality.

— Camila
