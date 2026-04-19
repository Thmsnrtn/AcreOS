# Maria Gutierrez - Journey 1: Landing to First Parcel

**Persona:** Maria Gutierrez, 34, marketing manager in Austin. Never bought land. Mobile-first iPhone user (375x812). Skims everything. Zero patience. Judges by visual design.
**Journey:** Landing to First Parcel
**Conditions:** 3G throttled | iPhone (375x812) | Fresh session | Solo
**Date:** 2026-04-18

---

## Step 1: Land on acreos.fly.dev

**What I tried to do:** "I clicked a link someone shared on Twitter. Let me see what this is."

**What I expected to see:** A clean consumer-grade landing page that tells me in 5 seconds what this product does and why I should care. Something like Notion or Linear's landing page -- big headline, clear value, screenshot of the product.

**What I actually saw:** The page loads an SPA shell first -- the HTML body is completely empty (`<div id="root"></div>`). On 3G throttle, I see a white screen for several seconds while ~1.08 MB of JavaScript downloads (index: 735 KB, vendor-react: 50 KB, vendor-ui: 295 KB). Once rendered:

- **Nav bar:** Logo ("A" gradient square + "AcreOS"), three buttons crammed together: "Pricing", "Sign In", "Get Started Free". On 375px width, these three buttons plus the logo compete for ~375px of horizontal space with only 24px padding on each side. The buttons likely wrap or get squeezed.
- **Hero badge:** "Now in Public Beta" in an outlined badge.
- **Hero headline:** "The operating system for real estate professionals" -- the word "professionals" is gradient-colored.
- **Subheadline:** "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI."
- **Category badges:** A row of 9 small badges: "Wholesaling", "Fix & Flip", "Buy & Hold", "STR / Airbnb", "Land", "Multifamily", "Commercial", "Creative Finance", "Notes". These wrap to multiple lines on mobile.
- **CTAs:** "Start Free" button (primary) and "View Pricing" button (outline), side by side.
- **Social proof strip:** 4 stats in a 2x2 grid: "18 Free data sources", "$0 To get started", "14 Day free trial", "500+ Properties managed".
- **Feature cards:** 6 cards stacked vertically: Portfolio Mapping, AI Valuations, AI Deal Intelligence, Document Generation, Campaign Automation, Compliance Built-In.
- **Pricing teaser:** 4 tier cards stacked on mobile (Free $0, Starter $20/mo, Pro $49/mo, Scale $79/mo). "See Full Comparison" button.
- **Final CTA:** "Ready to modernize your real estate business?" + "Get Started Free" button.
- **Footer:** Copyright + Pricing + Sign In links.

**My reaction:** confused

I have three specific problems:

1. **"Operating system for real estate professionals"** -- what does that even mean? Operating system? Am I installing something? I'm a marketing manager who heard about land investing. This tagline sounds like it's for someone who already knows what they're doing. It says "professionals" -- I'm not a professional. Am I even the right audience?

2. **The category badges are overwhelming.** Wholesaling? Fix & Flip? Creative Finance? Notes? I don't know what any of these mean. I thought this was about buying land. Why are there 9 different categories? This feels like enterprise software, not something for me.

3. **"500+ Properties managed"** is the social proof? That's... not impressive. That's like one medium-sized real estate agent's portfolio. Where are the testimonials? Where are the screenshots? I have no idea what this product looks like inside.

**Would I continue in real life?** maybe -- The $0 to get started and 14-day trial caught my eye, so I haven't closed the tab yet. But I'm already skeptical this is for someone like me.

---

## Step 2: Scroll through features

**What I tried to do:** "OK let me scroll down and see if there's a screenshot or video of the actual product."

**What I expected to see:** Product screenshots, a demo video, or at least mockups showing me the UI. Every SaaS product I use (Figma, Notion, Linear) has this.

**What I actually saw:** Six feature cards with icons and short descriptions. No screenshots. No demo video. No animated GIFs. No product visuals whatsoever. The descriptions use industry jargon:

- "GIS overlays, flood zones, and zoning data" -- I don't know what GIS means.
- "comps analysis and 18 open data sources" -- comps? Open data sources?
- "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities" -- who is Sophie? What leads? I don't have leads.
- "TCPA consent tracking, DNC list checks" -- TCPA? DNC? These are acronyms for real estate insiders.

Then there's a pricing teaser with 4 tier cards. The descriptions are: "Explore the platform", "Replace your spreadsheet", "For serious operators", "For growing teams". At least the Free tier exists.

**My reaction:** frustrated

There is zero product imagery on this entire page. I have literally no idea what this software looks like. I'm being asked to sign up based on feature bullet points and jargon I don't understand. "For serious operators" -- OK so this is definitely not for me. The language is macho and insider-coded.

**Would I continue in real life?** maybe -- Only because it's free. If there were any cost to try, I would have bounced.

---

## Step 3: Tap "Get Started Free"

**What I tried to do:** "Fine, it's free. Let me just sign up and see what it looks like inside."

**What I expected to see:** A simple signup form: email, password, maybe Google SSO. Something I can complete in 30 seconds.

**What I actually saw:** The auth page is a centered, minimal layout with a Clerk-powered sign-in/sign-up widget. By default it shows the **Sign In** form (not Sign Up). There's a small text link at the bottom: "Need an account? Sign up" to toggle to the registration form.

The Clerk widget provides:
- Email/password registration
- Social login buttons (Google, Apple, etc. -- depends on Clerk dashboard configuration)
- Email verification step

The entire background is just `bg-background` with the Clerk widget centered. No branding, no reminder of what AcreOS is, no reassurance copy. No "you're signing up for AcreOS" text. No product logo or name visible on this page aside from the browser tab title.

**My reaction:** neutral

The Clerk widget is fine -- it's polished, standard, and I've seen it before. Two issues:

1. **It defaults to Sign In, not Sign Up.** I tapped "Get Started Free" and landed on a Sign In form. That's confusing. I have to find the small toggle link to switch to registration. The URL query parameter `?mode=register` would fix this, but the Link in the landing page points to `/auth` without any query parameter.

2. **Zero branding context.** When I'm on this page, there's no logo, no product name, no tagline. If I opened this in a new tab, I wouldn't know what service I'm signing up for. The Clerk widget might show "AcreOS" if configured in the Clerk dashboard, but the page itself has no custom branding.

**Would I continue in real life?** yes -- Clerk SSO is easy. I'll just click Google sign-in. But the defaulting to Sign In instead of Sign Up is an unnecessary moment of confusion.

---

## Step 4: Complete Clerk registration

**What I tried to do:** "Let me click Google to sign up fast."

**What I expected to see:** Google OAuth popup, authorize, done. Redirect me to the product.

**What I actually saw:** After Clerk processes the SSO callback, the auth page has logic to detect `sso-callback` in the URL hash and avoid premature redirect. Once authenticated, Clerk sets `isSignedIn = true`, and the page checks for the app user. If the app user isn't ready yet, it shows a bare spinner (no text, no branding -- just a spinning circle). Then it redirects to `/today`.

There is no automatic redirect to onboarding. The `signUpFallbackRedirectUrl` in main.tsx is set to `/today`, not `/onboarding-v2`. So a brand new user who has never used the platform goes straight to the Today hub.

**My reaction:** neutral

The OAuth flow is standard. The loading spinner has no text so I don't know if it's broken or working, but it's brief enough not to panic.

**Would I continue in real life?** yes -- This is normal OAuth flow.

---

## Step 5: Land on /today (first authenticated view)

**What I tried to do:** "OK I'm in! Show me what this thing does."

**What I expected to see:** Either a guided onboarding tour, or a clean empty-state dashboard with a clear "Add your first property" prompt. Something that tells me exactly what to do next.

**What I actually saw:** The Today page is a full dashboard hub with:

- A PageShell wrapper (sidebar navigation on desktop, bottom nav on mobile)
- Multiple stat cards showing zeros: 0 leads, 0 properties, 0 deals, etc.
- A priorities section (likely empty for a new user)
- Goal tracking (empty)
- Next-best-action suggestions (potentially)

On mobile (375px), I see:
- A bottom navigation bar with 4 items + a "More" overflow button
- The main content area with stat cards
- An `OnboardingWizard` modal component that may or may not appear (it's imported in App.tsx and rendered conditionally based on `shouldShowWizard` from `useOnboarding()`)

The OnboardingWizard modal (from `onboarding-wizard.tsx`) is a dialog overlay with steps:
1. Welcome
2. Import Leads
3. Add Property
4. Connect Integrations
5. Create Campaign
6. Complete

But this is the **modal** wizard, separate from the full-page `onboarding-v2` flow. The modal wizard asks about business type (land_flipper, note_investor, hybrid, etc.) and walks through importing leads, adding a property, connecting integrations, etc.

The v2 onboarding (at `/onboarding-v2`) is a much richer experience with path selection (beginner/active/enterprise), county targeting, instant deal hunt, and a celebration animation. But this path is NOT triggered automatically -- there's no redirect to it.

**My reaction:** frustrated

I signed up and landed on a dashboard full of zeros. The onboarding modal might appear, but it asks me to "Import Leads" and "Create Campaign" -- I don't have any leads. I don't know what a campaign is in this context. I wanted to buy some land, not run a marketing operation.

The mismatch between the landing page ("for real estate professionals") and my actual situation (curious beginner who has never bought land) is now fully apparent. This product assumes I already know what leads, campaigns, and deals are. I don't.

The onboarding wizard business type options include "land_flipper" and "note_investor" -- I don't know what either of those mean. What's a note investor? What's flipping land?

**Would I continue in real life?** maybe -- I'm in the product now, and it's free. But I feel like I walked into a commercial kitchen when I just wanted to make a sandwich. This is clearly built for professionals and I'm an outsider.

---

## Step 6: Try to add a property/parcel

**What I tried to do:** "I guess I should try adding a property? Where do I do that?"

**What I expected to see:** A big obvious "Add Property" button or a wizard that walks me through entering my first parcel.

**What I actually saw:** On the Today page, the onboarding wizard modal (if shown) has an "Add Property" step. But the navigation is dense:

The mobile bottom nav shows 4 items (configurable but defaults likely include Today, Pipeline, Money, AI) plus a "More" overflow menu. I need to find "Properties" -- which is probably buried in the "More" drawer.

Alternatively, the onboarding wizard step 2 ("Add Property") may have a link or button to add one. But the wizard itself has a "Skip" option and users like me -- who skim -- would likely dismiss it.

The onboarding wizard (v1) asks for Organization Name in step 1 with placeholder "e.g. Lone Star Land Investments". I'm Maria, a marketing manager. I don't have a land investment company. What do I put here? "Maria's Land Adventures"? This feels premature.

Step 2 asks to invite a team member. I don't have a team. This step exists purely for enterprise users and adds friction for solo beginners.

Step 3 asks about "Investment Strategy" with options like "Wholesale land flipping", "Long-term land holds", "Subdivision development", "Agricultural land", "Recreational/hunting properties", "Commercial land". Then it asks for "Target Acreage / Deal" and "Budget per Deal ($K)". I don't know any of these answers. I clicked on an ad about buying cheap land. I don't have a strategy.

Step 4 shows integrations: "County Records", "Google Maps", "MailGun Email", "Twilio SMS" with a badge saying "Configure in Settings". None of these are actionable. This step provides zero value.

**My reaction:** frustrated

The onboarding is designed for someone who already knows the real estate investing workflow. Every step assumes domain knowledge I don't have:
- "Organization Name" -- I'm one person exploring an idea
- "Investment Strategy" -- I don't have one yet
- "Target Acreage" -- I have no idea
- "Budget per Deal" -- I haven't thought about this

The v2 onboarding (at `/onboarding-v2`) would actually be much better for me -- it has a "beginner" path that starts with "Where Do You Want to Invest?" and shows real opportunities. But I'm never routed to it. It exists as a standalone page at `/onboarding-v2` that nobody is sent to.

**Would I continue in real life?** no -- At this point I've been in the product for about 3 minutes. I've seen a dashboard of zeros, an onboarding wizard that assumes I'm a professional, and I still don't have a single parcel in the system. I don't know what to do next, and the product hasn't shown me any value. I'm closing the tab.

---

## Step 7 (hypothetical): Check pricing before leaving

**What I tried to do:** "Before I go, let me check if this is even worth coming back to."

**What I expected to see:** Simple pricing with clear feature comparison optimized for mobile.

**What I actually saw:** The pricing page at `/pricing` has:

- A billing toggle (Monthly/Annual with "Save 20%" badge)
- 4 tier cards in a single-column stack on mobile (since `sm:grid-cols-4` means default is 1 column): Free, Starter ($20/mo), Pro ($49/mo), Scale ($79/mo)
- A feature comparison table with 5 columns (Feature, Free, Starter, Pro, Scale) and 16 rows

The **critical mobile problem**: The feature comparison table uses `<table>` with fixed-width columns (`w-28` = 112px each). On a 375px viewport with padding, 5 columns x 112px = 560px, which overflows the screen by ~220px. The table is wrapped in `overflow-hidden` (not `overflow-x-auto`), so the rightmost columns (Pro and Scale) are **literally cut off and invisible**. Users cannot scroll to see them.

Features listed include: Leads (10 free), Properties (3 free), Notes (2 free), AI Requests/day (25 free), Campaigns (none on free), Sequences (none on free), BYOK Data Providers, Team Seats, Open Data Sources, AI Deal Intelligence, Document Generation, Portfolio Mapping, Stripe Connect Payments, Direct Mail Integration, SMS/Voice Outreach, Priority Support.

**My reaction:** confused

The pricing seems reasonable but the table is broken on my phone. I can see Free and Starter columns but Pro and Scale are cut off. Also, "BYOK Data Providers" -- what is BYOK? "Stripe Connect Payments" -- I need Stripe to accept payments? This pricing page is written for developers, not end users.

The free tier gives me 10 leads and 3 properties. That's fine for exploring, but it doesn't tell me what a "lead" is in this context.

**Would I continue in real life?** no -- I'm gone. The product didn't give me a reason to stay.

---

## Final Verdict: ABANDONED

Maria abandoned at Step 6 (approximately 3-4 minutes in). She never got a parcel into the system.

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | White screen on initial load | HIGH | SPA shell renders empty `<div id="root"></div>`. On 3G, ~1.08 MB of JS must download before anything renders. Estimated 5-8 seconds of white screen on throttled connection. No SSR, no loading skeleton, no splash screen. |
| F2 | Jargon-heavy landing page | HIGH | GIS, comps, TCPA, DNC, "operating system", "serious operators" -- the copy assumes domain expertise. A beginner has no idea what these mean and feels excluded. |
| F3 | No product screenshots or demo | HIGH | The entire landing page has zero product imagery. No screenshots, no video, no animated GIFs, no mockups. Users are asked to sign up blind. |
| F4 | "Get Started Free" opens Sign In, not Sign Up | MEDIUM | The `/auth` page defaults to the Sign In form. The landing page CTA links to `/auth` without `?mode=register`. New users must find the toggle link to switch to registration. |
| F5 | Auth page has zero branding | MEDIUM | No logo, no product name, no tagline on the auth page itself. If opened in a new tab, the user wouldn't know what service they're signing up for. |
| F6 | No redirect to onboarding after signup | CRITICAL | New users land on `/today` (the dashboard) instead of being routed to the onboarding-v2 flow. The excellent beginner onboarding at `/onboarding-v2` exists but is unreachable. `signUpFallbackRedirectUrl` in main.tsx is `/today`. |
| F7 | Onboarding wizard assumes professional user | HIGH | The modal wizard asks for Organization Name, team invites, investment strategy, target acreage, and budget -- all questions a beginner cannot answer. There's no "I'm just exploring" option. |
| F8 | Dashboard of zeros | HIGH | A new user sees stat cards showing 0 leads, 0 properties, 0 deals. No empty-state guidance, no "here's what to do first" content surfaced prominently. |
| F9 | Pricing table broken on mobile | MEDIUM | The feature comparison table overflows on 375px viewport. `overflow-hidden` clips the Pro and Scale columns entirely. Should be `overflow-x-auto` for horizontal scrolling. |
| F10 | Category badges overwhelm beginners | LOW | Nine real-estate strategy badges (Wholesaling, Fix & Flip, Creative Finance, Notes, etc.) on the landing page create decision paralysis for someone who doesn't know these categories. |
| F11 | Social proof is weak | MEDIUM | "500+ Properties managed" is the only traction metric. No testimonials, no logos, no case studies, no user quotes. For a product in public beta, this is understandable but not confidence-inspiring. |
| F12 | Nav bar cramped on mobile | LOW | Three buttons (Pricing, Sign In, Get Started Free) plus the logo in 375px creates a tight horizontal squeeze. The buttons may wrap or overlap on smaller viewports. |

---

## Would I Recommend?

**Not Yet.**

The product appears to have deep functionality -- the sheer number of pages (100+) and features (deal hunter, AI valuation, campaign automation, portfolio mapping) suggests a mature platform. The onboarding-v2 flow with its "beginner" path and instant deal hunt is genuinely compelling. But none of that value is surfaced to a first-time visitor. The landing page speaks to insiders, the signup flow drops users into an empty dashboard, and the good onboarding is unreachable.

If AcreOS fixed the onboarding routing (send new signups to `/onboarding-v2` with the beginner path), added product screenshots to the landing page, and softened the jargon, I would try it again.

---

## Verbatim Quotes (Maria would say)

1. "Operating system? I thought I was signing up for a website, not installing Windows."

2. "Why does it say Sign In when I just clicked Get Started? I don't have an account yet. Where's the sign up button... oh, there, tiny link at the bottom."

3. "I just signed up and everything is zeros. Zero leads, zero properties, zero deals. Cool, thanks for showing me nothing. What am I supposed to do here?"

4. "It's asking me for my 'target acreage per deal' and 'budget per deal in thousands.' I literally just heard about land investing from a TikTok. I don't have a budget. I don't have a strategy. I don't have an organization name."

5. "I scrolled through the whole landing page looking for a screenshot of what this actually looks like. There are six feature cards with corporate descriptions but I still have no idea what the product looks like. Am I supposed to just... trust you?"
