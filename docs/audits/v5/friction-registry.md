# AcreOS v5 Friction Registry

Built from Run 1 (17 transcripts). Updated after fixes.

---

## CRITICAL

### FRICTION-0001
Title: Sign-up CTA links to sign-in form
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, David, Robert, Jenna, Chris, Priya, Marcus, Sarah, Alex
Journeys affected: J1
Description: All "Get Started Free" buttons linked to /auth which defaults to Sign In. Users expecting to create an account hit a login form.
Screen/location: /auth, landing.tsx, pricing.tsx
User impact: Confusion, extra clicks, some personas would abandon
Remediation plan: Change CTAs to /auth?mode=register
Resolving commits: b1a3091

### FRICTION-0002
Title: New users redirected to empty dashboard instead of onboarding
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, Jenna, Robert
Journeys affected: J1
Description: signUpFallbackRedirectUrl pointed to /today. New users saw an empty dashboard with zero guidance.
Screen/location: main.tsx ClerkProvider config
User impact: Maria abandoned. Others confused for 2+ minutes.
Remediation plan: Redirect to /onboarding-v2
Resolving commits: b1a3091

### FRICTION-0003
Title: Pricing comparison table clipped on mobile
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, Chris
Journeys affected: J1
Description: overflow-hidden on pricing table container hid Pro and Scale columns on 375px viewport.
Screen/location: pricing.tsx
User impact: Chris could not compare plans — deal-breaker.
Remediation plan: Change to overflow-x-auto
Resolving commits: b1a3091

### FRICTION-0004
Title: Sophie agent missing from floating assistant
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Robert, Chris
Journeys affected: J5, J8
Description: Pax redirects support questions to Sophie, but Sophie didn't exist in the floating assistant AGENTS list. Dead-end redirect loop.
Screen/location: floating-assistant.tsx
User impact: Users told to "go to Sophie" could not find her. Complete support path failure.
Remediation plan: Add Sophie to AGENTS array with support-focused system prompt
Resolving commits: 5af942c

### FRICTION-0005
Title: No account deletion or data export UI
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Chris
Journeys affected: J8
Description: POST /api/privacy/delete and /api/privacy/export endpoints exist but have zero client UI. GDPR/CCPA compliance gap.
Screen/location: settings.tsx — no Privacy tab existed
User impact: Chris could not find how to delete account or export data. Journey FAILED.
Remediation plan: Add Privacy tab to Settings with Export + Delete buttons
Resolving commits: 88a636a

### FRICTION-0006
Title: No returning-user re-orientation after long absence
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Tom
Journeys affected: J1, J9
Description: No "welcome back" state, no agent activity summary, no re-orientation help. Tom didn't know what agents did while he was gone.
Screen/location: /today, /dashboard
User impact: 10+ minutes to become productive again. At risk of abandonment.
Remediation plan: Add a "welcome back" section to /today that shows recent agent activity and highlights changes since last login.
Resolving commits: 9f109df

### FRICTION-0007
Title: No decision synthesis view for parcel evaluation
Severity: CRITICAL
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, David, Jenna
Journeys affected: J2
Description: Data spread across 4 tabs (Overview, Intel, Comps, AI Offer) is never unified into a go/no-go recommendation. Users cannot form a decision.
Screen/location: properties.tsx property detail dialog
User impact: Journey 2 acceptance criteria fail — no user reached a confident decision.
Remediation plan: Add a "Decision Summary" card at top of property detail that synthesizes key metrics into a clear recommendation with confidence score.
Resolving commits: (see properties.tsx Quick Verdict card commit)

## HIGH

### FRICTION-0008
Title: Landing page has no product screenshots
Severity: HIGH
Status: OPEN
Surfaced in runs: run-01
Personas affected: Maria, David, Chris, Sarah, Priya, Jenna
Journeys affected: J1
Description: Entire landing page is text-only. No screenshots, no demo video, no visual proof the product exists. Skeptical users cannot evaluate.
Screen/location: landing.tsx
User impact: Multiple personas noted "I can't tell what this actually looks like" — damages credibility.
Remediation plan: Add 2-3 product screenshots in a carousel or feature showcase section.
Resolving commits: pending

### FRICTION-0009
Title: Auth page strips all AcreOS branding
Severity: HIGH
Status: FIXED
Surfaced in runs: run-01
Personas affected: David, Jenna, Sarah, Robert
Journeys affected: J1
Description: /auth renders a bare Clerk widget — no logo, no nav, no context. Feels like a phishing page.
Screen/location: /auth (auth-page.tsx)
User impact: Trust damage. Sarah would flag this in enterprise evaluation.
Remediation plan: Add AcreOS logo and minimal branding wrapper around Clerk widget.
Resolving commits: 9d4df2b

### FRICTION-0010
Title: Landing page jargon alienates beginners
Severity: HIGH
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, Robert, Jenna
Journeys affected: J1
Description: Terms like GIS, TCPA, DNC, APN, "serious operators" used without explanation. Beginners feel excluded.
Screen/location: landing.tsx hero and feature sections
User impact: Maria: "This isn't for me." Robert: "I don't understand half of this."
Remediation plan: Replace or explain jargon. Lead with benefits, not features.
Resolving commits: 06b3fe8

### FRICTION-0011
Title: AI analysis is freeform chat, not structured output
Severity: HIGH
Status: OPEN
Surfaced in runs: run-01
Personas affected: Maria, David, Jenna
Journeys affected: J2
Description: "Analyze with AI" opens a chat that waits for questions instead of proactively delivering analysis. Responses are plain text walls.
Screen/location: property-analysis-chat.tsx
User impact: David: "I wanted a report, not a chatbot." Maria: "What do I even ask?"
Remediation plan: Add a "Quick Analysis" button that generates structured output (summary, comps, recommendation) without requiring user to formulate questions.
Resolving commits: pending

### FRICTION-0012
Title: No source attribution on financial data
Severity: HIGH
Status: OPEN
Surfaced in runs: run-01
Personas affected: David, Jenna
Journeys affected: J2
Description: Assessed values, comp prices, and market estimates show no data source, retrieval date, or confidence indicator.
Screen/location: properties.tsx intelligence tab, comps-analysis.tsx
User impact: David: "Where does this number come from? I don't trust it."
Remediation plan: Add data provenance badge (source + date) to every financial data point.
Resolving commits: pending

### FRICTION-0013
Title: No public API documentation or webhook support
Severity: HIGH
Status: OPEN
Surfaced in runs: run-01
Personas affected: Marcus, Priya
Journeys affected: J1
Description: Power users and technical users expect API access. REST endpoints exist internally but are undocumented.
Screen/location: Landing page, settings
User impact: Marcus: "No API = toy product." Would not adopt for 10K+ parcel operation.
Remediation plan: P2 for post-launch — document API endpoints and add API key management.
Resolving commits: pending

### FRICTION-0014
Title: Billing toggle inaccessible to screen readers
Severity: HIGH
Status: FIXED
Surfaced in runs: run-01
Personas affected: Alex
Journeys affected: J1
Description: Monthly/Annual pricing toggle has no role, aria-checked, or aria-label. Completely invisible to screen readers.
Screen/location: pricing.tsx billing toggle
User impact: Alex cannot switch billing period. WCAG Level A failure.
Remediation plan: Add role="switch", aria-checked, aria-label to toggle button.
Resolving commits: 6fea5be

### FRICTION-0015
Title: Pax responds to navigation questions with investor jargon
Severity: HIGH
Status: FIXED
Surfaced in runs: run-01
Personas affected: Robert
Journeys affected: J5, J7
Description: Simple questions like "how do I see my properties' value?" get responses full of investment terminology instead of plain step-by-step guidance.
Screen/location: floating-assistant.tsx, Pax system prompt
User impact: Robert: "I just wanted a straight answer." Stops using the assistant.
Remediation plan: Adjust Pax system prompt to detect user's experience level and respond accordingly.
Resolving commits: (see executive.ts prompt update commit)

### FRICTION-0016
Title: No currency labels on financial figures
Severity: HIGH
Status: FIXED
Surfaced in runs: run-01
Personas affected: Priya
Journeys affected: J1
Description: All monetary values displayed without currency symbol context. International users cannot tell if values are USD.
Screen/location: Throughout pricing, property values
User impact: Priya: "Are these Canadian dollars? I can't assume."
Remediation plan: Ensure all monetary displays include USD indicator.
Resolving commits: 82544ed

## MEDIUM

### FRICTION-0017
Title: Onboarding wizard assumes acquisition investor
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: Robert
Journeys affected: J1
Description: No onboarding path for existing property owners who want to manage, not acquire. All paths funnel into deal-hunting.
Screen/location: onboarding-v2.tsx
User impact: Robert: "I don't want to buy more land, I want to track what I have."
Resolving commits: pending

### FRICTION-0018
Title: Weak social proof on landing page
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: David, Chris, Sarah
Journeys affected: J1
Description: "500+ properties managed" is unimpressive for an enterprise tool. No testimonials, case studies, or customer logos.
Screen/location: landing.tsx
Resolving commits: pending

### FRICTION-0019
Title: No skip-to-content link on landing page
Severity: MEDIUM
Status: FIXED
Surfaced in runs: run-01
Personas affected: Alex
Journeys affected: J1
Description: Landing page has no skip link. Alex must tab through entire nav to reach content.
Screen/location: landing.tsx
Resolving commits: pending

### FRICTION-0020
Title: Pricing table check/X icons unlabeled for screen readers
Severity: MEDIUM
Status: FIXED
Surfaced in runs: run-01
Personas affected: Alex
Journeys affected: J1
Description: Feature comparison uses visual check/X icons without text alternatives.
Screen/location: pricing.tsx
Resolving commits: pending

### FRICTION-0021
Title: Trial duration discrepancy (7 vs 14 days)
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: Robert
Journeys affected: J7
Description: Different parts of the app show different trial lengths.
Screen/location: settings.tsx, billing routes
Resolving commits: pending

### FRICTION-0022
Title: Settings page has 15 tabs causing mobile overflow
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: Robert, Chris
Journeys affected: J7, J8
Description: Tab bar overflows on smaller screens, tabs scroll off-screen.
Screen/location: settings.tsx
Resolving commits: pending

### FRICTION-0023
Title: Terminology inconsistency (professional vs investor)
Severity: MEDIUM
Status: FIXED
Surfaced in runs: run-01
Personas affected: Jenna
Journeys affected: J1
Description: Landing page says "real estate professionals" but onboarding, help, and meta tags say "real estate investors."
Screen/location: Multiple pages
Resolving commits: pending

### FRICTION-0024
Title: Tab labels use jargon abbreviations (Intel, DD, Comps)
Severity: MEDIUM
Status: FIXED
Surfaced in runs: run-01
Personas affected: Maria, Jenna
Journeys affected: J2
Description: Property detail tabs labeled "Intel", "DD", "Comps" without tooltips or full names.
Screen/location: properties.tsx property detail dialog
Resolving commits: pending

### FRICTION-0025
Title: Offer percentages presented without educational context
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: Jenna
Journeys affected: J2
Description: AI offer suggestions at 40-50% of market value look predatory without explanation of why land offers are below market.
Screen/location: ai-offer-generator.tsx
Resolving commits: pending

### FRICTION-0026
Title: GDPR export requires 4 separate downloads
Severity: MEDIUM
Status: OPEN
Surfaced in runs: run-01
Personas affected: Chris
Journeys affected: J8
Description: Entity exports (leads, properties, deals, notes) are separate downloads rather than one unified export.
Screen/location: data-export routes
Resolving commits: pending

---

## Summary

| Severity | Open | Fixed | Total |
|----------|------|-------|-------|
| CRITICAL | 0 | 7 | 7 |
| HIGH | 3 | 6 | 9 |
| MEDIUM | 6 | 4 | 10 |
| LOW | 0 | 0 | 0 |
| **Total** | **9** | **17** | **26** |

### Convergence Status
- CRITICAL: 0 OPEN (threshold: 0) — MET
- HIGH: 3 OPEN (threshold: <5) — MET
- MEDIUM: 6 OPEN (threshold: <20) — MET

**All thresholds met.** Need 3 consecutive clean simulation runs to confirm convergence.

### Remaining Open HIGH (3)
- FRICTION-0008: No product screenshots on landing page (content, not code)
- FRICTION-0011: AI analysis is freeform chat, not structured output
- FRICTION-0012: No source attribution on financial data
- FRICTION-0013: No public API docs (P2 deferral candidate)
