# Naima Khoury — Frontend Observability Audit
**Date:** 2026-05-01
**Wave:** 2 of 87-persona deep audit
**Bias:** Datadog RUM, Sentry. A product without frontend observability is one where every customer-reported bug is a surprise.
**Read first:** Reza's `reza-bones.md` §4 — Sentry wired, source-map upload conditional, 71 `console.*` calls survive in prod.

---

## 1. One-line verdict

**Sentry is *installed* but not *operating*: source-map upload is `continue-on-error`, no user identification, no breadcrumbs of intent, no PII scrubber on the client side, and 71 `console.*` calls bypass the framework entirely — at 100 customers you will be debugging blind from screenshots.**

---

## 2. Sentry hygiene checklist

`client/src/lib/sentry.ts` is 60 lines, consent-gated, with a thin `beforeSend` that strips `Authorization` + `Cookie` from request headers. That is the floor of competence. Everything past the floor is missing.

| Capability | State | Evidence | Severity |
|---|---|---|---|
| `Sentry.init` consent-gated | **OK** | `client/src/lib/sentry.ts:43-49`, `cookie-consent-banner.tsx` | — |
| DSN env-driven (no prod hardcode) | **OK** | `VITE_SENTRY_DSN` resolved from `import.meta.env` or `window.__ENV__` | — |
| `tracesSampleRate` configurable | **OK (0.1 default)** | env-driven via `VITE_SENTRY_TRACES_SAMPLE_RATE` | — |
| `replaysSessionSampleRate` sane | **OK (0.10 / 1.00)** | 10% sessions, 100% on error — within Sentry pricing safety zone | — |
| `release` tag set at init | **MISSING** | No `release: import.meta.env.VITE_GIT_SHA` on `Sentry.init` | **HIGH** — events won't bind to deploy |
| `dist` tag set at init | **MISSING** | needed for source-map matching when same release is rebuilt | MEDIUM |
| Source-map upload to Sentry | **CONDITIONAL & SOFT-FAIL** | `.github/workflows/deploy.yml:80-93` runs `@sentry/cli` only `if SENTRY_AUTH_TOKEN != ''` AND `continue-on-error: true`. Token may not be set; failures are silent | **HIGH** — stacktraces are minified noise |
| `browserTracingIntegration` (perf) | **MISSING** | No `integrations: [...]` array; `tracesSampleRate: 0.1` is wired to *nothing* | **HIGH** — perf budget unsampled |
| `replayIntegration` | **MISSING** explicit | sample rates set but the integration itself isn't constructed; in modern `@sentry/react` v8+ you must `Sentry.replayIntegration()` for replay to actually run | HIGH (verify against installed version) |
| `Sentry.setUser({ id, organizationId })` after auth | **MISSING** | No call site found in `App.tsx`, `use-auth.ts`, or `main.tsx`. Errors arrive un-attributable | **HIGH** |
| `Sentry.setTag('plan', tier)` / `setTag('isFounder', …)` | **MISSING** | no segmentation possible by tier or persona | MEDIUM |
| `Sentry.setContext('org', {...})` | **MISSING** | nothing to differentiate noisy orgs from clean ones | MEDIUM |
| `Sentry.addBreadcrumb` for key actions | **MISSING** | the only Sentry call outside init is `captureException` in `error-boundary.tsx:37` | **HIGH** — when an error fires, there are zero breadcrumbs of what the user did before it |
| `beforeSend` PII scrubber | **MINIMAL** | only strips two header keys; **does not call `maskString` from `server/middleware/piiMasking.ts`** | **HIGH** — owner phone, email, SSN can flow into Sentry messages and request URLs |
| `ignoreErrors` allowlist | **MISSING** | the usual ResizeObserver/Network noise will spam quota | LOW |
| `denyUrls` allowlist | **MISSING** | extension-injected errors will be attributed to AcreOS | LOW |
| Error boundary forwards to Sentry | **OK** | `client/src/components/error-boundary.tsx:37` — but also `console.error`s the full stack (line 34) which leaks into prod devtools | MEDIUM |

### The single most damaging gap

The combo of *no `release` tag* + *soft-fail source-map upload* + *no `setUser`* means: a customer reports a crash, you open Sentry, you see `Cannot read properties of undefined (reading 'name')` at `index-DV1vCZAN.js:1:48291`, with no user, no org, no version, no breadcrumbs. That is the same data you'd get from a screenshot. Sentry is paying rent.

---

## 3. PII scrubbing audit

AcreOS handles real-estate PII: owner name, owner phone, parcel APN, owner mailing address, lender SSN/EIN, payment ACH digits. This is regulated data. Reza found `installConsoleInterceptor` in `server/middleware/piiMasking.ts`. I read it.

### What's implemented (server side)

`server/middleware/piiMasking.ts` (235 lines) is genuinely good:
- `maskString()` covers phone (keeps area code), email (keeps domain), SSN (keeps last 4), credit card (keeps last 4)
- `maskValue()` recurses through objects/arrays
- `maskRecord()` redacts on key match (`ssn`, `password`, `apiKey`, etc.)
- `installConsoleInterceptor()` patches `console.{log,info,warn,error,debug}` — server-side `console.error("user data:", {phone, ssn})` becomes safe before it hits stdout
- `piiMaskingMiddleware` attaches `req.maskedBody` / `req.maskedQuery` for log lines

### What's broken

| Surface | Status | Explanation |
|---|---|---|
| Server stdout / Fly logs | **MASKED** | `installConsoleInterceptor()` called in `server/index.ts:42` |
| Server-side Sentry (if any) | **UNKNOWN** | I see no `@sentry/node` init in `server/`. Server crashes are presumably logged-only. **GAP** if you intend to tag server errors |
| Client-side Sentry events | **UNMASKED** | `client/src/lib/sentry.ts:beforeSend` strips two headers; does not call `maskString`. The PII masking module is `server/`-only and not bundled into the client. Phone numbers, emails, parcel owner fields included in any thrown `Error` message or React error path will reach Sentry verbatim |
| Client-side breadcrumbs (URL) | **UNMASKED** | If a route is `/leads/owner-phone-555-867-5309`, Sentry's auto navigation breadcrumb will record it raw |
| Client-side fetch/XHR breadcrumbs | **UNMASKED** | Sentry's default `breadcrumbsIntegration` records request URLs and (with `Replay`) request bodies. Owner emails in query strings → Sentry |
| Replay DOM scrubbing | **DEFAULT ONLY** | `@sentry/replay` defaults: it masks `<input>`, `<textarea>`, and `[data-sentry-mask]`. AcreOS has no `data-sentry-mask` attributes. Owner names rendered in `<div>`s in `leads-table.tsx`, `borrower-portal.tsx` are recorded |
| `console.error` in error-boundary | **LEAKS** | `error-boundary.tsx:34` writes `errorReport` (full stack + URL + UA) to `console.error` in production. No client-side interceptor exists |

### What needs to ship

1. **Port `maskString` to a client-safe module.** The regex set is pure functions with no Node deps. Move the pattern definitions and `maskString` / `maskValue` to `shared/pii.ts` and import from both server and client.
2. **Wire it into `beforeSend`.** Mask `event.message`, `event.exception.values[*].value`, `event.request.url`, `event.request.query_string`, and the `breadcrumbs[*].data.url` array. (Sentry calls `beforeBreadcrumb` separately for breadcrumbs — wire that too.)
3. **Replay scrubbing.** Add `Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })`. For AcreOS this should be the default — every text node on a lead detail page is PII. Use `[data-sentry-unmask]` to opt-in safe content (chrome, headers, button labels).
4. **Strip query strings from breadcrumb URLs by policy.** Or hash them.

---

## 4. Console-to-logger plan

71 `console.*` calls in 36 files (Reza measured 34; my recount: 36). They all run in production because:
- ESLint `no-console: warn`
- CI lint has `continue-on-error: true`
- Vite has no `drop_console` configured
- The server `installConsoleInterceptor` does NOT run in the browser

So today: a user with their devtools open sees `[ErrorBoundary] Error captured: { ...full stack with URL... }`, plus 4 messages from `OnboardingWizard.tsx`, plus 7 from `usePushNotifications.ts`. Some of these payloads include user IDs and parcel addresses.

### The migration recipe

**File: `client/src/lib/clientLogger.ts`** (new, ~80 lines)

```ts
import { Sentry } from "@/lib/sentry";

type Level = "debug" | "info" | "warn" | "error";
const isDev = import.meta.env.DEV;

function emit(level: Level, scope: string, message: string, data?: Record<string, unknown>) {
  // Dev: write to console for fast feedback (still goes through Sentry breadcrumbs in prod)
  if (isDev) {
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](`[${scope}]`, message, data ?? "");
  }

  // Prod + dev: drop a Sentry breadcrumb so it's attached to any subsequent error
  Sentry.addBreadcrumb({
    level: level === "debug" ? "debug" : level,
    category: scope,
    message,
    data,
    timestamp: Date.now() / 1000,
  });

  // Errors → also captureMessage so they show up in Issues even without a thrown Error
  if (level === "error") {
    Sentry.captureMessage(message, {
      level: "error",
      tags: { scope },
      extra: data,
    });
  }
}

export const clientLogger = {
  debug: (scope: string, msg: string, data?: Record<string, unknown>) => emit("debug", scope, msg, data),
  info:  (scope: string, msg: string, data?: Record<string, unknown>) => emit("info",  scope, msg, data),
  warn:  (scope: string, msg: string, data?: Record<string, unknown>) => emit("warn",  scope, msg, data),
  error: (scope: string, msg: string, data?: Record<string, unknown>) => emit("error", scope, msg, data),
};
```

### The codemod

For each of the 36 files, do mechanical replacement. Use file-name as scope.

| Before | After |
|---|---|
| `console.log("foo", x)` | `clientLogger.debug("ComponentName", "foo", { x })` |
| `console.warn("could not parse", err)` | `clientLogger.warn("ComponentName", "could not parse", { error: String(err) })` |
| `console.error("[X] failed", err)` | `clientLogger.error("X", "failed", { error: String(err), stack: (err as Error)?.stack })` |

### The lock-in

1. ESLint: `"no-console": "error"` (was `warn`). Add a single allowlist override for `client/src/lib/clientLogger.ts`.
2. Vite: `build.minify: 'esbuild'` with `esbuild: { drop: ['console', 'debugger'] }` for a belt-and-suspenders strip in prod, in case a stray `console.*` slips past lint. (This is fine even after the clientLogger migration — the logger doesn't use `console` in prod.)
3. CI lint: remove `continue-on-error: true` (this is also Reza's #5). Without this, the rule is still theatre.
4. `error-boundary.tsx:34`: change `console.error("[ErrorBoundary] Error captured:", errorReport)` → `clientLogger.error("ErrorBoundary", "captured", errorReport)`.

### Highest-PII-risk files (scrub these first)

| File | Why prioritize |
|---|---|
| `client/src/components/error-boundary.tsx` | Logs full stack + URL on every prod error |
| `client/src/hooks/usePushNotifications.ts` (7 calls) | Logs subscription endpoints — these contain device-identifying tokens |
| `client/src/hooks/useOfflineSync.ts` (4) | Logs queued requests including bodies |
| `client/src/components/onboarding/OnboardingWizard.tsx` (4) | First thing every new user does; logs onboarding state |
| `client/src/components/property-map.tsx` (5) | Logs parcel coordinates — geographic PII |

---

## 5. User-event taxonomy

Reza correctly notes there's no PostHog. The current "analytics" is server-side only: `/api/analytics/session/start`, `/api/analytics/pageview`, `/api/analytics/session/end` (called from `client/src/components/beta-activation-detector.tsx`). That gives you session counts and page views. It does **not** give you funnels, retention cohorts, feature-flag exposure, or product-led growth experiments.

### What to track and where

I would not introduce PostHog or Amplitude *yet*. Three signals (Sentry, the existing in-house `/api/analytics/*`, and Sentry breadcrumbs) cover the 100-customer phase. Pick a SaaS product analytics tool at 500 customers when you need cohort retention beyond `cohort-retention-dashboard.tsx`.

| Event class | Tool | Reason |
|---|---|---|
| **Page views** | In-house `/api/analytics/pageview` (already wired) | You own the data; you already have a `cohort-retention-dashboard.tsx` consuming it |
| **Critical user actions** (deal create, e-sign sent, payment recorded, lead status change) | In-house `/api/analytics/event` (new endpoint) + Sentry breadcrumb (mirror) | DB lets you build funnels; breadcrumb attaches the action to any crash |
| **Frontend errors** | Sentry `captureException` | Already wired |
| **Frontend warnings (non-fatal)** | Sentry `captureMessage(level=warning)` via `clientLogger.warn` | New, see §4 |
| **Web Vitals (LCP, CLS, INP, TTFB)** | `web-vitals` package → `Sentry.metrics` (or `/api/metrics`) | 3KB. Reza flagged absence in his §4b |
| **Feature flag exposure** | None today; defer | At 100 customers you can ship features fully or behind a server-side env flag |
| **Auth lifecycle** (login success, login fail, logout) | In-house events table + Sentry `setUser` / `configureScope(scope.clear())` | Compliance trail + observability |

### The minimal tracking surface to ship

```ts
// client/src/lib/track.ts
import { Sentry } from "@/lib/sentry";
import { apiRequest } from "@/lib/queryClient";

export type TrackEvent =
  | "lead.created" | "lead.status_changed"
  | "deal.created" | "deal.signed"
  | "esign.sent" | "esign.completed"
  | "payment.recorded"
  | "onboarding.step_completed" | "onboarding.completed";

export function track(event: TrackEvent, props: Record<string, unknown> = {}) {
  // Sentry breadcrumb — free, attaches to any subsequent error
  Sentry.addBreadcrumb({ category: "track", message: event, data: props, level: "info" });
  // Server-side fire-and-forget for product analytics
  apiRequest("POST", "/api/analytics/event", { event, props }).catch(() => {});
}
```

12 well-named events beat 80 sloppy ones. Every event must have a one-line schema doc in `shared/events.ts`.

---

## 6. Performance traces

`tracesSampleRate: 0.1` is set but `browserTracingIntegration()` is not in the integrations array, so the rate is wired to nothing. To activate:

```ts
import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import { useLocation } from "wouter";

Sentry.init({
  // ...existing
  integrations: [
    Sentry.browserTracingIntegration({
      // Wouter doesn't expose history; integrate manually via setCurrentRoute
    }),
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
  ],
  tracesSampleRate: 0.1,
  // Only trace requests to your own API to avoid CORS preflight noise
  tracePropagationTargets: [/^\/api\//],
});
```

What this buys at 10%:
- Median + p95 latency per page route, automatically grouped
- `/api/*` request waterfall per page — including the dreaded 7-cascade-fetch on `founder-dashboard`
- Slow-component flame graph if you also wrap routes in `Sentry.withProfiler`
- Cost: at 100 customers × 30 sessions/month × 0.10 sample = ~300 traces/month. Free-tier safe.

For server tracing: there is **no `@sentry/node` init** that I can find. If you want full-stack traces (browser → API → DB) you must add it to `server/index.ts` with the same release tag. Until then, traces stop at the network boundary.

---

## 7. Error grouping and alerts

### Grouping

Sentry's default grouping uses stack-trace top frame + exception type. Without source maps this becomes "everything is `error at index-XXX.js:1:N`" — every crash is its own group, your Issues page is unreadable, and dedup is broken. **Source-map upload is not optional for grouping to work.**

Action: make the source-map upload step in `deploy.yml` blocking (`continue-on-error: false`) once you've verified the auth token is set in production secrets. Until then, you have no signal that uploads succeed; the workflow lies to you.

### Alerts and on-call

There is no documented alert config in this repo. `docs/INCIDENT_RESPONSE.md:33` says "Monitor Sentry alerts, Prometheus dashboards, health check endpoints" but does not specify rules. `docs/security-audit.md:202` claims "F-A09-1 — Auth failure alerting — Done". I cannot find the rule definition.

Proposed alert routes (configure in Sentry UI; no code change needed):

| Rule | Threshold | Route | Why |
|---|---|---|---|
| New issue, environment=production | first occurrence | Slack `#alerts-prod` | Catch novel crashes within an hour |
| Issue regressed (closed → reopened) | first occurrence | Slack `#alerts-prod` | Caught a fix that didn't take |
| Error rate >5% of sessions over 1h | sustained 30 min | PagerDuty (founder + on-call) | Site-wide regression |
| `auth.*` issue, count >10 in 5 min | spike | PagerDuty | Auth provider outage or attack |
| Replay sample rate hits quota >80% | daily | Slack `#eng` | Cost guardrail |
| Performance: p95 transaction duration >5s | sustained 1h | Slack `#alerts-prod` | Latency regression |
| Source-map upload failed (CI) | each | Slack `#eng` | Today this is silent — fix it |

For on-call: at 100 customers and one founder, the realistic routing is **PagerDuty → Thomas's phone for site-down only**, **Slack `#alerts-prod` for everything else**. Keep the PagerDuty list to two rules until you have a second engineer.

---

## 8. The 1-week observability foundation sprint

One engineer. Sequenced for compounding payoff (each day's work makes the next day's signal cleaner).

### Day 1 — Sentry tagging and identity (4h)
- Add `release: import.meta.env.VITE_GIT_SHA ?? 'dev'` and `dist` to `Sentry.init`. Inject `VITE_GIT_SHA` from CI build env (already present as `$GITHUB_SHA` in `deploy.yml`).
- Add `Sentry.setUser({ id, segment: tier })` in `useAuth` on resolve, and `Sentry.getCurrentScope().setUser(null)` on logout.
- Add `Sentry.setTag('isFounder', isFounder)` and `setContext('org', { id, plan })` on org load.
- Acceptance: open a Sentry test issue from a logged-in user, confirm release SHA, user.id, org.id all present.

### Day 2 — Source maps blocking, integrations live (4h)
- Confirm `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` are set as GitHub Action secrets.
- Remove `continue-on-error: true` from the source-map upload step in `deploy.yml`.
- Add `browserTracingIntegration()` and `replayIntegration({ maskAllText: true, blockAllMedia: true })` to the integrations array.
- Acceptance: trigger a real production error, see symbolicated TS line numbers, see preceding navigation breadcrumb.

### Day 3 — Client logger + console codemod (8h)
- Ship `client/src/lib/clientLogger.ts` per §4.
- Codemod-replace 71 `console.*` calls across 36 files. Spot-check the 5 high-PII files manually.
- Flip ESLint `no-console: error`. Add `vite.config.ts` esbuild drop.
- Remove `continue-on-error: true` from CI lint (also Reza's #5; sequence after the cleanup so CI goes green immediately).
- Acceptance: `grep -rn "console\." client/src` returns 0 (excluding clientLogger).

### Day 4 — PII scrubber on the client (6h)
- Move `maskString` + `maskValue` to `shared/pii.ts`.
- Wire `beforeSend` and `beforeBreadcrumb` in `client/src/lib/sentry.ts` to mask `event.message`, `event.exception.values[*].value`, `event.request.url`, `event.request.query_string`, `breadcrumb.data.url`, `breadcrumb.data.body`.
- Add `data-sentry-unmask` to chrome elements (sidebar, topbar, button labels) so Replay isn't a black rectangle.
- Acceptance: throw `new Error("phone 555-867-5309 ssn 123-45-6789")` from a button, confirm Sentry shows masked.

### Day 5 — Tracking + Web Vitals + alerts (6h)
- Ship `client/src/lib/track.ts` per §5. Wire 12 events from `lead.created` through `onboarding.completed`.
- Add `web-vitals` (3KB), report LCP/CLS/INP/TTFB to Sentry as metrics.
- Configure the 7 alert rules from §7 in Sentry UI. Document them in `docs/INCIDENT_RESPONSE.md`.
- Acceptance: create a test lead, see `lead.created` breadcrumb on a subsequent intentionally-thrown error.

### What changes after the week

- Every prod error has: release SHA, user.id, org.id, plan tier, last 50 breadcrumbs of user actions, symbolicated stacktrace, masked PII, and a 10s replay starting before the error.
- Every customer-reported "it crashed" is searchable by user.id in Sentry inside 30 seconds.
- A spike in errors pages the founder; a single new issue posts to Slack.
- The 71 console leaks are gone. New `console.*` is a CI-blocking lint error.
- Owner phone numbers, emails, and SSNs no longer travel to a third-party SaaS error tracker — material for the SOC2 auditor.

---

## Footnote — what I did not cover

- Server-side Sentry (`@sentry/node`) — flagged as MISSING; full server observability is its own audit.
- LogRocket / FullStory alternatives — Sentry Replay is sufficient at 100 customers.
- Real-user MUX-style video / network capture — out of scope until 1k customers.
- PostHog feature flags — defer; server-side env flags are sufficient until 500 customers.

The bones are good. The instrumentation density is not. One week of focused work converts Sentry from rent into leverage.

— Naima
