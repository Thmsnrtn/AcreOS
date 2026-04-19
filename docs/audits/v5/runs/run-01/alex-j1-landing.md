# Persona Simulation: Alex Petrov -- J1 Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Alex Petrov, 31, blind data analyst & accessibility consultant, Richmond VA |
| Device | Desktop 1440x900 |
| Browser | Firefox (latest stable) |
| Screen Reader | NVDA (latest stable) |
| Input | Keyboard only (no mouse, monitor is off) |
| Network | Fast |
| Session | Fresh (no cookies, no auth state) |
| Date | 2026-04-18 |

---

## Persona Context

Alex has been fully blind for 12 years. He is an expert screen reader user who navigates complex enterprise applications (Jira, Confluence, Salesforce, QGIS) daily for paying clients. He is evaluating AcreOS's accessibility on behalf of a client considering a team-wide rollout. He tests systematically: landmarks, headings, interactive elements, forms, dynamic content, data tables, and modal behavior. He cites WCAG 2.1 success criteria by number.

His standard is not "can a screen reader parse this page" but "can I complete the task as efficiently as a sighted user, or within a reasonable margin."

> "If I can't tab to it, it doesn't exist. If it doesn't announce, it didn't happen. I've been doing this for 12 years -- I can tell in 5 minutes whether your team thought about accessibility or just checked a box."

---

## Step 1: Landing Page -- Landmark and Heading Analysis

**Action:** Alex navigates to `acreos.fly.dev`. NVDA announces the page title: "AcreOS -- The Operating System for Real Estate Investors."

**First action:** Alex presses `D` (NVDA landmark navigation) to survey the page's landmark regions.

### Landmark Audit

The landing page structure in `landing.tsx`:

```
<div class="min-h-screen bg-background">
  <nav class="border-b ...">          <!-- nav landmark: YES -->
  <section class="py-24 px-6">        <!-- hero: NO landmark role -->
  <section class="border-y ...">      <!-- social proof: NO landmark role -->
  <section class="py-24 px-6">        <!-- features: NO landmark role -->
  <section class="py-24 px-6 ...">    <!-- pricing teaser: NO landmark role -->
  <section class="py-24 px-6">        <!-- final CTA: NO landmark role -->
  <footer class="border-t ...">       <!-- footer landmark: YES -->
</div>
```

NVDA detects two landmarks:
1. **Navigation** (the `<nav>` element)
2. **Content information** (the `<footer>` element)

**Missing:** No `<main>` landmark. The content between nav and footer is a bare `<div>` with no `role="main"` or `<main>` element. NVDA cannot jump directly to the main content.

The `<section>` elements do not have `aria-label` or `aria-labelledby` attributes, so NVDA does not announce them as named regions. They are semantically invisible as landmarks.

**FRICTION EVENT F-01: No `<main>` landmark.** (WCAG 1.3.1 Info and Relationships, Level A)
Without a `<main>` element, Alex cannot use NVDA's landmark navigation to jump past the nav directly to the primary content. He must either Tab through the nav or use heading navigation.

**FRICTION EVENT F-02: No skip-to-content link.** (WCAG 2.4.1 Bypass Blocks, Level A)
There is no skip link (`<a href="#main-content">Skip to content</a>`) at the top of the page. Combined with the missing `<main>` landmark, Alex has no efficient way to bypass the navigation.

---

### Heading Analysis

Alex presses `H` (NVDA heading navigation) to survey the heading hierarchy.

Headings found:

1. **H1:** "The operating system for real estate professionals" (hero headline)
2. **H2:** "Everything you need to run your real estate business" (features section)
3. **H3:** "Portfolio Mapping" (feature card)
4. **H3:** "AI Valuations" (feature card)
5. **H3:** "AI Deal Intelligence" (feature card)
6. **H3:** "Document Generation" (feature card)
7. **H3:** "Campaign Automation" (feature card)
8. **H3:** "Compliance Built-In" (feature card)
9. **H2:** "Simple, transparent pricing" (pricing teaser)
10. **H3:** "Free" (tier card)
11. **H3:** "Starter" (tier card)
12. **H3:** "Pro" (tier card)
13. **H3:** "Scale" (tier card)
14. **H2:** "Ready to modernize your real estate business?" (final CTA)

**Assessment:** The heading hierarchy is correct. One H1, multiple H2 sections, H3 subsections. No skipped levels, no out-of-order headings. This is well-structured.

> "Good heading structure. H1 at the top, H2 for each section, H3 for subsections. I can build a mental model of this page from the headings alone. That's how it should be."

---

### Nav Element Audit

Alex presses `Tab` to navigate through the nav bar.

**Tab stops in nav:**
1. **"Pricing"** -- announced as "link, Pricing." This is a `<a>` element (Button `asChild` wrapping a Link). Correct role.
2. **"Sign In"** -- announced as "link, Sign In." Correct.
3. **"Get Started Free"** -- announced as "link, Get Started Free." Correct.

All three nav items have correct roles, accessible names, and are keyboard-operable (Enter activates).

**Issue:** The AcreOS logo/wordmark is a `<div>` containing a gradient square and a `<span>` with "AcreOS." It is not a link (there's no `<a>` wrapping it on the landing page nav). NVDA reads it as regular text: "A AcreOS." Not a link, not interactive. This is fine -- the logo doesn't need to be a link on the homepage (you're already there). But the gradient square's "A" text inside it is decorative and adds noise to the screen reader output.

---

## Step 2: Hero Section Audit

**Action:** Alex continues tabbing or uses arrow keys in browse mode to read the hero content.

**NVDA reads (in browse mode, sequential reading):**

1. "Now in Public Beta" -- the Badge component renders as a `<div>` with styling. It has no special role. NVDA reads it as text. This is fine.

2. "The operating system for real estate professionals" -- H1 heading. The gradient-styled "real estate professionals" portion renders as a `<span>` inside the H1. NVDA reads the full heading text correctly -- CSS styling doesn't affect screen reader output. Good.

3. "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI." -- paragraph text. Read correctly.

4. **Strategy badges:** The 9 badges (Wholesaling, Fix & Flip, etc.) are rendered as Badge components. These are `<div>` elements with `role` inherited from the Badge component (likely no ARIA role -- just styled divs). NVDA reads them as: "Wholesaling Fix & Flip Buy & Hold STR / Airbnb Land Multifamily Commercial Creative Finance Notes" -- a continuous stream of text with no separation or context. They're not a list (`<ul>/<li>`).

**FRICTION EVENT F-03: Strategy badges not in a list structure.** (WCAG 1.3.1 Info and Relationships, Level A)
The 9 strategy badges are semantically a list of categories but are rendered as adjacent `<div>` elements inside a flex container. NVDA reads them as a continuous text block. Using a `<ul>` with `<li>` elements would let NVDA announce "list, 9 items" and allow list navigation. Minor issue but degrades comprehension.

5. **CTA buttons:** Tab lands on:
   - "Start Free" -- announced as "link, Start Free." The ArrowRight icon inside the button has no `aria-hidden="true"` attribute explicitly set. Lucide-react icons render as `<svg>` elements. If the SVG has no `aria-label` and no title, NVDA may read it as "graphic" or skip it entirely. If it reads as "link, Start Free graphic," that's slightly noisy but functional.
   - "View Pricing" -- announced as "link, View Pricing." Clean.

---

## Step 3: Social Proof Section

**NVDA reads:**
"18 Free data sources" -- "dollar sign 0 To get started" -- "14 Day free trial" -- "500 plus Properties managed"

**Assessment:** The social proof stats are readable. The "$0" renders as "dollar sign 0" which is correct but slightly awkward. No accessibility issues.

---

## Step 4: Features Section

**NVDA reads (using H key to jump between headings):**

- H2: "Everything you need to run your real estate business"
- H3: "Portfolio Mapping"
- H3: "AI Valuations"
- ...etc.

**Feature card structure:** Each card contains:
1. An icon (`<svg>` from lucide-react) -- does it have `aria-hidden="true"`? If not, NVDA may announce "graphic" before each card title. The icon is decorative (the heading text already conveys the feature name). It should be `aria-hidden="true"`.
2. An H3 heading with the feature name
3. A paragraph with the description

**FRICTION EVENT F-04: Decorative icons may not be hidden from screen reader.** (WCAG 1.1.1 Non-text Content, Level A)
The lucide-react icon components in feature cards render as `<svg>` elements. If they don't have `aria-hidden="true"`, NVDA announces them as "graphic" before each feature name. This adds noise to the reading experience. The icons are purely decorative -- the headings already convey the information.

**Reading the feature descriptions:**
- "Visualize every parcel on interactive maps with GIS overlays, flood zones, and zoning data." -- reads fine.
- "TCPA consent tracking, DNC list checks, and audit trails for every communication." -- reads fine. Alex knows what TCPA and DNC are (he works with enterprise software).

---

## Step 5: Pricing Teaser Section

**NVDA reads:** H2: "Simple, transparent pricing"

The 4 tier cards each have an H3 heading (tier name) and price text. The price values are rendered as:
```html
<div class="text-2xl font-bold mt-2">$0</div>
```

NVDA reads: "dollar sign 0," "dollar sign 20 slash mo," "dollar sign 49 slash mo," "dollar sign 79 slash mo." These are readable but not semantically marked as prices. No `aria-label` provides a more accessible reading (e.g., "49 dollars per month").

The tier descriptions ("10 leads, 3 properties," etc.) are readable.

The "See Full Comparison" link is focusable and announced as "link, See Full Comparison." Good.

---

## Step 6: Final CTA and Footer

**Final CTA:**
- H2: "Ready to modernize your real estate business?" -- heading navigation works.
- "Get Started Free" -- announced as "link, Get Started Free." The ArrowRight icon may add "graphic" noise.

**Footer:**
- "(c) 2026 AcreOS. All rights reserved." -- text, reads fine.
- "Pricing" -- link. "Sign In" -- link. Both announced correctly.

---

## Step 7: Pricing Page Accessibility Audit

**Action:** Alex presses Enter on the "Pricing" link. URL: `/pricing`.

### Landmark Audit (Pricing Page)

The pricing page has the same structure issue:
- `<nav>` -- yes, landmark detected
- No `<main>` element
- `<footer>` -- yes, landmark detected

**Same issues as landing page:** No skip link, no main landmark.

### Heading Audit (Pricing Page)

1. **H1:** "Simple, transparent pricing"
2. **H2:** "Feature Comparison"

The tier card headings use `<CardTitle>` which renders as... checking the component. CardTitle typically renders as an `<h3>` or styled `<div>`. In the pricing page, it uses `<CardTitle className="text-lg">` which likely renders as H3 within a CardHeader. So:

3. **H3:** "Free" (inside card)
4. **H3:** "Starter" (inside card)
5. **H3:** "Pro" (inside card)
6. **H3:** "Scale" (inside card)

Heading hierarchy appears correct.

### Billing Toggle Accessibility

The toggle button:
```html
<button onClick={...} class="relative inline-flex h-6 w-11 items-center rounded-full ...">
  <span class="inline-block h-4 w-4 transform rounded-full bg-white ..." />
</button>
```

**FRICTION EVENT F-05: Billing toggle has no accessible name, no role, no state.** (WCAG 4.1.2 Name, Role, Value, Level A)
The toggle button has:
- No `aria-label` (NVDA announces just "button")
- No `role="switch"` (NVDA doesn't know it's a toggle)
- No `aria-checked` (NVDA doesn't know the current state)
- No visible text inside the button (the "Monthly" and "Annual" text is outside the button element)

NVDA announces: "button." That's it. Alex doesn't know what the button does, what it toggles, or what the current state is. He presses Enter -- the visual state changes but NVDA announces nothing about the change.

> "There's a button. NVDA says 'button.' No label. I pressed it. Nothing was announced. I have no idea what I just did. Is this a toggle? A submit? A navigation action?"

This is a significant accessibility failure. The toggle controls whether prices show monthly or annual, but a screen reader user has no way to know this.

### Feature Comparison Table

The pricing page uses a proper `<table>` element with `<thead>`, `<tr>`, `<th>`, and `<td>`. This is good -- NVDA's table navigation commands work.

Alex presses `T` to jump to the table. NVDA announces: "table with 17 rows and 5 columns."

He uses Ctrl+Alt+ArrowRight/ArrowDown to navigate cells:

- Row 1 (header): "Feature" | "Free" | "Starter" | "Pro" | "Scale"
- Row 2: "Leads" | "10" | "250" | "500" | "Unlimited"

**Assessment:** The table is navigable and correctly structured. `<th>` elements in the header row have the correct semantics. Alex can move cell-by-cell and understand which value belongs to which column and which feature.

**Issue with Check/X icons:** The FeatureValue component renders boolean values as:
- `true`: `<Check className="h-4 w-4 text-green-500 mx-auto" />` (SVG)
- `false`: `<X className="h-4 w-4 text-muted-foreground/30 mx-auto" />` (SVG)

These SVG icons have no `aria-label`. NVDA may announce them as "graphic" or skip them entirely. Alex navigates to a cell with a checkmark: NVDA says "graphic." He doesn't know if it's a check or an X.

**FRICTION EVENT F-06: Check/X icons in pricing table have no accessible names.** (WCAG 1.1.1 Non-text Content, Level A)
The boolean feature values use Check and X SVG icons without `aria-label` attributes. NVDA announces both as "graphic" -- Alex cannot distinguish between "feature included" and "feature not included." These need `aria-label="Included"` and `aria-label="Not included"` (or visually hidden text alternatives).

> "The table structure is correct -- I can navigate it with table commands. But some cells just say 'graphic.' Is that a checkmark or an X? I'm looking at the BYOK Data Providers row and I literally cannot tell if the Free tier includes this or not."

---

## Step 8: Auth Page Accessibility Audit

**Action:** Alex navigates to the auth page. He tabs to "Get Started" in the pricing nav, presses Enter. URL: `/auth?mode=register`.

### Page Structure

The auth page is minimal:
```html
<div class="min-h-screen flex items-center justify-center bg-background">
  <div class="w-full max-w-md flex flex-col items-center gap-4">
    <SignUp ... />  <!-- Clerk widget -->
    <button>Need an account? Sign up / Already have an account? Sign in</button>
  </div>
</div>
```

No `<main>` landmark. No headings in the page itself (Clerk widget may inject its own headings).

### Clerk Widget Accessibility

The Clerk SignUp widget is a third-party component. Its accessibility depends on Clerk's implementation. Generally, Clerk widgets are reasonably accessible:
- Form inputs have labels
- Error messages are associated with fields via `aria-describedby`
- The widget has its own heading structure
- Social login buttons have accessible names

Alex tabs through the Clerk widget:
1. Email input -- announced as "email, edit" or similar (labeled)
2. Password input -- announced as "password, edit" (labeled)
3. Submit button -- announced as "button, Continue" or "button, Sign up"

**Assessment:** The Clerk widget is functional with a screen reader. Not perfect (Clerk has known accessibility gaps in some versions), but usable.

### Toggle Link Below Widget

The "Already have an account? Sign in" (or "Need an account? Sign up") is a `<button>` element. NVDA announces it as "button, Already have an account? Sign in." This is correctly labeled and operable.

---

## Step 9: Overall Accessibility Assessment

### WCAG 2.1 Level AA Compliance Summary

| Criterion | Status | Notes |
|---|---|---|
| 1.1.1 Non-text Content (A) | FAIL | Feature card icons and pricing table Check/X icons lack alt text / aria-labels. |
| 1.3.1 Info and Relationships (A) | FAIL | No `<main>` landmark. Strategy badges not in list structure. Billing toggle lacks role/state. |
| 1.3.2 Meaningful Sequence (A) | PASS | Reading order matches visual order. |
| 1.4.1 Use of Color (A) | NEEDS TESTING | Check (green) vs. X (gray) in pricing table relies on color + icon shape. Screen reader gets neither. |
| 2.1.1 Keyboard (A) | PASS | All interactive elements reachable and operable via keyboard. |
| 2.4.1 Bypass Blocks (A) | FAIL | No skip-to-content link on any page. |
| 2.4.2 Page Titled (A) | PASS | "AcreOS -- The Operating System for Real Estate Investors" |
| 2.4.3 Focus Order (A) | PASS | Tab order is logical (top to bottom, left to right). |
| 2.4.6 Headings and Labels (AA) | PASS | Headings are descriptive and accurately describe content. |
| 2.4.7 Focus Visible (AA) | PASS | shadcn/ui provides `focus-visible:ring-2` on interactive elements. |
| 3.1.1 Language of Page (A) | NEEDS CHECK | `<html>` element should have `lang="en"`. Not verified in the source. |
| 4.1.2 Name, Role, Value (A) | FAIL | Billing toggle has no name, no role, no value. Decorative icons lack aria-hidden. |

**Overall: Does NOT meet WCAG 2.1 Level AA.** Multiple Level A failures.

---

## Step 10: Can Alex Complete Journey 1?

**The question:** Can Alex sign up, navigate to the first authenticated view, and add a parcel -- entirely via screen reader and keyboard?

**Landing page:** Yes. Alex can read the landing page content, understand the product, and navigate to the auth page. Headings and links are well-structured.

**Auth page:** Likely yes. Clerk widget is reasonably accessible. Form fields are labeled. Submission works via keyboard.

**Authenticated app:** Unknown from this evaluation. The landing page and pricing page have moderate accessibility issues. The authenticated app (dashboards, forms, data tables, modals, toasts) would need separate testing. Based on the patterns observed:

- **If the app uses shadcn/ui components consistently:** Buttons, inputs, and form elements should have decent accessibility. shadcn/ui is built on Radix UI, which has strong ARIA support.
- **If the app uses custom components:** Same issues as the billing toggle -- missing labels, roles, and states.
- **Data tables:** The pricing table uses proper `<table>` semantics. If the parcel list view does the same, it would be navigable.
- **Toasts/notifications:** The toast system needs `aria-live` regions to announce success/error messages. If toasts appear visually without announcement, Alex won't know if actions succeeded.
- **Modals:** Need focus trapping on open and focus return on close. The onboarding wizard modal is a critical test.

**Alex's assessment:** "I can navigate the marketing pages. The heading structure is good. But there are multiple Level A failures -- no main landmark, no skip link, unlabeled toggle, unlabeled icons. These are basic accessibility requirements that any modern SPA should meet. I need to test the authenticated app before I can recommend it."

---

## Final Verdict: CONDITIONAL -- Needs Authenticated App Testing

Alex can navigate the unauthenticated pages (landing, pricing, auth) with meaningful friction but not complete blockers. The heading hierarchy is correct, interactive elements are keyboard-operable, and the Clerk widget is functional. However, multiple WCAG Level A failures exist on the marketing pages, which strongly suggests the authenticated app will have similar or worse issues.

Alex will sign up and test the authenticated workflows (add parcel, filter list, run agent, change settings) before writing his audit report. Based on the marketing page assessment, his preliminary rating is:

**Accessibility Grade: C- (Partial compliance, multiple Level A failures, needs remediation before team deployment)**

---

## Friction Events

| # | Event | Severity | WCAG Criterion | Description |
|---|-------|----------|----------------|-------------|
| F1 | No `<main>` landmark | HIGH | 1.3.1 (A) | Page content is wrapped in a bare `<div>`, not a `<main>` element. NVDA cannot jump to main content via landmark navigation. Affects all pages. |
| F2 | No skip-to-content link | HIGH | 2.4.1 (A) | No skip link on any page. Combined with missing main landmark, screen reader users must tab through the entire nav on every page load. |
| F3 | Strategy badges not in list structure | LOW | 1.3.1 (A) | 9 category badges are adjacent `<div>` elements, not a `<ul>/<li>` list. NVDA reads them as continuous text without "list, 9 items" announcement. |
| F4 | Decorative icons may lack `aria-hidden` | MEDIUM | 1.1.1 (A) | Lucide-react SVG icons in feature cards are decorative but may be announced as "graphic" by NVDA, adding noise to the reading experience. |
| F5 | Billing toggle completely inaccessible | CRITICAL | 4.1.2 (A) | The monthly/annual pricing toggle has no `aria-label`, no `role="switch"`, no `aria-checked`. NVDA announces "button" with no indication of purpose, state, or effect. |
| F6 | Check/X icons in pricing table unlabeled | HIGH | 1.1.1 (A) | Boolean feature values use Check/X SVG icons without accessible names. Both announce as "graphic." Screen reader users cannot distinguish between included and excluded features. |
| F7 | No `lang` attribute verification | LOW | 3.1.1 (A) | The `<html>` element should have `lang="en"` for NVDA to use correct pronunciation. Not confirmed in the HTML shell. |
| F8 | Auth page has no landmark structure | MEDIUM | 1.3.1 (A) | The auth page is a `<div>` with no `<main>`, no headings (outside the Clerk widget), and no landmarks. NVDA users land on the page with no orientation. |
| F9 | ArrowRight icon in CTA buttons may add noise | LOW | 1.1.1 (A) | The "Start Free" and "Get Started Free" buttons contain an ArrowRight SVG icon. If not `aria-hidden`, NVDA reads "link, Start Free graphic." Minor noise. |
| F10 | Price values lack semantic markup | LOW | 1.3.1 (A) | Prices like "$49/mo" are plain text in a `<div>`. No `aria-label` provides a cleaner reading (e.g., "49 dollars per month"). Readable but not optimal. |

---

## Recommendation Score

**5/10 -- Navigable but not accessible. Multiple Level A failures block compliance.**

The landing page has correct heading hierarchy, keyboard-operable controls, and a proper `<table>` for the pricing comparison. These are genuinely good signals -- the team understands semantic HTML for some elements. But the missing `<main>` landmark, missing skip link, completely unlabeled billing toggle, and unlabeled pricing table icons are Level A failures that would fail a formal accessibility audit.

For Alex's client (considering team-wide rollout), the recommendation will depend on the authenticated app. If the in-app experience has the same pattern -- some elements done correctly, others missing basic ARIA attributes -- Alex will recommend remediation before deployment. If the authenticated app is worse (custom dropdowns without roles, modals without focus trapping, toasts without live regions), Alex will recommend against deployment.

---

## Verbatim Quotes (Alex Would Say)

1. "The heading structure is correct. H1, H2, H3 in proper hierarchy. I can build a mental model of the page from headings alone. That tells me someone on this team understands document structure."

2. "No main landmark. No skip link. I press D and NVDA says 'navigation' then 'content information.' Everything between the nav and the footer is a void. I have to arrow through or use headings. This is basic accessibility -- every SPA needs a main element."

3. "There's a button on the pricing page. NVDA says 'button.' That's it. No label. I pressed it. Nothing was announced. I pressed it again. Still nothing. It turns out this is a monthly/annual toggle, but I had to have someone sighted tell me that. Role equals switch, aria-checked, aria-label -- three attributes would fix this."

4. "The pricing table is good. Real `<table>`, real `<th>` headers, I can navigate cell by cell. But some cells say 'graphic.' Check or X? Included or excluded? I'm staring at the most important decision-making table on the pricing page and I can't read half the cells."

5. "I can tell this team didn't completely ignore accessibility -- the heading structure is too clean for that. But they also didn't test with a screen reader. The gaps are exactly what you get when developers use semantic HTML by habit but skip ARIA attributes and screen reader testing."
