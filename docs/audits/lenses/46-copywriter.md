# Lens 46 -- Copywriter Audit

**Auditor persona:** Copywriter -- evaluates button labels, error messages, empty states, tooltips, marketing copy, and whether every string in the UI is clear, consistent, and on-brand.

**Date:** 2026-04-15

**Files reviewed:**
- `client/src/pages/today.tsx`
- `client/src/pages/leads.tsx`
- `client/src/pages/deals.tsx`
- `client/src/pages/auth-page.tsx`
- `client/src/pages/onboarding-v2.tsx`
- `client/src/pages/pricing.tsx`
- `client/src/pages/landing.tsx`
- `client/src/pages/founder-dashboard.tsx`
- `client/src/components/empty-state.tsx`
- `client/src/components/empty-states.tsx`
- `client/src/components/query-error-state.tsx`
- `client/src/components/disclaimer-banner.tsx`

---

## Executive Summary

AcreOS has reasonably polished marketing copy on the landing page and pricing page, but the in-app copy suffers from **identity confusion** (the product addresses "real estate professionals" on landing but speaks exclusively in land-investing jargon inside the app), **inconsistent AI agent naming** (Sophie, Atlas, Pax, Betty all surface without context), **terse toast messages** that give no actionable guidance, and **mixed tone** that swings from corporate SaaS to hype-bro ("AcreOS runs these processes automatically every night"). There are also several places where raw internal identifiers leak into user-facing strings.

---

## P1 -- Confusing or Misleading Copy on Critical Paths

### 1.1 Landing page says "real estate professionals"; product is land-investing-specific
- **Location:** `landing.tsx` line 92-94 ("The operating system for real estate professionals"), plus strategy badges listing "Wholesaling", "Fix & Flip", "Buy & Hold", etc.
- **Actual product:** Onboarding funnels users through "land investing journey" paths; Deal Hunter scans for tax-delinquent parcels; empty states reference county CSV imports.
- **Problem:** A wholesaler or multifamily investor who signs up based on the landing page will encounter an app laser-focused on land/lots. This is a broken promise that creates churn on the critical signup path.
- **Recommendation:** Either narrow the landing page positioning to match the product (land investing), or ensure the in-app experience genuinely supports all listed strategies.

### 1.2 Multiple AI personas without introduction
- **Location:** `today.tsx` ("Pax Noticed", "Pax Suggests"), `leads.tsx` ("Betty-style lead scoring breakdown"), `onboarding-v2.tsx` ("Atlas AI is ready to help", "Meet Atlas, Your AI Deal Partner"), `landing.tsx` ("Sophie, your AI copilot").
- **Problem:** Four different AI brand names appear with zero in-app explanation of who does what. A user arriving at the Today page sees "Pax Noticed" and "Pax Suggests" sections -- but has never been told what Pax is. The Score Details dialog says "Betty-style lead scoring" -- but Betty is never introduced anywhere. Sophie is mentioned only on the public landing page and nowhere in-app. This creates confusion on the critical daily-use dashboard.
- **Recommendation:** Either unify under one brand name or provide a discoverable glossary. Each AI section header should have a one-line explainer on first encounter.

### 1.3 Onboarding navigates to "/dashboard" but route is "/today"
- **Location:** `onboarding-v2.tsx` line 996: `onSuccess: () => navigate("/dashboard")`.
- **Problem:** The completion mutation sends the user to `/dashboard`, but the authenticated home page is `/today` (per `auth-page.tsx` line 16). If there is no `/dashboard` route, the user hits a 404 or blank page at the end of onboarding -- the single worst moment for a copy/UX failure.
- **Recommendation:** Verify the route exists. If it does not, change to `/today`. If it redirects, update the copy so users know where they are going.

### 1.4 Bulk status update leaks raw enum values into toasts
- **Location:** `leads.tsx` line 726: `Updated ${result.updatedCount} leads to "${status}".`
- **Location:** `deals.tsx` line 199: `Updated ${result.updatedCount} deal(s) to "${status}".`
- **Problem:** The `status` variable is a raw database enum like `"offer_sent"` or `"in_escrow"`. Users see: *Updated 3 deal(s) to "offer_sent".* This is confusing because the pipeline UI displays "Offer Sent" with proper formatting.
- **Recommendation:** Map status values through the existing `dealStages` labels before interpolating into user-facing strings.

### 1.5 Hardcoded founder name in Founder Dashboard
- **Location:** `founder-dashboard.tsx` line 531: `{greeting}, Thomas`
- **Problem:** The greeting is hardcoded to "Thomas" rather than reading the authenticated user's name. Any non-Thomas founder sees someone else's name.
- **Recommendation:** Replace with the dynamic user name from auth context.

### 1.6 `window.confirm()` used for unsaved-changes guard
- **Location:** `leads.tsx` line 1092: `window.confirm('You have unsaved changes. Discard them?')`
- **Location:** `deals.tsx` line 1754: `confirm('This will replace the current checklist. Continue?')`
- **Problem:** Native browser `confirm()` dialogs cannot be styled, cannot be translated, and break the brand experience. The copy itself is adequate but the presentation undermines trust on a critical data-loss path.
- **Recommendation:** Replace with `ConfirmDialog` component used elsewhere in the same files.

---

## P2 -- Inconsistent Tone, Style, and Terminology

### 2.1 Toast title inconsistency
- **Pattern observed across target files:**
  - Success toasts use: "Lead rescored", "Deleted", "Updated", "Consent updated", "Import successful", "Invitations sent", "Deals Updated", "Documents generated successfully", "Copied to clipboard", "Success"
  - Error toasts consistently use: "Error" as the title with a description.
- **Problem:** Success toast titles vary wildly -- some are past-tense verbs ("Deleted"), some are adjective-noun ("Import successful"), some are sentences ("Documents generated successfully"), and one is just the word "Success". Error toasts always say "Error" with no context in the title.
- **Recommendation:** Standardize on a pattern. Suggestion: success titles should be brief confirmations in past tense ("Lead rescored", "Deals deleted", "Stage updated"). Error titles should name the failed action ("Delete failed", "Import failed") rather than the generic "Error".

### 2.2 Capitalization inconsistency in section headers
- **Location:** `today.tsx`
  - Title Case: "Start Here Today", "Today's Actions", "Portfolio Alerts", "Pax Noticed", "Pax Suggests", "Goal Progress", "AI Action Queue", "Cash Position", "Business Pulse", "Agent Activity"
  - Abbreviated: "Avg Win Prob" (line 533)
- **Location:** `deals.tsx`
  - "Deal Pipeline" (page title), "Pipeline Stage Distribution" (all caps abbreviated: "PIPELINE STAGE DISTRIBUTION" via uppercase tracking-wide class)
- **Problem:** The Today page is internally consistent (Title Case), but "Avg Win Prob" is a jarring abbreviation in a section that otherwise spells things out. The deals page mixes sentence case ("Track acquisitions and dispositions through your pipeline") with all-caps labels.
- **Recommendation:** Spell out "Average Win Probability" or at minimum "Win Prob." with a period to signal abbreviation. Pick one casing style for stat labels.

### 2.3 "Sovereign Dashboard" unexplained
- **Location:** `today.tsx` line 467: `Sovereign Dashboard →`
- **Problem:** The link text "Sovereign Dashboard" appears in the Agent Activity section of the Today page. "Sovereign" is internal product terminology (the "Sovereign Company Protocol" from founder-dashboard.tsx). A regular user would not understand what "Sovereign" means.
- **Recommendation:** Label it "Agent Dashboard" or "Automation Dashboard" -- or add a tooltip explaining the concept.

### 2.4 Mixed audience: "land investing" vs "real estate business"
- **Location:** `today.tsx` line 412 ("your real estate business"), `landing.tsx` line 134 ("your real estate business"), `onboarding-v2.tsx` line 1023 ("your land investing journey"), `onboarding-v2.tsx` line 1019 ("The Most Intelligent Land Investing Platform")
- **Problem:** The product cannot decide whether it is a general real-estate platform or a land-investing platform. The tagline on onboarding says "land investing" while the landing page says "real estate professionals."
- **Recommendation:** Pick a positioning and apply it consistently. If the product truly supports all real estate strategies, the onboarding copy needs updating. If it is land-focused, the landing page needs narrowing.

### 2.5 Emoji usage inconsistent
- **Onboarding step titles:** Use emoji fire icon: `"🔥 AcreOS Found Real Opportunities"`, `"🔥 Deals in Your Markets"`, `"🔥 Enterprise Market Scan"`, `"🔥 Hot Deal"` badge
- **Onboarding helper text:** Uses `💡` ("Not sure which county to pick?"), `📍` ("Top Signal:")
- **Rest of app:** No emoji usage in today.tsx, leads.tsx, deals.tsx, pricing.tsx, landing.tsx.
- **Problem:** Emoji in step titles creates a casual, hype-driven tone that clashes with the professional, clean aesthetic of the rest of the platform.
- **Recommendation:** Remove emoji from step titles and badge labels. Use icon components instead (Lucide `Flame`, `Lightbulb`, `MapPin`), consistent with the rest of the codebase.

### 2.6 "Skip for now" vs "Skip setup" -- two different skip patterns
- **Location:** `onboarding-v2.tsx` line 505 ("Skip for now"), line 1116 ("Skip setup →")
- **Problem:** Both are skip actions in the same onboarding flow but use different wording and different visual treatments (one is a button, one is a text link with an arrow entity).
- **Recommendation:** Unify to one pattern. "Skip for now" is the more user-friendly option as it implies the user can return later.

---

## P3 -- Polish and Minor Copy Issues

### 3.1 "Betty-style lead scoring breakdown" is jargon
- **Location:** `leads.tsx` line 258 (DialogDescription in ScoreDetailsDialog)
- **Problem:** "Betty-style" is internal nomenclature. Users do not know what Betty is. The dialog description should explain what the user is looking at, not reference an internal system name.
- **Recommendation:** Change to "Lead scoring breakdown by property, owner, market, and engagement factors."

### 3.2 Pricing page CTA repetition
- **Location:** `pricing.tsx` -- Three of four tiers say "Start 14-Day Free Trial"; the Free tier says "Get Started"
- **Problem:** The CTAs are functional but not differentiated. The Pro tier (highlighted as "Most Popular") should have a more compelling CTA to match its visual emphasis.
- **Recommendation:** Consider "Start Free with Pro" or "Try Pro Free for 14 Days" for the highlighted tier.

### 3.3 Landing page social proof is weak
- **Location:** `landing.tsx` lines 52-56
  - `{ stat: "18", label: "Free data sources" }`
  - `{ stat: "$0", label: "To get started" }`
  - `{ stat: "14", label: "Day free trial" }`
  - `{ stat: "500+", label: "Properties managed" }`
- **Problem:** "18 Free data sources" and "$0 To get started" are product features, not social proof. "500+ Properties managed" is the only usage stat and it is modest. Social proof should demonstrate traction (users, deals closed, revenue generated).
- **Recommendation:** Either rename the section from "Social proof" to "Platform highlights", or replace with actual user/traction metrics when available.

### 3.4 Empty state copy is solid but "Add a Lead" mismatch with button label
- **Location:** `empty-states.tsx` line 22: `actionLabel: "Add a Lead"` -- but the page header button says "Add New Lead" (`leads.tsx` line 1100).
- **Recommendation:** Unify to one label. "Add Lead" or "Add New Lead" -- not both.

### 3.5 Deal form dialog description could be more helpful
- **Location:** `deals.tsx` line 396: `"Start tracking a new acquisition or disposition"`
- **Problem:** The description is adequate but misses an opportunity to guide. New users may not know the difference between acquisition and disposition.
- **Recommendation:** Consider: "Track a property you're buying (acquisition) or selling (disposition)."

### 3.6 "All caught up!" used in two different sections
- **Location:** `today.tsx` line 619 ("All caught up! No priority actions right now.") and line 959 ("You're all caught up! No AI-suggested actions right now.")
- **Problem:** Nearly identical empty-state messages in two sections feel repetitive when both are visible simultaneously. The slight wording variation ("All caught up!" vs "You're all caught up!") adds inconsistency without value.
- **Recommendation:** Differentiate the messages: the priority section could say "No priority actions right now" and the AI section "No AI suggestions at the moment."

### 3.7 Disclaimer copy is thorough but dense
- **Location:** `disclaimer-banner.tsx` -- especially the AVM disclaimer (49 words in one paragraph)
- **Problem:** The legal disclaimers are appropriately cautious but may not be read. The AVM one in particular is a wall of text.
- **Recommendation:** Consider a two-tier approach: short visible text ("Estimates only -- not an appraisal") with a "Learn more" link to full disclaimer.

### 3.8 Onboarding "pro tip" vs "expert tip" inconsistency
- **Location:** `onboarding-v2.tsx` line 579 ("Pro tip") vs line 1188 ("Expert tip")
- **Problem:** Two different names for the same UI pattern (a callout box with investing advice).
- **Recommendation:** Standardize on one term.

### 3.9 Auth page toggle copy is clear but plain
- **Location:** `auth-page.tsx` lines 46-47: "Need an account? Sign up" / "Already have an account? Sign in"
- **Problem:** Functional but generic. Misses a brand moment on a high-traffic page.
- **Recommendation:** Consider: "New to AcreOS? Create an account" / "Already on AcreOS? Sign in"

### 3.10 Pagination label "(s)" pattern reads poorly
- **Location:** `deals.tsx` line 182: `Deleted ${result.deletedCount} deal(s).`, line 540: `${selectedDealIds.size} deal${selectedDealIds.size !== 1 ? "s" : ""} selected`
- **Problem:** Two different pluralization approaches in the same file. The `(s)` approach in toasts reads awkwardly ("Deleted 1 deal(s)"), while the ternary approach is correct.
- **Recommendation:** Use the ternary pluralization pattern consistently. Drop `(s)` entirely.

### 3.11 "Still up?" greeting is too casual for a founder dashboard
- **Location:** `founder-dashboard.tsx` line 494: `hour < 5 ? "Still up?" :`
- **Problem:** While arguably charming, "Still up?" is jarring in a dashboard that otherwise maintains a professional "CEO briefing" tone (Crown icon, health status dots, keyboard shortcuts). It may annoy a founder who is working early morning shifts.
- **Recommendation:** Use "Good evening" for all late-night/early-morning hours, or "Working late?" if a casual tone is desired.

### 3.12 "Not configured" vs "not_configured" in integration badges
- **Location:** `onboarding-v2.tsx` line 869 -- the badge displays "Not configured" (friendly) but the status variable is `"not_configured"` (snake_case). The display is correct, but other locations may not apply the same mapping.
- **Recommendation:** Ensure all integration status displays go through a label mapper rather than relying on inline ternaries.

### 3.13 "View Notes" link label is ambiguous
- **Location:** `today.tsx` line 161: `alertLinkLabelByType` maps `note_overdue` to "View Notes"
- **Problem:** "Notes" in AcreOS means promissory notes (financial instruments), but most users associate "notes" with text annotations. The alert is about overdue payments on notes, so the CTA should reflect that.
- **Recommendation:** Change to "View Overdue Payments" or "View Note Payments."

---

## Summary Table

| ID   | Priority | Location                    | Issue                                                        |
|------|----------|-----------------------------|--------------------------------------------------------------|
| 1.1  | P1       | landing.tsx                 | Landing says "real estate professionals"; app is land-only   |
| 1.2  | P1       | today/leads/onboarding/landing | Four AI names (Sophie/Atlas/Pax/Betty) without introduction |
| 1.3  | P1       | onboarding-v2.tsx           | Completion navigates to `/dashboard`, may not exist          |
| 1.4  | P1       | leads.tsx, deals.tsx        | Raw enum values leak into user-facing toast messages         |
| 1.5  | P1       | founder-dashboard.tsx       | Hardcoded "Thomas" in greeting                               |
| 1.6  | P1       | leads.tsx, deals.tsx        | Native `window.confirm()` breaks brand on data-loss paths   |
| 2.1  | P2       | all target files            | Toast title style varies wildly (past tense, adjective, etc) |
| 2.2  | P2       | today.tsx, deals.tsx        | Abbreviation and casing inconsistencies in stat labels       |
| 2.3  | P2       | today.tsx                   | "Sovereign Dashboard" is unexplained internal jargon         |
| 2.4  | P2       | landing/onboarding/today    | "Land investing" vs "real estate" identity split             |
| 2.5  | P2       | onboarding-v2.tsx           | Emoji in step titles clashes with rest-of-app icon style     |
| 2.6  | P2       | onboarding-v2.tsx           | "Skip for now" vs "Skip setup" inconsistency                |
| 3.1  | P3       | leads.tsx                   | "Betty-style" jargon in scoring dialog                       |
| 3.2  | P3       | pricing.tsx                 | CTA repetition across tiers, missed opportunity on Pro       |
| 3.3  | P3       | landing.tsx                 | Social proof section contains features, not proof            |
| 3.4  | P3       | empty-states.tsx, leads.tsx | "Add a Lead" vs "Add New Lead" mismatch                     |
| 3.5  | P3       | deals.tsx                   | Deal form description misses guidance opportunity            |
| 3.6  | P3       | today.tsx                   | "All caught up!" repeated in two adjacent sections           |
| 3.7  | P3       | disclaimer-banner.tsx       | AVM disclaimer is a dense wall of text                       |
| 3.8  | P3       | onboarding-v2.tsx           | "Pro tip" vs "Expert tip" for same pattern                   |
| 3.9  | P3       | auth-page.tsx               | Generic toggle copy misses brand moment                      |
| 3.10 | P3       | deals.tsx                   | "(s)" pluralization reads awkwardly                          |
| 3.11 | P3       | founder-dashboard.tsx       | "Still up?" greeting too casual for CEO dashboard            |
| 3.12 | P3       | onboarding-v2.tsx           | Integration status display relies on inline ternary          |
| 3.13 | P3       | today.tsx                   | "View Notes" ambiguous -- means promissory notes, not text   |

---

## Overall Assessment

**What works well:**
- Empty states are consistently structured with actionable tips and CTAs -- this is above average for a product at this stage.
- Error states via `QueryErrorState` are well-differentiated by error type (network, auth, server, not found) with appropriate tone.
- Disclaimer banners are legally cautious and dismissable.
- Pricing page copy is clean, clear, and well-structured.
- Onboarding strategy selection is richly descriptive and helps users self-select.

**What needs work:**
- The product has an identity crisis between "land investing platform" and "real estate operating system." This must be resolved at the positioning level before copy can be fixed.
- AI agent names proliferate without user-facing documentation. A new user encounters Pax, Betty, Atlas, and Sophie with no explanation.
- Toast notifications need a style guide: consistent title patterns, proper label mapping for enum values, and ternary pluralization everywhere.
- The founder dashboard has hardcoded values and overly casual copy that undermine its "CEO briefing" aspiration.
