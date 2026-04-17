# Lens 48 -- Onboarding Specialist

**Auditor persona:** Evaluates the complete new-user experience from signup through first value delivery.
**Date:** 2026-04-15
**Scope:** Auth page, onboarding wizards, server provisioning, sample data, post-onboarding landing.

---

## Executive Summary

AcreOS has **five** separate onboarding implementations that compete for control of the new-user experience. None of them are cleanly wired end-to-end. A brand-new user signs up via Clerk, lands on `/today`, sees a dismissible banner linking to `/onboarding-v2`, and simultaneously gets a modal dialog from `OnboardingWizard` (component). Depending on timing and click path, the user may encounter zero, one, or two overlapping onboarding flows -- or skip both and land in an empty dashboard with no guidance. The server-side provisioning endpoint (`/api/onboarding/provision`) only validates three business types (`land_flipper`, `note_investor`, `hybrid`) even though the client offers fourteen, meaning most business-type selections will fail with a 422 validation error.

---

## Architecture of the Onboarding System

### Five Distinct Implementations

| # | Component/Page | Location | Trigger | Status |
|---|---|---|---|---|
| 1 | `OnboardingModal` | `client/src/components/onboarding-modal.tsx` | Auto-opens if `settings.onboardingCompleted !== true` | Passive tour (5 feature slides), no data collection |
| 2 | `OnboardingWizard` (component) | `client/src/components/onboarding-wizard.tsx` | Mounted globally in `App.tsx` when user is logged in; auto-opens via `/api/onboarding/status` | 6-step dialog: business type, role-based first steps, add property, integrations, campaign, completion |
| 3 | `OnboardingWizardPage` | `client/src/pages/onboarding-wizard.tsx` | Lazy-imported in App.tsx but **never routed** -- dead code | 4-step page: org name, invite team, investment goals, integrations |
| 4 | `OnboardingV2Page` | `client/src/pages/onboarding-v2.tsx` | Route `/onboarding-v2`, linked from today page banner | 3 paths (beginner/active/enterprise), 6 steps each, county scanner, deal hunt |
| 5 | `OnboardingWizard` (onboarding/) | `client/src/components/onboarding/OnboardingWizard.tsx` | Imported by `dashboard.tsx` | 14 business types, sample data generation, provisioning |
| 6 | `OnboardingChecklist` | `client/src/components/onboarding-checklist.tsx` | Shown on dashboard if < 14 days old | 7-item checklist (localStorage-based) |
| 7 | `GettingStartedChecklist` | `client/src/components/getting-started-checklist.tsx` | Shown on dashboard, server-backed via `/api/onboarding/checklist-status` | 5-item checklist (server-backed) |

### Server-Side Route Conflicts

The `/api/onboarding/complete` endpoint is registered **twice**:
1. In `server/routes-onboarding.ts` (mounted at `/api/onboarding` prefix via `routes.ts` line 1004) -- this handler processes `formData`, `businessType`, `orgName`, etc.
2. In `server/routes-organization.ts` (mounted as a direct route) -- simpler handler, just calls `completeOnboarding(org.id)`.

Express will execute whichever is mounted first. The two handlers accept different request body shapes, so one flow's "complete" call may silently discard data the other expects.

---

## Findings

### P0 -- User Cannot Complete Signup / Onboarding

#### P0-1: Provision endpoint rejects 11 of 14 business types
**File:** `server/routes-organization.ts:653-655`
The Zod validation schema for `POST /api/onboarding/provision` is:
```typescript
z.enum(["land_flipper", "note_investor", "hybrid"])
```
But the UI (`onboarding-wizard.tsx`, `onboarding/OnboardingWizard.tsx`, `onboarding-v2.tsx`) offers 14 business types including `residential_wholesaler`, `fix_and_flip`, `buy_and_hold`, `commercial`, `short_term_rental`, `creative_finance`, `developer`, `tax_lien_deed`, `multifamily`, `mobile_home`, `agent_investor`. Selecting any of these 11 types causes a 422 validation error at provisioning time. The `onboarding-wizard.tsx` component (global dialog) calls `provisionMutation` on step 0 "Next" -- so the user is blocked at step 1 with a toast error and cannot continue the wizard.

The server-side `OnboardingService.provisionTemplates()` already handles all 14 types correctly -- only the route-level validation is stale.

#### P0-2: Dual onboarding flows fire simultaneously
**Files:** `client/src/App.tsx:764`, `client/src/pages/today.tsx:403-416`
When a new user logs in and lands on `/today`:
1. The `OnboardingWizard` component (globally mounted in App.tsx) queries `/api/onboarding/status`, sees `completed: false`, and opens a dialog.
2. The Today page checks `organization.onboardingCompleted === false` and shows a banner card linking to `/onboarding-v2`.

The user sees both: a blocking modal dialog AND a banner behind it. If they dismiss the dialog, they see the banner. If they click the banner, they navigate to `/onboarding-v2` while the dialog state is still pending. There is no coordination between these two flows.

#### P0-3: `OnboardingModal` also fires on same condition
**File:** `client/src/components/onboarding-modal.tsx:54-62`
The `OnboardingModal` checks `settings?.onboardingCompleted === true`. If imported anywhere in the render tree (it was present in `dashboard.tsx` historically), it will also open on top of the other flows. While it appears not currently mounted in App.tsx, the fact that it exists and checks the same flag means any developer adding it will create a triple-modal situation.

### P1 -- Confusing Flow / Dead End

#### P1-1: Auth page redirects to `/today`, skipping onboarding entirely
**File:** `client/src/pages/auth-page.tsx:34,39`
Both `afterSignInUrl` and `afterSignUpUrl` are set to `/today`. There is no redirect to any onboarding page for new users. The onboarding only happens via the modal dialog that auto-opens on any page, or the banner on the Today page. A new signup user immediately lands in the full app with an empty dashboard. This is a missed opportunity for the carefully designed V2 flow.

#### P1-2: Onboarding V2 "complete" navigates to `/dashboard`
**File:** `client/src/pages/onboarding-v2.tsx:995`
```typescript
onSuccess: () => navigate("/dashboard"),
```
The `/dashboard` route resolves to the same `TodayPage` component (see App.tsx:334-336). This works, but it means the user arrives at a generic Today page rather than a purpose-built post-onboarding experience showing their newly provisioned sample data.

#### P1-3: Onboarding wizard page (v1) is dead code
**File:** `client/src/pages/onboarding-wizard.tsx`
`OnboardingWizardPage` is lazy-imported at `App.tsx:212` but no `<Route>` renders it. It references `POST /api/onboarding/complete` with a different body shape (sends `orgName`, `inviteEmails`, `goals`, `targetAcreage`, `targetBudgetCents`). On success, it navigates to `/dashboard`. This is unreachable dead code that creates confusion for future developers.

#### P1-4: Role first-steps links open in `_blank` -- user leaves wizard context
**File:** `client/src/components/onboarding-wizard.tsx:496`
```typescript
onClick={() => window.open(step.href, "_blank")}
```
The "Your First Steps" cards (step 1 in the component wizard) open links in new tabs. Since the wizard is a modal dialog, the user's tab still shows the wizard, but they are now working in a separate tab. If they complete the action there, they have no way to signal completion back to the wizard. This is disorienting.

#### P1-5: Integration links open in `_blank` with no return path
**File:** `client/src/components/onboarding-wizard.tsx:612`
Same pattern as P1-4 for the integration setup cards. The user clicks "Set up" on Email/SMS/Direct Mail, a new tab opens to `/settings?tab=email`, and they must manually return to the wizard tab. No completion detection.

#### P1-6: V2 beginner path shows "Instant Deal Hunt" that may return fabricated data
**File:** `server/routes-onboarding.ts:153-221`
When no real leads exist for the user's target county (the common case for a brand new user), the endpoint returns hardcoded "illustrative" opportunities from `TOP_LAND_COUNTIES` or generates synthetic data. These are presented as "real data points from public records" (onboarding-v2.tsx line 306). This is misleading and could damage trust if the user investigates the data and finds it fake.

#### P1-7: Two separate "Getting Started" checklists compete on dashboard
**Files:** `client/src/components/onboarding-checklist.tsx`, `client/src/components/getting-started-checklist.tsx`
One uses localStorage for state, the other uses `/api/onboarding/checklist-status` (server-backed). They have different items (7 vs 5), different dismiss mechanisms, and different completion tracking. Both may appear on the dashboard simultaneously.

### P2 -- Friction

#### P2-1: No business type pre-selection preserved across flows
If the user selects a business type in the component wizard, dismisses it, then clicks the banner to go to `/onboarding-v2`, their selection is lost. V2 starts from path selection (beginner/active/enterprise) and then asks for strategy again. The two flows track state independently (localStorage keys `acreos_onboarding` vs no persistence in V2).

#### P2-2: V2 path selection uses Tailwind dynamic classes that may not compile
**File:** `client/src/pages/onboarding-v2.tsx:1063-1067`
```typescript
className={cn(
  "text-left p-6 rounded-2xl border-2 transition-all hover:scale-[1.01]",
  `border-${color}-700/40 bg-${color}-950/20 hover:border-${color}-500`
)}
```
Dynamic Tailwind class construction (`border-${color}-700/40`) does not work with Tailwind's JIT purge. Classes like `border-emerald-700/40`, `bg-blue-950/20`, `border-purple-500` will be missing from the generated CSS unless they appear as full static strings elsewhere. The path selection cards may render with no visible borders or backgrounds -- appearing broken.

#### P2-3: V2 onboarding uses hardcoded dark theme colors
**File:** `client/src/pages/onboarding-v2.tsx` (throughout)
The V2 page uses `bg-gray-950`, `text-white`, `text-gray-400`, `bg-emerald-600`, etc. -- all hardcoded dark theme colors. If the user's system or app theme is light mode, this page will still render dark, creating a jarring visual discontinuity from the rest of the app.

#### P2-4: Seven clicks to first meaningful action (best case)
Counting the minimal path from signup to seeing real data:
1. Click "Sign up with Google" (auth page)
2. Authorize Google OAuth
3. Land on `/today` -- see wizard dialog auto-open
4. Select business type, click "Continue"
5. Click "Continue" or "Skip" on first-steps
6. Click "Skip for now" on add-property
7. Click "Skip" on integrations
8. Click "Next" on campaign step
9. Click "Go to Dashboard" on completion

That is 7-9 clicks minimum before reaching the actual dashboard with sample data. The V2 flow is 6-8 clicks. Neither flow provides value before step 3-4.

#### P2-5: The v1 wizard page sends `targetBudgetCents` as `parseInt(targetBudgetK) * 100000`
**File:** `client/src/pages/onboarding-wizard.tsx:55`
The variable is named `targetBudgetCents` but the calculation `parseInt(targetBudgetK) * 100000` treats the input as thousands of dollars and multiplies by 100,000 -- suggesting the field name should be `targetBudgetCents` where $50K = 5,000,000 cents. However, `100000` (one hundred thousand) for a $1K input gives 100,000 cents = $1,000, which only works if interpreted as: $K * 1000 * 100 cents. The value 100,000 does not equal 1000 * 100 = 100,000. So the math is correct, but the dead-code status means this is only academic.

#### P2-6: Sample data is not labeled as sample in the UI
**File:** `server/services/onboarding.ts:750-1056`
Sample leads created during `completeOnboarding()` use real-looking names and addresses (e.g., "Sarah Martinez", "456 Ranch Rd, Sedona, AZ 86336") but have no `source: "sample"` tag (the `source` is set to `"direct_mail"`, `"cold_call"`, etc.). Users may confuse sample data with real leads. Only the separate `generateSampleData()` method tags leads with `source: "sample_data"`.

#### P2-7: Progress bar shows 0% on step 1 in v1 wizard
**File:** `client/src/pages/onboarding-wizard.tsx:64`
```typescript
const progress = ((step) / STEPS.length) * 100;
```
When `step === 0`, progress is 0%. The user sees an empty progress bar on the first step, which feels like nothing has happened. Better UX would start at ~15-20%.

### P3 -- Polish

#### P3-1: Step indicator dots lack aria-labels
**File:** `client/src/components/onboarding-wizard.tsx:757-771`
The step indicator `<button>` elements have no `aria-label`, only a visual dot. Screen readers will announce them as empty buttons.

#### P3-2: "Don't show again" permanently hides onboarding with no way to return
**File:** `client/src/components/onboarding-wizard.tsx:397-403`
Clicking "Don't show again" sets `dontShowAgain: true` in localStorage AND calls `completeMutation.mutate()`, marking onboarding complete server-side. If the user clicks this accidentally on first visit, they lose access to the guided setup permanently (unless they find the "Reset Onboarding" option deep in Settings).

#### P3-3: Multiple `console.error` calls in production client code
**File:** `client/src/components/onboarding-wizard.tsx:213,218`
The `getLocalState()` and `setLocalState()` functions use `console.error` for error logging. These should use the structured logger or be silent in production.

#### P3-4: V2 "Skip setup" link only appears after step 1
**File:** `client/src/pages/onboarding-v2.tsx:1111-1118`
```typescript
{currentStepIndex > 0 && (
  <button onClick={() => navigate("/dashboard")} ...>Skip setup</button>
)}
```
On the very first step after path selection, there is no skip option. The user must complete at least one step before they can bail out. This may frustrate users who realize mid-flow they want to explore on their own.

#### P3-5: V1 wizard page integrations step shows stale provider list
**File:** `client/src/pages/onboarding-wizard.tsx:194-199`
Lists "County Records", "Google Maps", "MailGun Email", "Twilio SMS" with a badge saying "Configure in Settings". MailGun is not actually used by AcreOS (which uses AWS SES). This is confusing.

#### P3-6: Onboarding v2 uses emoji in step titles
**File:** `client/src/pages/onboarding-v2.tsx:119,128,133`
Step titles include emoji: "Found Real Opportunities", "Deals in Your Markets", "Enterprise Market Scan". While attention-grabbing, these may render as `?` on older systems and violate the professional tone of the rest of the app.

#### P3-7: `OnboardingService` AI tips depend on OpenAI API key that is known-broken
**Files:** `server/services/onboarding.ts:9-14,668-704`, `docs/audits/00-orientation.md` (item 9)
The orientation doc states "OpenAI API key invalid -- AI features broken in production." The onboarding service's `generatePersonalizedTips()` will always fall through to `getDefaultTips()`. The try/catch handles this gracefully, so it is functional, but the AI-personalized experience is never delivered.

---

## Sample Data Created by Business Type

| Business Type | Leads | Properties | Deals | Notes |
|---|---|---|---|---|
| `land_flipper` | 2 (1 seller, 1 seller) | 1 | 1 (acquisition) | -- |
| `note_investor` | 2 (1 buyer, 1 seller) | 1 | -- | -- |
| `hybrid` | Same as `land_flipper` | 1 | 1 | -- |
| `residential_wholesaler` | 2 (1 seller, 1 buyer) | 1 | 1 | -- |
| `fix_and_flip` | 1 (seller) | 1 | 1 | -- |
| `buy_and_hold` | 1 (seller) | 1 | 1 | -- |
| `commercial` | 1 (seller) | 1 | 1 | -- |
| `short_term_rental` | 1 (seller) | 1 | 1 | -- |
| `creative_finance` | 1 (seller) | 1 | 1 | -- |
| `developer` | 1 (seller) | 1 | 1 | -- |
| `tax_lien_deed` | 1 (seller) | 1 | 1 | -- |
| `multifamily` | 1 (seller) | 1 | 1 | -- |
| `mobile_home` | 1 (seller) | 1 | 1 | -- |
| `agent_investor` | 2 (1 seller, 1 buyer) | 1 | 1 | -- |

Sample data is created inside `completeOnboarding()` and is not tagged as sample. A separate `generateSampleData()` method creates 5 generic leads + 3 properties tagged with `source: "sample_data"` but is only invoked via the `/api/onboarding/sample-data` endpoint, which no current UI flow calls automatically.

---

## Post-Onboarding Experience

After completing any onboarding flow, the user arrives at either `/today` or `/dashboard` (both render `TodayPage`). What they see:

1. **Today page** with "Good morning" greeting, weather-style daily briefing
2. Sample data (if provisioned) appears in leads/properties/deals sections
3. The "Getting Started" banner is hidden (onboarding marked complete)
4. One or both checklists may appear on the dashboard page (if they navigate there)
5. No explicit "here's what was just set up for you" summary or tour

The transition from onboarding completion to regular app usage has no bridge. The user goes from a guided wizard to a full-featured dashboard with no contextual help pointing them to their newly created sample data.

---

## Click-to-Value Analysis

### Path A: Component Wizard (auto-modal)
| Step | Click | Value Delivered |
|---|---|---|
| 1 | Select business type | None -- just preference |
| 2 | Continue | Templates provisioned (background) |
| 3 | Skip first steps | None |
| 4 | Skip add property | None |
| 5 | Skip integrations | None |
| 6 | Next on campaigns | Campaign templates exist but user does not see them |
| 7 | Go to Dashboard | User arrives at `/today` with sample data |

**Clicks to first value: 7** (sample data visible on dashboard)

### Path B: V2 Beginner Flow (via banner)
| Step | Click | Value Delivered |
|---|---|---|
| 1 | Click "Get Started" on banner | Navigate to `/onboarding-v2` |
| 2 | Select "Just Getting Started" | Path selected |
| 3 | Click "Let's Get Started" | Nothing yet |
| 4 | Enter state + county, click "Scan" | Target set |
| 5 | See deal opportunities, click "Continue" | **First value: deal opportunities displayed** |
| 6 | Select strategy | Business type set |
| 7 | Click "Activate Atlas" | AI partner explained |
| 8 | Click "Go to My Dashboard" | Complete |

**Clicks to first value: 5** (deal opportunities in step 5). However, this value may be fabricated (see P1-6).

---

## Recommendations (Document Only -- Not Implemented)

1. **Consolidate to one onboarding flow.** Pick V2 (richest UX) or the component wizard (simplest) and remove the others.
2. **Fix the provision schema** to accept all 14 business types.
3. **Route new signups** directly to onboarding (`afterSignUpUrl="/onboarding-v2"`) instead of `/today`.
4. **Remove or hide** the global `OnboardingWizard` component when V2 is the intended path.
5. **Tag sample data** with `source: "sample"` so users can distinguish it.
6. **Add a post-onboarding landing** that summarizes what was set up and guides next actions.
7. **Fix Tailwind dynamic classes** in V2 path selection by using static class maps.
8. **Respect app theme** in V2 instead of hardcoding dark mode.

---

## Files Reviewed

- `client/src/pages/auth-page.tsx`
- `client/src/pages/onboarding-v2.tsx`
- `client/src/pages/onboarding-wizard.tsx`
- `client/src/components/onboarding-wizard.tsx`
- `client/src/components/onboarding-modal.tsx`
- `client/src/components/onboarding-checklist.tsx`
- `client/src/components/getting-started-checklist.tsx`
- `client/src/components/onboarding/OnboardingWizard.tsx`
- `client/src/components/onboarding/OnboardingProgress.tsx`
- `client/src/components/onboarding/index.ts`
- `client/src/pages/today.tsx`
- `client/src/App.tsx`
- `server/routes-onboarding.ts`
- `server/routes-organization.ts`
- `server/services/onboarding.ts`
- `server/services/onboardingEnhancements.ts`
- `server/middleware/getOrCreateOrg.ts`
