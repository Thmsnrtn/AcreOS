# Marketing Analytics Substrate

**Companion to:** `00-blueprint.md`
**Owner:** Soren (spec) → Iris (implementation) → Soren (ongoing analyst)
**Status:** Specification. No code in this round.

---

## 1. Why an analytics substrate before scale

At Phase 0, the company has under 50 paid customers and a tiny acquisition surface. The temptation is to wait. The reason not to wait: every signup that lands without attribution capture is permanently un-attributable. The substrate gets cheaper to add now and exponentially more expensive to backfill later.

The substrate has four parts:

1. **Event taxonomy** — what we record.
2. **Attribution model** — how we credit channels.
3. **Marketing-touch schema** — the unified record of a prospect's pre-signup journey.
4. **Piece-level ROI table** — per-artifact economics.

---

## 2. Event taxonomy

All marketing events are strongly typed in `shared/marketing-events.ts` (future). Every event has:

```ts
interface MarketingEvent {
  eventType: string;         // see below
  occurredAt: string;        // ISO-8601
  anonymousId: string;       // pre-signup fingerprint (1st-party cookie)
  userId?: string;           // post-signup join key
  organizationId?: string;   // post-signup join key
  utm: UtmParams | null;
  referrer: string | null;
  landingPath: string;
  device: DeviceFingerprint;
  payload: Record<string, unknown>;  // event-specific
}
```

### 2.1 Event types

| Event | Fires when | Payload |
|---|---|---|
| `marketing_touch` | Any pre-signup page view OR an inbound link from a tracked surface | `{ surface, sourceArtifactId? }` |
| `acquisition_step` | A pre-signup action (read 3+ programmatic pages, scrolled 90% of an editorial post, played the demo video, etc.) | `{ step, durationMs }` |
| `signup_started` | User hits /auth | `{ utmAtSignup, marketingTouchCount }` |
| `signup_completed` | User account created | `{ utmAtSignup, firstTouchUtm, lastTouchUtm, multiTouchPath }` |
| `trial_first_list_pulled` | Org pulls first parcel list during trial | `{ minutesToFirstList, vertical }` |
| `trial_converted` | Trial → paid conversion | `{ trialDays, plan, mrrCents }` |
| `cohort_assignment` | Org assigned to a weekly cohort | `{ cohortWeek, attribution }` |

### 2.2 The pre-signup fingerprint

`anonymousId` is a 1st-party cookie set on first AcreOS surface visit (landing, /learn, /letters). It persists across the surface. On signup, the server JOINs `anonymousId` → `userId` so the pre-signup touch chain is preserved.

This is the fix for the existing UTM-loss-at-auth-handshake bug surfaced in the prior horizon audit: the auth handshake currently drops UTM. The substrate fix is the persistent `anonymousId` cookie + a server-side `marketing_touch_chain` table that the auth flow JOINs against.

---

## 3. Attribution model

### 3.1 The choice

**Multi-touch attribution with fractional credit** at Phase 1+; **last-touch as the reported headline** at Phase 0.

### 3.2 Defense

- **First-touch** under-credits middle-of-funnel content; over-credits whoever drove discovery.
- **Last-touch** under-credits awareness; over-credits whoever closed.
- **Linear multi-touch** gives a defensible split but obscures the headline.
- **Position-based (U-shaped)** is the SaaS-standard middle ground: 40% first, 40% last, 20% middle touches distributed.

Recommendation: **U-shaped (40/20/40)** as the canonical multi-touch model, reported alongside last-touch headlines. Implement both; let the dashboard expose both.

### 3.3 UTM survival across auth handshake

The known bug: a user lands on `/?utm_source=google&utm_campaign=land-flipper-tx`, navigates to `/auth`, signs up, and the UTM is lost. Fix:

1. Set `anonymousId` cookie on first surface visit.
2. Record the inbound UTM into `marketing_touch_chain(anonymousId, utm, occurredAt)`.
3. On signup completion, the server reads the latest 30 days of `marketing_touch_chain` for the `anonymousId` and writes:
   - `firstTouchUtm` (oldest)
   - `lastTouchUtm` (most recent before signup)
   - `multiTouchPath[]` (full chain, U-shape weights applied)
   to the new `signups.attribution` JSONB column.

---

## 4. The `marketing_touch` schema

```sql
CREATE TABLE marketing_touch (
  id BIGSERIAL PRIMARY KEY,
  anonymous_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  surface TEXT NOT NULL,                       -- 'landing' | 'learn:land-flipping:texas' | 'letters:archive' | etc.
  source_artifact_id TEXT,                     -- if surface is an artifact, its id
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  referrer TEXT,
  landing_path TEXT NOT NULL,
  device_type TEXT,                            -- 'mobile' | 'desktop' | 'tablet'
  user_agent_hash TEXT,                        -- hashed UA for cohort grouping, not raw UA
  ip_country TEXT,                             -- country only, never raw IP (per `feedback_rate_limit_ip_keying` + privacy lock)
  user_id INTEGER REFERENCES users(id),        -- nullable; populated on signup-join
  organization_id INTEGER REFERENCES organizations(id)
);

CREATE INDEX marketing_touch_anon_idx ON marketing_touch (anonymous_id, occurred_at);
CREATE INDEX marketing_touch_user_idx ON marketing_touch (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX marketing_touch_surface_idx ON marketing_touch (surface, occurred_at);
```

Notes:

- **No raw IP stored.** Country-level geo only. Privacy lock.
- **User-agent hashed, not raw.** Cohort grouping only.
- **anonymous_id is the join key**; `user_id` populated post-signup.

---

## 5. Piece-level ROI table

Every published artifact (programmatic page, editorial post, video, ad, email) gets a row in `marketing_artifact`:

```sql
CREATE TABLE marketing_artifact (
  id TEXT PRIMARY KEY,                         -- e.g. 'learn:land-flipping:texas' or 'editorial:2026-06-12-run-the-comps'
  artifact_type TEXT NOT NULL,                 -- 'programmatic' | 'editorial' | 'long_form' | 'video' | 'ad' | 'email'
  funnel_stage TEXT NOT NULL,                  -- 'tofu' | 'mofu' | 'bofu'
  vertical TEXT,                               -- nullable; some artifacts are cross-vertical
  jtbd INTEGER,                                -- 1-10 per content engine §3.2
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  authoring_cost_minutes INTEGER,              -- self-reported by author
  distribution_cost_cents INTEGER DEFAULT 0    -- ad spend etc.
);
```

A materialized view aggregates touches → signups → paid by artifact:

```sql
CREATE MATERIALIZED VIEW marketing_artifact_economics AS
SELECT
  a.id,
  a.artifact_type,
  a.funnel_stage,
  COUNT(DISTINCT t.anonymous_id) AS touches,
  COUNT(DISTINCT s.user_id) AS attributed_signups,
  COUNT(DISTINCT s.user_id) FILTER (WHERE s.trial_converted) AS attributed_paid,
  SUM(s.lifetime_value_cents) FILTER (WHERE s.trial_converted) AS attributed_ltv_cents,
  a.authoring_cost_minutes,
  a.distribution_cost_cents
FROM marketing_artifact a
LEFT JOIN marketing_touch t ON t.source_artifact_id = a.id
LEFT JOIN signups s ON s.first_touch_artifact_id = a.id OR s.last_touch_artifact_id = a.id
GROUP BY a.id, a.artifact_type, a.funnel_stage, a.authoring_cost_minutes, a.distribution_cost_cents;
```

Refreshed nightly. Surfaces a per-artifact CAC and LTV-contribution figure. Underperformers get retired; outperformers get amplified.

---

## 6. Tool recommendation

### 6.1 Options

| Tool | Cost (Phase 0) | Pros | Cons |
|---|---|---|---|
| PostHog (self-hosted) | $0 | Owned data, feature flags + analytics in one tool, generous OSS license | Self-host ops overhead |
| PostHog (cloud) | $0 to 1M events/mo | No ops; same product | Vendor lock; data leaves infra |
| Plausible | $9/mo to start | Privacy-first; lightweight; GDPR-clean | No event-level granularity; no attribution chain |
| Self-hosted (build on `marketing_touch` table only) | $0 + eng time | Total control | Engineering cost; rebuilding what PostHog ships |
| Mixpanel / Amplitude | $0 trial → ~$200+/mo | Mature dashboards | Pricing scales aggressively; data leaves infra |

### 6.2 Recommendation

**Phase 0:** Build the `marketing_touch` table directly in our own Postgres (we already use Drizzle + migrations). Add PostHog cloud as the dashboard layer (free tier, 1M events/mo). PostHog reads our events via its SDK; we own the raw data because the canonical record lives in our Postgres.

**Phase 2+:** Re-evaluate. Either self-host PostHog (if data volume warrants) or stick with cloud.

**Why not pure Plausible:** no event-level attribution chain; we'd lose multi-touch.

**Why not pure self-built:** we'd spend 4 weeks on what PostHog gives in 4 hours.

The compromise: **own the raw data** (Postgres is canonical), **rent the dashboard** (PostHog cloud), **migrate the dashboard if needed**.

---

## 7. Reporting cadence

| Report | Frequency | Audience |
|---|---|---|
| Daily acquisition pulse | Daily | Soren only |
| Weekly cohort report | Mondays | Solene + Soren |
| Monthly attribution breakdown | First Monday | Tom + Solene + Soren |
| Quarterly category-position review | Quarterly | Tom + full team |

The monthly attribution breakdown is the one Tom reads. Single page. Five numbers: signups, trial-to-paid %, blended CAC, top 3 channels by ROI, top 3 artifacts by ROI.

---

## 8. What this spec does NOT do

- Does not implement the `marketing_touch` table. Drizzle migration is a separate Iris work item.
- Does not wire PostHog. Configuration + SDK install is a separate Iris work item.
- Does not build the dashboard. PostHog provides one; custom dashboard is Phase 2+.
- Does not specify privacy-policy copy. Beatrice owns the consent surface.
