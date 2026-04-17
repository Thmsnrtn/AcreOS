# Lens 30 — Analytics Specialist Audit

**Auditor perspective:** Analytics specialist evaluating event tracking, user analytics, funnel measurement, and data-driven decision capability.
**Core question:** "Can AcreOS reliably measure user behavior, conversion funnels, and product health to drive data-informed decisions?"
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has built a surprisingly broad analytics surface: a client-side telemetry library, an Insights page with six sub-tabs (Analytics, Team, Activity, Cohorts, Retention, Attribution), a server-side activity logger, an NPS collection system, a churn-risk scoring engine, customer health scoring, a beta analytics dashboard with activation events, and cohort analysis by multiple dimensions. On paper the feature list is impressive.

In practice, the system has a critical structural flaw: **the telemetry pipeline is a dead end.** The client-side `telemetry.ts` library batches events and sends them to `POST /api/telemetry`, but that endpoint only logs to stdout in development mode and returns `{ success: true }` in production -- events are silently discarded. There is no analytics data store, no third-party analytics integration (PostHog, Mixpanel, Segment), and no way to query historical telemetry data. The code itself contains TODO comments acknowledging this ("In production, you could send to: PostHog, Mixpanel, Your own analytics database").

Furthermore, the `telemetry.pageView()` helper is defined but **never called anywhere in the codebase.** Page-view tracking does not exist. The `featureUsed()` helper is called exactly once (command palette). The `sessionStart()` fires on login but the event vanishes into the void. The user-facing analytics dashboards (revenue, deals, leads, pipeline, velocity, conversions) query real CRM data via the storage layer, which works -- but these are business metrics, not product analytics. AcreOS can tell you deal pipeline value; it cannot tell you which pages users visit, where they drop off, or how long they spend in any workflow.

The NPS system and churn engine are the two strongest analytics components -- both persist data to PostgreSQL and produce actionable outputs. But NPS triggers are limited to two moments (day 14 and post-upgrade), and the churn engine uses proxy signals (record counts, login recency) rather than actual behavioral data, because that behavioral data is never stored.

---

## Findings

### F30-01: Telemetry pipeline discards all events in production
**Severity: P1**

`client/src/lib/telemetry.ts` implements a well-designed client-side event system with batching, `sendBeacon` fallback, and `beforeunload` flushing. However, the server endpoint at `POST /api/telemetry` (`server/routes-dashboard.ts:329-345`) only writes to the structured logger in development mode and returns success without persisting anything:

```typescript
if (process.env.NODE_ENV === 'development') {
  logger.info('[Telemetry]', { metadata: { detail: { userId: user?.id, orgId: org?.id, events } } });
}
// In production, you could send to:
// - PostHog
// - Mixpanel
// - Your own analytics database
res.json({ success: true });
```

No analytics backend is configured. Events from `trackEvent`, `telemetry.sessionStart()`, `telemetry.aiUsed()`, `telemetry.featureUsed()`, `telemetry.actionCompleted()`, and `telemetry.error()` all vanish.

**Impact:** All client-side behavioral data is lost. Product usage patterns, feature adoption rates, error frequencies, and AI agent usage cannot be measured. Every downstream analytics use case that depends on behavioral telemetry is broken.

**Files:** `client/src/lib/telemetry.ts`, `server/routes-dashboard.ts:329-345`

---

### F30-02: No user journey or signup funnel instrumented end-to-end
**Severity: P1**

AcreOS defines five critical user paths (orientation doc: signup, lead workflow, deal lifecycle, billing, founder ops), but none have end-to-end funnel tracking instrumented at the event level. There is a `getSignupFunnel()` function in `server/services/analyticsEnhancements.ts` that counts organizations at four milestones (signed up, onboarded, first lead, first deal), but this is a snapshot aggregation from database state -- not a timestamped funnel of user progression events.

Specific gaps:
- **Signup flow:** No event fires when a user completes Google OAuth, when Clerk session is established, when `hydrateUser` runs, or when `getOrCreateOrg` creates a new org.
- **Onboarding:** Despite three competing onboarding mechanisms (`onboarding-v2.tsx`, `onboarding-wizard.tsx`, `getting-started-checklist.tsx`), none fire telemetry events on step completion. `POST /api/onboarding/complete` does not emit a tracked event.
- **Lead-to-deal conversion:** Lead status changes are logged via `activityLogger.logStageChanged()` into the `activity_events` table, but there is no funnel visualization connecting lead import -> contact -> offer -> contract -> close at the product analytics level.
- **Billing conversion:** No event tracks trial-start, paywall encounter, checkout initiation, or subscription activation.

**Impact:** Cannot identify where users drop off in any journey. Cannot calculate time-to-value. Cannot A/B test onboarding flows. The `getSignupFunnel()` endpoint exists but only provides a static count of orgs at each stage with no temporal dimension or per-user tracking.

**Files:** `server/services/analyticsEnhancements.ts:11-33`, `server/routes-enhancements.ts:212-223`, `client/src/pages/onboarding-v2.tsx`, `client/src/pages/onboarding-wizard.tsx`

---

### F30-03: Page-view tracking defined but never called
**Severity: P2**

The telemetry library exports `telemetry.pageView(page)` which creates a `page_view` event with the page path. This function is never invoked anywhere in the application. The React router does not have a listener that fires page views on navigation. There is no route-change telemetry hook.

Even if the telemetry pipeline stored data (see F30-01), there would be zero page-view records because nothing calls the function.

**Impact:** Cannot determine which of the 156 pages users actually visit. Cannot calculate page popularity, session depth, or navigation patterns. Cannot identify unused pages for removal.

**Files:** `client/src/lib/telemetry.ts:54` (definition), no call sites found

---

### F30-04: Feature usage tracking covers 1 out of 156 pages
**Severity: P2**

The `telemetry.featureUsed(feature)` helper is called exactly once in the entire codebase: when the command palette opens (`client/src/components/command-palette.tsx:272`). The `telemetry.actionCompleted()` helper is used in five places: deal creation, lead update, lead creation, property creation, and two command palette actions.

Missing instrumentation for major features:
- Campaign creation/sending (email, SMS, direct mail)
- AI agent interactions (only `property-analysis-chat.tsx` calls `telemetry.aiUsed`)
- Map/GIS usage
- Document signing
- CSV import
- Report generation/export
- Search usage
- Settings changes
- Marketplace/bidding
- Evening Review / NightCap

**Impact:** Cannot measure feature adoption breadth or depth. The `calculateUserHealthScore()` function in `analyticsEnhancements.ts` has a `featuresUsed / totalFeatures` component, but there is no data source to populate `featuresUsed` since feature events are not tracked.

**Files:** `client/src/components/command-palette.tsx:272`, `client/src/pages/deals.tsx:1807`, `client/src/pages/leads.tsx:2011,2018`, `client/src/pages/properties.tsx:1125`, `client/src/components/property-analysis-chat.tsx:79`

---

### F30-05: Beta analytics tables defined but sparsely populated
**Severity: P2**

The schema defines three beta analytics tables (`user_sessions`, `user_activation_events`, `user_feedback`) and a `BetaAnalyticsService` class with methods for session tracking, page view recording, and activation event logging. Seven activation events are defined (`first_lead_created`, `first_lead_imported`, `first_campaign_created`, `first_deal_created`, `first_note_created`, `first_pax_message`, `first_enrichment_run`).

However, there is no evidence that `BetaAnalyticsService.startSession()` or `recordPageView()` are called from any route middleware or client flow. The `recordActivation()` calls are not wired into the actual lead/deal/campaign creation routes. The beta analytics dashboard (`/beta-analytics`) queries these tables via `GET /api/admin/beta-analytics`, but the tables appear to receive no writes in the normal application flow.

**Impact:** The beta analytics page likely shows zeros or stale data. The activation funnel (signup -> first lead -> first campaign -> first deal) cannot be measured despite the data model existing for it.

**Files:** `server/services/betaAnalytics.ts`, `shared/schema.ts:11371-11401`, `client/src/pages/beta-analytics.tsx`

---

### F30-06: Retention measurement uses `updatedAt` as a proxy for engagement
**Severity: P2**

The retention curves in `analyticsEnhancements.ts:getRetentionCurves()` measure "active" organizations by checking `organizations.updatedAt >= cutoff`. Similarly, the cohort retention dashboard (`routes-analytics.ts:607-776`) measures lead retention by whether `leads.updatedAt > leads.createdAt`.

Using `updatedAt` as a proxy for user engagement is unreliable because:
- Any background job, webhook, or system process that updates an organization record counts as "activity"
- A lead's `updatedAt` changes on any field update, including automated enrichment or scoring, not just user-initiated actions
- There is no distinction between human activity and automated activity

The `churnEngine.ts` is slightly better -- it checks `activityLog.createdAt` for the most recent entry -- but the activity log only captures CRM entity events (email sent, stage changed, note added), not login or navigation events.

**Impact:** Retention rates are inflated by system-generated updates. Day-7/Day-30/Day-90 retention figures are likely higher than actual user engagement would indicate.

**Files:** `server/services/analyticsEnhancements.ts:36-60`, `server/routes-analytics.ts:607-776`, `server/services/churnEngine.ts:65-81`

---

### F30-07: NPS collection limited to two trigger points with no aggregate analysis
**Severity: P2**

The NPS system is well-implemented at the component level (`nps-dialog.tsx` has proper 0-10 scoring, optional feedback, localStorage dismiss tracking). The server stores responses in `nps_responses` with organization, user, score, feedback, and trigger. However:

1. Only two triggers are defined: `day_14` (14 days after org creation) and `upgrade` (7 days after plan upgrade). There is no periodic re-survey (e.g., quarterly) and no feature-specific NPS (e.g., after closing a deal).
2. There is no admin dashboard or API endpoint to view aggregate NPS scores (promoters/passives/detractors breakdown, trend over time, NPS by cohort).
3. The `/api/nps/pending` endpoint checks eligibility server-side, but the dismiss-for-7-days logic is split between server (checks for existing response) and client (localStorage `nps_dismissed_at`). If a user clears localStorage, they will see the prompt again even if the server shows no pending trigger.

**Impact:** NPS data is collected but cannot be analyzed without direct database queries. Two trigger points miss many high-signal moments (post-first-deal, post-campaign-send, after support resolution).

**Files:** `client/src/components/nps-dialog.tsx`, `server/routes-organization.ts:1270-1370`, `migrations/0012_nps_churn_risk.sql`

---

### F30-08: Activity logger has comprehensive event types but no analytics aggregation layer
**Severity: P2**

`server/services/activityLogger.ts` defines 11 event types (email_sent, sms_sent, mail_sent, call_made, call_received, note_added, stage_changed, payment_received, document_uploaded, task_created, task_completed) and correctly writes to the `activity_events` table. The Activity tab on the Insights page presumably renders this timeline.

However, there is no aggregation service that answers questions like:
- "How many emails were sent per day this month?"
- "What is the average response time after a call?"
- "Which stage transition has the longest dwell time?"
- "How many touches does it take to convert a lead?"

The `attributionService.ts` partially addresses the last question by looking at `leadConversions.touchNumber`, but that table is separate from `activity_events` and requires a conversion to have been explicitly recorded.

**Impact:** Rich event-level data exists but is limited to timeline display. Trend analysis, rate calculations, and operational metrics from activity data require building a new aggregation layer.

**Files:** `server/services/activityLogger.ts`, `shared/schema.ts:3679-3718`

---

### F30-09: No error tracking analytics or performance metrics collection
**Severity: P2**

The telemetry library defines `telemetry.error(errorType, message)` but since the pipeline discards events (F30-01), client-side errors are not tracked. Sentry is configured server-side (`server/utils/sentry.ts`) for exception capture with a 10% trace sample rate, but there is no client-side Sentry SDK integration.

There is no collection of:
- Client-side JavaScript errors
- API response time metrics visible to product teams
- Core Web Vitals (LCP, FID, CLS)
- Client-side rendering performance
- Failed API call rates from the user's perspective

**Impact:** Error rates, performance degradation, and client-side failures are invisible. The only error visibility is through server-side Sentry (when `SENTRY_DSN` is set) and structured server logs.

**Files:** `client/src/lib/telemetry.ts:60-61`, `server/utils/sentry.ts`

---

### F30-10: Growth accounting returns hardcoded zeros
**Severity: P2**

`analyticsEnhancements.ts:getGrowthAccounting()` is defined with the correct interface (newMRR, expansionMRR, contractionMRR, churnMRR, netNewMRR) but returns all zeros with a comment "Simplified -- would be computed from subscription change events":

```typescript
return {
  newMRR: 0, expansionMRR: 0, contractionMRR: 0, churnMRR: 0, netNewMRR: 0,
};
```

There is a `subscriptionEvents` table in the schema that could power this, but the computation is not implemented.

**Impact:** MRR decomposition (new vs. expansion vs. churn) -- a fundamental SaaS metric -- is unavailable despite having the data model and API skeleton in place.

**Files:** `server/services/analyticsEnhancements.ts:127-142`

---

### F30-11: Business metrics dashboards are well-built but disconnected from product analytics
**Severity: P3**

The analytics dashboard (`analytics-content.tsx`) queries seven API endpoints (executive, revenue, leads, deals, campaigns, pipeline, velocity, conversions) and renders KPI cards, charts, and conversion funnels using Recharts. The cohort analysis system supports six segmentation dimensions (source, state, county, campaign, import month, import quarter). The attribution service calculates campaign ROI.

These are genuinely useful business analytics. However, they are entirely separate from product analytics. There is no connection between "which users are most active" and "which users close the most deals." The `customerHealthScoring.ts` computes a per-org health score but uses login recency and record counts, not actual feature usage patterns.

**Impact:** Business decisions can be informed by CRM data, but product decisions (what to build, what to deprecate, where users struggle) cannot be data-driven.

**Files:** `client/src/components/analytics-content.tsx`, `server/routes-analytics.ts`, `server/services/cohortAnalysis.ts`, `server/services/attributionService.ts`, `server/services/customerHealthScoring.ts`

---

### F30-12: No A/B testing or experimentation infrastructure
**Severity: P3**

A basic feature flags system exists (`client/src/hooks/use-feature-flags.ts`, `GET /api/config/features`) that returns enabled keys and routes. This is binary on/off gating, not experimentation. There is no:
- User segmentation for experiments
- Variant assignment with deterministic bucketing
- Metric collection per variant
- Statistical significance calculation
- Experiment lifecycle management

Given three competing onboarding flows and 156 pages, the inability to experiment means all product changes are deployed as 100% rollouts with no measurement of impact.

**Impact:** Cannot validate product hypotheses. Cannot incrementally roll out features. Cannot measure the effect of changes on conversion or retention.

**Files:** `client/src/hooks/use-feature-flags.ts`

---

### F30-13: Tenant metering records usage but has no analytics dashboard
**Severity: P3**

`server/services/tenantMetering.ts` records API calls, voice minutes, storage, and AI credit usage to `usageRecords` and `usageEvents` tables with billing month tracking. Credit rates are defined. However, there is no user-facing dashboard showing usage trends, no alerting when usage approaches limits, and no admin view of per-tenant usage patterns.

**Impact:** Usage data is collected for billing purposes but not surfaced as analytics. Cannot identify power users, usage trends, or overages.

**Files:** `server/services/tenantMetering.ts`

---

## Priority Summary

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| F30-01 | Telemetry pipeline discards all production events | P1 | Data loss |
| F30-02 | No end-to-end funnel tracking for any user journey | P1 | Funnel measurement |
| F30-03 | Page-view tracking defined but never called | P2 | Incomplete events |
| F30-04 | Feature usage tracking covers 1 of 156 pages | P2 | Incomplete events |
| F30-05 | Beta analytics tables defined but not populated | P2 | Dead code |
| F30-06 | Retention uses updatedAt as engagement proxy | P2 | Data quality |
| F30-07 | NPS limited to two triggers, no aggregate view | P2 | Incomplete events |
| F30-08 | Activity logger has no aggregation layer | P2 | Missing capability |
| F30-09 | No client-side error or performance tracking | P2 | Missing capability |
| F30-10 | Growth accounting returns hardcoded zeros | P2 | Stub code |
| F30-11 | Business metrics disconnected from product analytics | P3 | Architecture gap |
| F30-12 | No A/B testing or experimentation infrastructure | P3 | Missing capability |
| F30-13 | Tenant metering has no analytics dashboard | P3 | Missing capability |

---

## Architectural Observations

1. **Two parallel analytics systems that do not talk to each other.** Business analytics (CRM queries via `routes-analytics.ts`) works because it reads real database tables. Product analytics (telemetry, sessions, activation events) is scaffolded but non-functional because the collection pipeline drops data.

2. **The schema is ahead of the code.** Tables for `user_sessions`, `user_activation_events`, `user_feedback`, `nps_responses`, `churn_risk_scores`, `usage_records`, and `usage_events` all exist and are properly indexed. The data model is sound; the instrumentation to populate these tables is missing.

3. **Server-side activity logging works; client-side event tracking does not.** The `ActivityLoggerService` is called from route handlers when CRM actions occur (emails sent, stages changed, payments received). This provides a partial behavioral picture from the backend perspective. The client-side `telemetry.ts` library, which would capture navigation, clicks, feature usage, and timing, sends data to `/dev/null`.

4. **The churn engine is the most complete analytics loop.** It reads data (record counts, activity recency, payment status), computes a score, triggers actions (rescue emails, system alerts), and detects milestones. This pattern should be generalized: collect -> score -> act -> measure.
