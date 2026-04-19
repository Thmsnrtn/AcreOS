# Persona Simulation: Jenna Okafor -- J1 Landing to First Parcel

**Persona:** Jenna Okafor, 29, product designer, Seattle
**Device:** Laptop 1280x720
**Network:** Fast
**Session:** Fresh (no cookies, no auth state)
**Budget:** $50K to invest
**Mental model:** Trusts polish as proxy for quality; will Google unfamiliar terms
**Journey:** Landing -> Understand -> Sign Up -> First Parcel in System
**Date:** 2026-04-18

---

## Step 0: Pre-arrival Context

Jenna found AcreOS via a Reddit thread about passive income from land. She has $50K and is evaluating tools. She types `acreos.fly.dev` into her browser.

---

## Step 1: Landing Page Loads -- `acreos.fly.dev/`

### What Jenna Sees

**Nav bar (sticky top):**
`[A] AcreOS` ---- `Pricing` | `Sign In` | `[Get Started Free]`

**Hero section:**
- Badge: "Now in Public Beta"
- H1: "The operating system for **real estate professionals**"
- Subhead: "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI."
- Niche badges: Wholesaling, Fix & Flip, Buy & Hold, STR / Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes
- CTAs: `[Start Free ->]` `[View Pricing]`

**Social proof bar:**
- 18 Free data sources | $0 To get started | 14 Day free trial | 500+ Properties managed

**Features grid (6 cards):**
1. Portfolio Mapping -- "Visualize every parcel on interactive maps with GIS overlays, flood zones, and zoning data."
2. AI Valuations -- "Instant property valuations powered by comps analysis and 18 open data sources."
3. AI Deal Intelligence -- "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities."
4. Document Generation -- "Auto-generate purchase agreements, contracts, and closing documents in seconds."
5. Campaign Automation -- "Multi-channel outreach with SMS, email, and direct mail sequences."
6. Compliance Built-In -- "TCPA consent tracking, DNC list checks, and audit trails for every communication."

**Pricing teaser (4 mini-cards):**
- Free $0 -- "10 leads, 3 properties"
- Starter $20/mo -- "250 leads, campaigns"
- Pro $49/mo -- "500 leads, BYOK, unlimited" (highlighted border)
- Scale $79/mo -- "10 seats, unlimited everything"
- CTA: `[See Full Comparison]`

**Final CTA section:**
- "Ready to modernize your real estate business?"
- "Join operators who are closing more deals with less effort."
- `[Get Started Free ->]`

**Footer:**
- (c) 2026 AcreOS. All rights reserved. | Pricing | Sign In

**Cookie consent banner (bottom fixed):**
- "We use cookies and similar technologies to improve your experience. By continuing, you agree to our Privacy Policy and Terms of Service."
- `[Decline]` `[Accept All]`

### Jenna's Internal Monologue

> "Okay, clean landing page. The gradient on 'real estate professionals' is nice -- it's not screaming 'BUY NOW' at me. Public Beta badge is honest, I respect that. But I'm a designer, so let me look closer..."

> "The hero copy is good -- 'replaces your spreadsheets, disconnected tools, and guesswork' speaks to a real pain point. The niche badges tell me it's not just for land, which is what I'm interested in. Good."

> "Wait -- 'Sophie, your AI copilot'? That's a character name dropped into a feature card with zero context. Who is Sophie? Is she a chatbot? An agent? I'd Google that but there's nothing to Google."

> "'BYOK Data Providers' -- I have to Google BYOK. Bring Your Own Key? That's developer jargon on a landing page for real estate people. Friction."

> "500+ Properties managed -- that's a pretty small number for social proof. Most SaaS would hide that stat until it's at least 10K. Makes me wonder how new this is."

> "'TCPA consent tracking, DNC list checks' -- I need to Google both of those. I know I'm not the target expert user, but if I'm evaluating this as a product, the landing page shouldn't make me feel dumb."

### Friction Events

| # | Severity | Type | Description |
|---|----------|------|-------------|
| F1 | Medium | Jargon | "BYOK Data Providers" in pricing teaser -- acronym unexplained. Jenna Googles it. |
| F2 | Low | Jargon | "TCPA consent tracking, DNC list checks" -- compliance jargon without tooltip or explanation. |
| F3 | Low | Unexplained | "Sophie, your AI copilot" -- character name introduced without any prior context or visual. |
| F4 | Medium | Social proof | "500+ Properties managed" is a weak vanity metric. Undermines credibility for someone who trusts polish. |
| F5 | Low | Copy | Meta description and OG tags say "real estate investors" but H1 says "real estate professionals" -- terminology inconsistency. |
| F6 | Medium | A11y | Zero `aria-label` attributes on the entire landing page. No visible focus states on custom elements. |
| F7 | Low | Animation | Landing page uses no Framer Motion animations despite the codebase providing `staggerContainer` and `staggerItem`. The page feels static compared to what the design system supports. |
| F8 | Low | Cookie banner | Banner appears immediately on first load before user has any context. Standard practice but adds visual clutter at the bottom of a 720px viewport. |

### Positive Observations

| # | Type | Description |
|---|------|-------------|
| P1 | Copy | "The operating system for real estate professionals" is a strong positioning statement. Clear and differentiated. |
| P2 | Layout | Clean information hierarchy: badge -> headline -> subhead -> niche tags -> CTAs. Professional. |
| P3 | Pricing transparency | Showing pricing tiers directly on the landing page (not hidden behind "Contact Sales") builds trust. |
| P4 | Design | Consistent use of shadcn/ui design tokens. No hardcoded colors. Proper dark mode support with FOUC prevention. |
| P5 | CTA clarity | "Start Free" and "Get Started Free" are unambiguous. No dark patterns. |

---

## Step 2: Jenna Clicks "View Pricing" -- `acreos.fly.dev/pricing`

### What Jenna Sees

**Nav bar:**
`[<- A AcreOS]` ---- `[Get Started]`

**Header:**
- H1: "Simple, transparent pricing"
- Subhead: "Start free. Upgrade when you're ready. Every paid plan includes a 14-day free trial."

**Billing toggle:**
- `Monthly` [toggle switch] `Annual`
- (When Annual is toggled on: "Save 20%" badge appears)

**Tier cards (4 columns):**

| | Free | Starter | Pro (Most Popular) | Scale |
|---|---|---|---|---|
| Description | "Explore the platform" | "Replace your spreadsheet" | "For serious operators" | "For growing teams" |
| Price | $0 | $20/mo | $49/mo | $79/mo |
| CTA | Get Started | Start 14-Day Free Trial | Start 14-Day Free Trial | Start 14-Day Free Trial |

**Feature comparison table (16 rows):**

| Feature | Free | Starter | Pro | Scale |
|---|---|---|---|---|
| Leads | 10 | 250 | 500 | Unlimited |
| Properties | 3 | 50 | 100 | Unlimited |
| Notes | 2 | 25 | 50 | Unlimited |
| AI Requests / day | 25 | 500 | 1,000 | Unlimited |
| Campaigns | X | 5 | Unlimited | Unlimited |
| Sequences | X | 2 | Unlimited | Unlimited |
| BYOK Data Providers | X | X | Check | Check |
| Team Seats | 1 | 1 | 2 (add more at $20/seat) | 10 (add more at $40/seat) |
| Open Data Sources (18) | Check | Check | Check | Check |
| AI Deal Intelligence | Check | Check | Check | Check |
| Document Generation | Check | Check | Check | Check |
| Portfolio Mapping | Check | Check | Check | Check |
| Stripe Connect Payments | X | Check | Check | Check |
| Direct Mail Integration | X | Check | Check | Check |
| SMS/Voice Outreach | X | X | Check | Check |
| Priority Support | X | X | Check | Check |

**Enterprise CTA:**
- "Need custom enterprise pricing? Contact us." (mailto:hello@acreos.com)

**Footer:**
- (c) 2026 AcreOS. All rights reserved. | Home | Sign In

### Jenna's Internal Monologue

> "Okay, this is what I wanted. Four tiers, clear feature matrix. I like that there's a free tier -- I can kick the tires before committing."

> "The annual toggle is smooth. Save 20% on annual. Standard but effective."

> "3 properties on the free tier? I have $50K -- I might want to look at 5-10 parcels before buying one. That's a hard cap that'll force me to upgrade before I've even bought anything."

> "'BYOK Data Providers' shows up again with zero explanation. I already Googled it, but this is the pricing page -- the place where you're asking me to give you money. Explain what it means."

> "'Notes' as a feature limit -- does that mean sticky notes? Promissory notes? Seller-financed notes? The word is ambiguous. I'd assume seller-financed notes based on context but I shouldn't have to assume."

> "Wait -- 'For serious operators'? That's the Pro tier tagline. Is someone who's investing $50K not serious? This copy subtly gatekeeps. Make it aspirational, not exclusionary."

> "The billing toggle has no `aria-label`. It's a custom `<button>` element with no accessible name. As a designer, that's a red flag -- it tells me the team might be shipping fast and skipping polish."

### Friction Events

| # | Severity | Type | Description |
|---|----------|------|-------------|
| F9 | Medium | Jargon | "BYOK Data Providers" still unexplained -- now on the page where conversion matters most. |
| F10 | Medium | Ambiguity | "Notes" limit (2/25/50/Unlimited) is ambiguous. Seller-financed notes? Text notes? No tooltip. |
| F11 | Low | Copy tone | "For serious operators" (Pro tier) feels gatekeeping. A $50K first-time investor may not self-identify as a "serious operator." |
| F12 | High | A11y | Billing toggle is a custom `<button>` with no `aria-label`, no `role="switch"`, and no `aria-checked`. Screen readers cannot identify what it does. |
| F13 | Medium | A11y | Feature comparison table checkmarks (green Check icons) and X marks have no `aria-label` or `sr-only` text. Screen reader users hear nothing. |
| F14 | Low | Constraint | Free tier caps at 3 properties. For a buyer evaluating multiple parcels, this forces upgrade before any value is realized. |
| F15 | Low | Missing info | No FAQ section. Common questions (cancellation policy, data export, what happens when trial ends) are unanswered. |
| F16 | Low | Navigation | Back arrow (<-) in nav links to `/` but has no `aria-label="Back to home"`. |

### Positive Observations

| # | Type | Description |
|---|------|-------------|
| P6 | Transparency | Full 16-row feature matrix visible without login. No "talk to sales" gatekeeping. |
| P7 | Design | "Most Popular" badge on Pro tier uses proper visual hierarchy (border, shadow, ring). |
| P8 | Pricing strategy | 14-day free trial on all paid plans removes purchase anxiety. |
| P9 | Contact option | Enterprise email link present for custom needs. |

---

## Step 3: Jenna Clicks "Get Started" -- `acreos.fly.dev/auth`

### What Jenna Sees

**Full-screen centered layout:**
- Clerk-hosted `<SignIn>` component (hash routing)
- Email/password form with social login options (Google, etc.)
- Toggle text below: "Need an account? Sign up"

The page uses Clerk's default sign-in widget. When Jenna clicks "Need an account? Sign up", the widget swaps to `<SignUp>` with:
- Email field
- Password field
- Social login options (Google OAuth, etc.)
- Toggle: "Already have an account? Sign in"

### Jenna's Internal Monologue

> "Clean auth page. Just the Clerk widget centered on the screen. No marketing copy, no 'why sign up' reinforcement. That's... fine? But also a missed opportunity. I just came from a pricing page -- remind me what I'm getting."

> "I appreciate that there's Google sign-in. I don't want to create yet another password. Let me click Google."

> "The toggle between sign-in and sign-up is a tiny text link below the widget. Easy to miss. Should be more prominent if this is the primary signup flow."

> "After I sign up with Google OAuth, the `fallbackRedirectUrl` sends me to `/today`. There's a brief loading spinner (the `animate-spin` circle) while the app resolves my Clerk session against the backend user model."

### Friction Events

| # | Severity | Type | Description |
|---|----------|------|-------------|
| F17 | Medium | Missing context | Auth page has zero marketing copy. No "Start your 14-day free trial" or feature reminder. User loses momentum. |
| F18 | Low | Discoverability | Sign-in/sign-up toggle is plain `text-muted-foreground` text. At 1280x720, it's easy to miss below the Clerk widget. |
| F19 | Low | Loading state | Post-OAuth spinner is a raw `animate-spin` circle, not the codebase's Skeleton pattern. Inconsistent with loading state guidelines. |
| F20 | Low | URL | Default mode is sign-in, not sign-up. A user clicking "Get Started Free" expects to land on a registration form, not a login form. The URL parameter `?mode=register` exists but the CTA buttons don't use it. |

### Positive Observations

| # | Type | Description |
|---|------|-------------|
| P10 | Security | Clerk proxy (`/__clerk`) used for auth -- no direct Clerk domain exposure. Professional setup. |
| P11 | UX | `fallbackRedirectUrl="/today"` means the user lands on a useful page after auth, not a blank dashboard. |
| P12 | OAuth | Google SSO available, reducing friction for first-time signup. |

---

## Step 4: Post-Auth -- Onboarding Flow

### What Jenna Sees

After successful auth, Jenna is redirected to `/today`. Two things appear:

**1. Onboarding Modal (dialog overlay):**
5-step guided walkthrough:
1. "Welcome to AcreOS" -- "The operating system for real estate investors. Let's get you set up for success."
2. "Manage Your Leads" -- "Track sellers and buyers in one place."
3. "Track Your Properties" -- "Manage your entire inventory from prospect to sold."
4. "Close Deals" -- "Manage acquisitions and dispositions."
5. "Stay Notified" -- "Configure notifications."

Each step has an animated icon, description, highlight tip, dot navigation, and Skip/Next buttons.

**2. Today Hub (behind the modal):**
The main dashboard with stat cards, activity feed, goals, and next-best-action suggestions.

### Jenna's Internal Monologue

> "Okay, onboarding wizard. Five steps. This is standard -- Notion does this, Linear does this. Let me read through."

> "Step 1 says 'The operating system for real estate investors' -- but the landing page said 'real estate professionals.' Which is it? This feels like copy was written at different times and never harmonized."

> "The steps tell me ABOUT features but don't actually DO anything. Step 2 says 'Add your first lead to start building your pipeline' but there's no input field, no button to add a lead. It's a slideshow, not an interactive onboarding. I'm clicking Next five times to dismiss a tutorial I could have read on the landing page."

> "Where do I add my first property? The modal told me about properties but didn't give me a path to create one. I have to dismiss the wizard and then figure out where 'Properties' lives in the sidebar."

> "Actually, I came here to add a parcel. The journey from 'Get Started Free' to 'add a parcel' required: landing page -> pricing page -> auth page -> sign up -> onboarding wizard (5 clicks to dismiss) -> find Properties in sidebar -> figure out how to create a property. That's a lot of friction for the core action."

### Friction Events

| # | Severity | Type | Description |
|---|----------|------|-------------|
| F21 | High | Copy inconsistency | Onboarding modal says "real estate investors" (line 19 of onboarding-modal.tsx). Landing page H1 says "real estate professionals." The project CLAUDE.md explicitly requires "real estate professional" terminology. |
| F22 | High | Passive onboarding | 5-step wizard is a passive slideshow with no interactive elements. User clicks "Next" 5 times without performing any action. No property creation, no lead import, no data entry. Does not accelerate time-to-value. |
| F23 | Medium | Missing direct path | No "Add Your First Property" CTA in the onboarding flow or on the Today page. The core user goal (get a parcel in the system) requires navigation discovery. |
| F24 | Low | Redundancy | Onboarding wizard content duplicates landing page feature descriptions almost verbatim. User reads the same value props twice. |

### Positive Observations

| # | Type | Description |
|---|------|-------------|
| P13 | Animation | Onboarding modal uses proper AnimatePresence with scale/opacity transitions. Polished feel. |
| P14 | Skip option | Skip button is available -- power users aren't trapped. |
| P15 | Persistence | Onboarding completion state is saved to organization settings. Won't re-appear on next login. |

---

## Step 5: Finding the Properties Page

Jenna dismisses the onboarding wizard and looks at the Today hub. She needs to find where to add a property/parcel.

> "Okay, I see a sidebar. Let me look for 'Properties' or 'Parcels' or 'Portfolio'... There it is in the sidebar nav. Let me click Properties."

The Properties page loads (lazy-loaded via React.lazy) with a Suspense fallback spinner.

### Friction Events

| # | Severity | Type | Description |
|---|----------|------|-------------|
| F25 | Low | Terminology | Jenna searched for "Parcels" but the system calls them "Properties." No search/command palette visible to help. (Command palette exists at `Cmd+K` but is not advertised.) |

---

## Journey Summary

### Total Friction Events: 25

| Severity | Count |
|----------|-------|
| High | 3 (F12, F21, F22) |
| Medium | 7 (F1, F4, F6, F9, F10, F17, F23) |
| Low | 15 |

### Critical Path Steps

1. Land on `/` -- understand product (2-3 minutes reading)
2. Click "View Pricing" -> `/pricing` -- evaluate cost (1-2 minutes)
3. Click "Get Started" -> `/auth` -- sign up via Google OAuth (30 seconds)
4. Post-auth redirect -> `/today` with onboarding modal (5 clicks to dismiss, ~1 minute)
5. Navigate to Properties via sidebar (discovery required)
6. Create first property (requires finding the "Add" button)

**Estimated time from landing to first parcel in system: 6-8 minutes**

### Jenna's Verdict

> "The bones are here. The design system is clean, the pricing is transparent, and the feature set is genuinely impressive for a beta. But the journey from 'interested visitor' to 'first property added' has too many dead-air moments."

> "The onboarding wizard is the biggest miss. It TELLS me what I can do but doesn't HELP me do it. If step 3 ('Track Your Properties') had an inline form to add my first parcel -- APN, state, county -- I'd be hooked in 60 seconds instead of hunting through the sidebar."

> "The accessibility issues are concerning. Custom toggle buttons without ARIA attributes, icon-only elements without labels, feature table checkmarks that are invisible to screen readers. As a designer, these tell me the team is shipping features faster than they're polishing them."

> "Copy inconsistency between 'investors' and 'professionals' is a small thing that signals a bigger thing: brand identity isn't locked down yet. Pick one and find-replace."

**Overall impression: 6.5/10 -- Promising product, immature onboarding. Would try the free tier but wouldn't upgrade until the first-run experience feels guided rather than self-serve.**

---

## Top 5 Recommendations

### 1. Make Onboarding Interactive (HIGH PRIORITY)
Replace the passive 5-step slideshow with an interactive wizard that results in the user's first property being created. Step 3 should have an APN/address input field, not a description of what properties are.

### 2. Fix Auth Page CTA Alignment (MEDIUM)
The "Get Started Free" button on the landing page should link to `/auth?mode=register`, not `/auth`. Users clicking "Get Started" expect signup, not signin. The code already supports `?mode=register` but no CTA uses it.

### 3. Eliminate Jargon on Public Pages (MEDIUM)
Replace or annotate "BYOK," "TCPA," and "DNC" with plain-language equivalents or tooltips on the landing and pricing pages. These are the pages that convert visitors to users.

### 4. Add ARIA Attributes to Interactive Elements (HIGH PRIORITY)
The billing toggle on `/pricing` needs `role="switch"`, `aria-checked`, and `aria-label="Toggle annual billing"`. The feature table needs `aria-label` on Check/X icons. The landing page nav buttons and icon elements need proper labels.

### 5. Harmonize Terminology (LOW but SYMBOLIC)
The codebase CLAUDE.md mandates "real estate professional." The onboarding modal (line 19), help-content.tsx (line 153), settings.tsx (line 1852), and meta tags all still say "real estate investor." Do a project-wide find-and-replace.

---

## Files Examined

- `/Users/user/AcreOS/AcreOS/client/src/pages/landing.tsx` -- Landing page component
- `/Users/user/AcreOS/AcreOS/client/src/pages/pricing.tsx` -- Pricing page component
- `/Users/user/AcreOS/AcreOS/client/src/pages/auth-page.tsx` -- Auth page component
- `/Users/user/AcreOS/AcreOS/client/src/components/onboarding-modal.tsx` -- Post-auth onboarding wizard
- `/Users/user/AcreOS/AcreOS/client/src/components/cookie-consent-banner.tsx` -- Cookie consent banner
- `/Users/user/AcreOS/AcreOS/client/src/App.tsx` -- Router and route definitions
- `/Users/user/AcreOS/AcreOS/client/src/main.tsx` -- Clerk provider configuration
- `/Users/user/AcreOS/AcreOS/client/src/lib/animations.ts` -- Animation variants (unused on landing)
