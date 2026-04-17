# Lens 29 — Customer Success Manager Audit

**Auditor perspective:** Evaluates help content, error messages, documentation, tooltips, and whether users can self-serve answers to common questions.

**Date:** 2026-04-15

---

## Executive Summary

AcreOS has invested significantly in customer-facing help infrastructure: a floating help panel with topics, a troubleshooting wizard, an AI-powered support ticket system with browser-context capture, contextual tooltips, adaptive feature hints, a product tour, onboarding wizard, and dedicated empty-state components for core entities. However, these strong foundations are undermined by inconsistent adoption across the 156-page app, raw technical errors leaking to users from the vast majority of 926 API endpoints, and critical-path failures (auth, setup wizard) that leave users without guidance. The gap between what exists and what is actually wired up is the primary customer-success risk.

---

## Findings

### F29-01 — Server errors expose raw `err.message` to users (P1)

**Location:** 82 route files (920 occurrences of `error: err.message` / `error: error.message`)
**Example files:** `server/routes-territories.ts`, `server/routes-setup.ts`, `server/routes-onboarding.ts`, `server/routes-founder-v7.ts` through `routes-founder-v14.ts`

The standardized `Errors.*` helpers from `server/utils/errors.ts` are used in only 28 of ~112 route files (1,087 occurrences). The remaining 82+ files send raw `res.status(500).json({ error: err.message })` or `res.status(500).json({ message: error.message })`. In production, this means internal stack details, database column names, and third-party SDK errors are sent directly to the browser. The client `QueryErrorState` component falls back to displaying `error.message` for generic errors, so users can see messages like "relation does not exist" or "Cannot read properties of undefined".

**Impact:** Users see incomprehensible technical messages on failure. Support tickets will contain "I got an error: relation 'provider_cache' does not exist" instead of actionable information.

---

### F29-02 — 144 of 156 pages lack `QueryErrorState` handling (P1)

**Location:** `client/src/pages/*.tsx`

Only 9 pages use the `QueryErrorState` component: `deals`, `leads`, `properties`, `pax`, `founder-home`, `executive-dashboard`, `finance`, `dashboard`, and `onboarding-v2`. The remaining 144+ pages (including `bookkeeping`, `skip-tracing`, `territory-manager`, `campaigns`, `cohort-analysis`, `market-intelligence`, `capital-markets`, and dozens more) have no error-state rendering at all. When API calls fail on these pages, users see either a blank page, a perpetual spinner, or a brief destructive toast that disappears after a few seconds with no retry affordance.

**Impact:** Users on non-core pages have no way to understand or recover from errors without refreshing.

---

### F29-03 — 144 of 156 pages lack dedicated empty-state guidance (P1)

**Location:** `client/src/pages/*.tsx`

Rich, contextual `EmptyState` components (with CTAs and "Pro tip" sections) exist for leads, properties, deals, tasks, and campaigns. Only 12 pages import any empty-state component. The remaining 144 pages show either nothing, raw "No data" text, or a loading spinner forever when there is no data. Pages like `bookkeeping`, `skip-tracing`, `territory-manager`, `market-watchlist`, `portfolio-health`, `land-credit`, and many others render empty tables or blank cards with no guidance on how to get started.

**Impact:** New users visiting any non-core page for the first time see an empty, confusing screen with no direction.

---

### F29-04 — Auth page has zero error handling or guidance (P1)

**Location:** `client/src/pages/auth-page.tsx`

The auth page delegates entirely to Clerk's `<SignIn>` and `<SignUp>` components with no custom error handling, no fallback messages, and no troubleshooting guidance. The orientation document notes that Google OAuth is "fragile" with "External Account not found" errors, redirect loops, and Clerk modal overlay issues. The auth page has no `try/catch`, no error state, no "having trouble?" link, and no way for users to self-diagnose login problems.

**Impact:** Users encountering the known-broken auth flow have no in-app guidance whatsoever. This is the first screen new users see.

---

### F29-05 — Setup wizard crashes silently (P1)

**Location:** `server/routes-setup.ts` (line 93), orientation doc item #16

The orientation document identifies that `/api/founder/setup/status` crashes and the wizard shows a blank modal. The route returns raw `res.status(500).json({ error: err.message })` on failure. There is no fallback UI, no "we're having trouble loading your setup" message, and no way for the founder to know what went wrong or how to proceed.

**Impact:** The founder — the single most important user — hits a blank modal on the critical setup path.

---

### F29-06 — 108 occurrences of generic `title: "Error"` toasts (P2)

**Location:** 43 files across `client/src/pages/*.tsx` and `client/src/components/*.tsx`

Numerous mutation error handlers use `toast({ title: "Error", description: e.message, variant: "destructive" })`. The title "Error" provides zero context about what failed. Examples: `fee-dashboard.tsx` (3 occurrences), `deal-hunter.tsx` (5 occurrences), `founder-dashboard.tsx` (11 occurrences), `settings.tsx` (12 occurrences), `workflows.tsx` (5 occurrences).

**Impact:** Users see a red toast that says "Error" and then a technical message. They cannot determine what action failed or what to try next.

---

### F29-07 — Help tooltip coverage is limited to 9 terms (P2)

**Location:** `client/src/components/help-tooltip.tsx`

The `HelpTooltip` component has a hardcoded `HELP_CONTENT` dictionary with only 9 entries: `land-credit-score`, `70-percent-rule`, `dodd-frank`, `composite-score`, `cap-rate`, `arv`, `seller-finance-yield`, `byok`, and `tcpa`. The platform has hundreds of domain-specific terms (e.g., "skip tracing", "Regrid", "AVM", "SCP", "dunning", "1031 exchange", "TCPA compliance") that have no tooltip definitions. The `InfoTooltip` component is more flexible (accepts inline `explanation` props) but is not widely used.

**Impact:** Users encounter specialized real-estate and platform terminology without explanation across most of the app.

---

### F29-08 — Feature hints cover only 10 core actions (P2)

**Location:** `client/src/components/feature-hints.tsx`

The `FEATURE_HINTS` array contains 10 hint definitions targeting only 8 data-testid selectors: `leads-page`, `properties-page`, `campaigns-page`, `notes-page`, `button-add-lead`, `button-add-property`, `dashboard-stats-section`, `input-search-leads`. The remaining 146+ pages have no feature hints. The adaptive hints (which trigger based on usage thresholds) are a good pattern but only cover two scenarios: "leads but no campaigns" and "no notes with deals".

**Impact:** The hint system provides a good first impression on core pages but vanishes entirely once users explore beyond the CRM basics.

---

### F29-09 — Onboarding wizard depends on APIs that are known to fail (P2)

**Location:** `client/src/components/onboarding/OnboardingWizard.tsx`, `server/routes-onboarding.ts`

The onboarding wizard calls `/api/onboarding/status`, `/api/onboarding/complete-step`, `/api/onboarding/provision`, and `/api/onboarding/sample-data`. The `/api/onboarding/status` endpoint returns raw `err.message` on failure (line 67-68). The wizard has no explicit error state for when the status endpoint fails — it simply never opens, so users see nothing. The `loadSampleDataMutation` does have an `onError` handler with a toast, but `provisionMutation` and `completeStepMutation` have no `onError` handlers at all, meaning failures are silently swallowed.

**Impact:** New users whose onboarding API calls fail get no wizard, no error, and no explanation — just the raw dashboard.

---

### F29-10 — Changelog page has no error state (P2)

**Location:** `client/src/pages/changelog.tsx`

The changelog page fetches from `/api/changelog` but has no error handling. If the API call fails, the page shows nothing (no empty state, no error message, no retry). The loading state is a plain text "Loading changelog..." rather than a skeleton. The empty state for no entries is plain text "No changelog entries found." with no CTA.

**Impact:** Users looking for recent changes or known issues (a self-service support behavior) may see a broken page.

---

### F29-11 — Status page has no error or empty state (P2)

**Location:** `client/src/pages/status.tsx`

The status page fetches from `/api/status` with 30-second polling. If the fetch fails, the page shows "Unknown" status with no error message and no indication that the status check itself failed. The refresh button on the services card lacks an `aria-label`. There is no incident history, no uptime percentage, and no way to subscribe to status updates — the page is minimal.

**Impact:** Users checking system status during an outage cannot distinguish between "everything is down" and "the status page itself failed to load."

---

### F29-12 — Knowledge base articles are server-side only (P2)

**Location:** `server/ai/supportAgent.ts`, `server/routes-support-tickets.ts` (line 260-284)

A knowledge base system exists (`knowledgeBaseArticles` table, search endpoint at `/api/support/knowledge-base`, article detail at `/api/support/knowledge-base/:slug`). However, the HelpPanel's "Topics" tab shows only hardcoded `helpTopics` (13 items across 4 categories). The knowledge base articles are fetched but are displayed only within the HelpPanel and only if the API call succeeds. There is no standalone knowledge base page, no search-from-help-page capability, and no link from error messages to relevant KB articles.

**Impact:** Self-service content exists in the database but is difficult to discover and impossible to link to directly.

---

### F29-13 — Support ticket errors show raw server messages (P2)

**Location:** `server/routes-support-tickets.ts`

All 17 error handlers in the support ticket routes return `error.message || "Failed to <action>"`. The fallback messages are adequate but the primary path leaks raw error messages. For example, if the AI support agent fails (e.g., OpenAI key is invalid — a known P0 issue), the user sees the raw OpenAI error instead of "Our AI assistant is temporarily unavailable. Your ticket has been created and a human will respond."

**Impact:** The support system itself fails ungracefully, which is the worst possible experience — users seeking help encounter more errors.

---

### F29-14 — Product tour targets elements that may not exist (P3)

**Location:** `client/src/components/onboarding/ProductTour.tsx`

The product tour uses CSS selectors like `[data-tour='new-lead-btn']`, `[data-tour='enrich-btn']`, `[data-tour='new-deal-btn']`, and `[data-tour='atlas-btn']` to highlight elements. If these elements are not on the current page (which they won't be for 5 of 6 steps), the tour tooltip should fallback to center positioning. The tour provides action buttons with `href` to navigate to the right page, but the highlight will fail. No verification was found that these `data-tour` attributes actually exist on the referenced pages.

**Impact:** Tour steps may point to nothing, showing centered tooltips without visual context for where to click.

---

### F29-15 — Troubleshooting wizard always ends with "Chat with Pax" (P3)

**Location:** `client/src/components/help/HelpPanel.tsx` (lines 328-376)

Every troubleshooting category (login, sync, billing, missing data, AI, maps, performance, notifications) has a 4-step wizard where step 4 always says "Chat with Pax." Since the AI features depend on OpenAI (which the orientation doc notes has an invalid API key in production), the final escalation step may itself fail. There is no fallback to email support (`support@acreos.io` is mentioned only on the status page) and no human escalation path in the troubleshooting wizard.

**Impact:** Users who exhaust self-help steps may hit a dead end if AI chat is broken.

---

### F29-16 — Terms and Privacy pages link only back to login (P3)

**Location:** `client/src/pages/terms.tsx`, `client/src/pages/privacy.tsx`

Both pages have a "Back to Login" button linking to `/auth`. For authenticated users who navigate to these pages from within the app (e.g., from a footer link or settings page), this button navigates away from the app to the login screen. There should be a conditional "Back to Dashboard" or browser-back option.

**Impact:** Minor UX friction for authenticated users reviewing legal documents.

---

### F29-17 — No contextual help links from error messages to solutions (P3)

**Location:** Throughout `client/src/` and `server/`

Error messages never include links to relevant help articles, troubleshooting steps, or documentation. The `QueryErrorState` component shows a generic message and a retry button but no "Learn more" or "Get help" link. The `Errors.*` server helpers provide structured error codes (`NOT_FOUND`, `BAD_REQUEST`, etc.) but the client never maps these to help content.

**Impact:** Users must manually open the help panel and search for their issue rather than being guided directly from the error.

---

## Summary Table

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| F29-01 | 920 raw `err.message` leaks from 82 route files | P1 | Error messages |
| F29-02 | 144/156 pages lack `QueryErrorState` | P1 | Error handling |
| F29-03 | 144/156 pages lack empty-state guidance | P1 | Empty states |
| F29-04 | Auth page has zero error handling | P1 | Critical path |
| F29-05 | Setup wizard crashes silently | P1 | Critical path |
| F29-06 | 108 generic `title: "Error"` toasts across 43 files | P2 | Error messages |
| F29-07 | Help tooltips cover only 9 domain terms | P2 | Help content |
| F29-08 | Feature hints cover only 10 actions on 8 targets | P2 | Onboarding |
| F29-09 | Onboarding wizard silently fails on API errors | P2 | Onboarding |
| F29-10 | Changelog page lacks error/empty handling | P2 | Documentation |
| F29-11 | Status page cannot distinguish its own failure | P2 | Documentation |
| F29-12 | Knowledge base not surfaced in standalone page | P2 | Help content |
| F29-13 | Support ticket system leaks raw AI errors | P2 | Support |
| F29-14 | Product tour targets possibly missing DOM elements | P3 | Onboarding |
| F29-15 | Troubleshooting wizard always ends at Pax (which may be broken) | P3 | Support |
| F29-16 | Terms/Privacy pages navigate authenticated users to login | P3 | Documentation |
| F29-17 | No contextual help links from error messages | P3 | Help content |

---

## What Works Well

1. **HelpPanel architecture:** The three-tab design (Topics, Self-Help troubleshooting wizard, Support tickets) is thoughtful and well-structured. The troubleshooting wizard with step-by-step "yes/no, did this fix it?" flow is excellent self-service design.

2. **Browser context capture on tickets:** The `useBrowserContextCapture` hook automatically collects console errors, failed network requests, browser info, and recent user actions, then attaches them to support tickets. This is production-grade support tooling.

3. **Rich empty states for core entities:** The `LeadsEmptyState`, `DealsEmptyState`, `PropertiesEmptyState`, `CampaignsEmptyState`, and `TasksEmptyState` components are well-designed with animated icons, clear CTAs, and "Pro tip" educational content.

4. **Adaptive feature hints:** The `FeatureHint` system queries actual usage data (lead count, campaign count, note count) to show context-aware hints like "You have leads but no campaigns yet."

5. **Onboarding progress checklist:** The `OnboardingProgress` component tracks 5 concrete setup steps with real data (actual lead/property/deal counts) and celebrates completion with confetti.

6. **AI-powered support agent:** The support ticket system uses OpenAI with tool-calling to search knowledge base articles and diagnose account issues. This is an advanced self-service capability.

7. **`QueryErrorState` component quality:** The component is well-built with error-type detection (network, server, auth, notFound, generic), appropriate icons/colors, retry support, and dev-mode debug info. The problem is not quality but adoption.
