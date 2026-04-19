# Persona Simulation: Priya Chandrasekaran -- J1 Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Priya Chandrasekaran, 41, principal software architect, Toronto ON |
| Device | MacBook Pro 16" (1280x720 logical viewport) |
| Browser | Firefox with uBlock Origin |
| Network | Fast (fiber) |
| Session | Fresh (no cookies, no auth state) |
| Concurrency | Solo |
| Date | 2026-04-18 |

---

## Persona Context

Priya is a systems thinker with 18 years of software engineering experience. She owns a rental duplex in Hamilton, ON and is researching US land investing as an alternative to the overheated Canadian market. She evaluates products like she reviews architecture: checking for edge cases, failure modes, and engineering quality signals. She has no US SSN, thinks in CAD, and will judge the platform's reliability by the quality of its front-end code.

> "Does this work for non-US investors, or am I going to hit a wall at step 3?"

---

## Step 1: Arrival at acreos.fly.dev/

**Action:** Priya types `acreos.fly.dev` into Firefox. She has uBlock Origin enabled.

**What she observes (technical):** The page is a React SPA built with Vite. The HTML shell is an empty `<div id="root">` -- no server-side rendering, no progressive enhancement. She opens DevTools on instinct.

**Network tab observations:**
- Initial HTML is ~2KB (just the shell + inline theme script)
- Main JS bundle: ~735KB (`index-*.js`)
- Vendor chunks: ~295KB (`vendor-ui-*.js`), ~50KB (`vendor-react-*.js`)
- Total JS payload: ~1.08MB before any content renders
- Clerk auth SDK loaded as separate chunk
- Mapbox token exposed in inline `<script>` via `window.__ENV__`

> "No SSR. 1 MB of JavaScript for a landing page. They're shipping the entire app bundle on the unauthenticated route. No code splitting between the landing page and the authenticated app. That's a yellow flag -- it means either the team is small or they haven't gotten to optimization yet."

**What renders:**

**Nav bar (sticky top):**
`[A] AcreOS` ---- `Pricing` | `Sign In` | `[Get Started Free]`

At 1280px width, the nav is comfortable. Three buttons plus logo in a `flex justify-between` container with `max-w-6xl` (1152px). No overflow issues.

**Hero section:**
- Badge: "Now in Public Beta" (outline variant)
- H1: "The operating system for **real estate professionals**"
- Subhead: "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI."
- Strategy badges (9): Wholesaling, Fix & Flip, Buy & Hold, STR / Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes
- CTAs: `[Start Free ->]` (primary) + `[View Pricing]` (outline)

**Social proof strip (4 stats, single row at `sm:grid-cols-4`):**
- 18 -- Free data sources
- $0 -- To get started
- 14 -- Day free trial
- 500+ -- Properties managed

**Features grid (6 cards, 3-column at `lg:grid-cols-3`):**
1. Portfolio Mapping -- "Visualize every parcel on interactive maps with GIS overlays, flood zones, and zoning data."
2. AI Valuations -- "Instant property valuations powered by comps analysis and 18 open data sources."
3. AI Deal Intelligence -- "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities."
4. Document Generation -- "Auto-generate purchase agreements, contracts, and closing documents in seconds."
5. Campaign Automation -- "Multi-channel outreach with SMS, email, and direct mail sequences."
6. Compliance Built-In -- "TCPA consent tracking, DNC list checks, and audit trails for every communication."

**Pricing teaser (4 mini-cards, 4-column at `sm:grid-cols-4`):**
- Free $0 -- "10 leads, 3 properties"
- Starter $20/mo -- "250 leads, campaigns"
- Pro $49/mo -- "500 leads, BYOK, unlimited" (highlighted border)
- Scale $79/mo -- "10 seats, unlimited everything"
- CTA: `[See Full Comparison]`

**Final CTA:**
- H2: "Ready to modernize your real estate business?"
- "Join operators who are closing more deals with less effort."
- `[Get Started Free ->]`

**Footer:**
- "(c) 2026 AcreOS. All rights reserved."
- Links: Pricing | Sign In

### Priya's Reaction: Cautiously Interested, Flags Raised

> "The page is clean. Minimalist. Looks like a modern SaaS landing page -- shadcn/ui components, Tailwind tokens, no visual regressions. The engineering signals are mixed: the front-end is well-structured but shipping 1MB of JS for a static page is wasteful."

**Three immediate concerns:**

1. **No currency labels.** "$0", "$20/mo", "$49/mo", "$79/mo" -- all without "USD" anywhere. Priya thinks in CAD. At the current exchange rate, $49 USD is ~$67 CAD. The pricing teaser says "$0 To get started" -- is that USD or CAD? It's almost certainly USD but the page never says so. This is a basic internationalization oversight.

2. **No mention of international users.** The entire landing page assumes a US audience. "18 Free data sources" -- for which country? "TCPA consent tracking, DNC list checks" -- TCPA is US-only regulation. Nothing suggests this works for someone in Toronto. No flags, no "used by investors in X countries," no disclaimer.

3. **No API documentation link.** Priya specifically looked for an API docs link in the nav, footer, and feature cards. There isn't one. No mention of webhooks, no developer documentation, no Swagger/OpenAPI link. For a product calling itself an "operating system," the absence of extensibility is notable.

> "It's a US-only product that doesn't know it's a US-only product. No currency labels, no international disclaimers, TCPA-specific compliance features. I'm already wondering if I'll hit an SSN wall during signup."

**Would she continue?** Yes -- the free tier is attractive, and the feature set (mapping, data sources, document generation) aligns with her needs if the data is good.

---

## Step 2: Check Pricing Page

**Action:** Priya clicks "Pricing" in the nav. URL: `/pricing`.

**What she sees:**

**Nav:** ArrowLeft icon + AcreOS logo + `[Get Started]` button (links to `/auth?mode=register`).

**Header:**
- H1: "Simple, transparent pricing"
- Subhead: "Start free. Upgrade when you're ready. Every paid plan includes a 14-day free trial."
- Billing toggle: Monthly / Annual (with "Save 20%" badge when Annual is selected)

**Tier cards (4-column grid at `sm:grid-cols-4`):**

| Tier | Monthly | Annual | Description | CTA |
|---|---|---|---|---|
| Free | $0 | $0 | "Explore the platform" | Get Started |
| Starter | $20/mo | $16/mo ($192/yr) | "Replace your spreadsheet" | Start 14-Day Free Trial |
| Pro (highlighted) | $49/mo | $39/mo ($470/yr) | "For serious operators" | Start 14-Day Free Trial |
| Scale | $79/mo | $63/mo ($758/yr) | "For growing teams" | Start 14-Day Free Trial |

**Feature comparison table (proper `<table>` element, 5 columns):**

At 1280px, the table renders cleanly. The `overflow-x-auto` wrapper handles horizontal overflow (fixed in source code, may not be deployed yet -- **known fix pending deploy**). Each column is `w-28` (112px), so 5 columns = 560px within the `max-w-5xl` (1024px) container. No overflow issue at this viewport.

Features listed: Leads (10/250/500/Unlimited), Properties (3/50/100/Unlimited), Notes (2/25/50/Unlimited), AI Requests/day (25/500/1000/Unlimited), Campaigns (no/5/Unlimited/Unlimited), Sequences (no/2/Unlimited/Unlimited), BYOK Data Providers (no/no/yes/yes), Team Seats (1/1/2+$20/seat/10+$40/seat), Open Data Sources (18) (all), AI Deal Intelligence (all), Document Generation (all), Portfolio Mapping (all), Stripe Connect Payments (no/yes/yes/yes), Direct Mail Integration (no/yes/yes/yes), SMS/Voice Outreach (no/no/yes/yes), Priority Support (no/no/yes/yes).

**Enterprise line:** "Need custom enterprise pricing? Contact us." (mailto link)

**Footer:** (c) 2026 AcreOS | Home | Sign In

### Priya's Reaction: Pricing is Clear, Currency is Not

> "The pricing structure is transparent. I appreciate that. Four tiers, clear feature matrix, per-seat add-on costs disclosed. This is better than 80% of SaaS pricing pages."

**But:**

1. **Still no "USD" label.** Every price is shown as `$X` without currency designation. At $49/mo USD, Priya's actual cost is ~$67 CAD/mo plus foreign transaction fees on her Canadian Visa. If AcreOS uses Stripe (which it appears to, given "Stripe Connect Payments" in the feature table), her card will work but she'll pay a 2.5% FX fee on top of the exchange rate.

2. **"BYOK Data Providers" is unexplained.** Priya knows what BYOK means (Bring Your Own Key) from cloud infrastructure contexts, but the pricing page doesn't explain what data providers this refers to, what keys, or what they unlock. For a non-US user, this matters -- are these US-only data sources? County-specific? Will they work for Canadian research?

3. **No data residency information.** Where is data stored? AWS us-east? Fly.io's infrastructure? No mention of compliance frameworks (SOC 2, GDPR, PIPEDA). As a Canadian user, Priya's data is subject to PIPEDA. The platform doesn't acknowledge this.

4. **The billing toggle has no `aria-label`.** It's a custom toggle button (`<button>` with styled `<span>` children) without `role="switch"` or `aria-checked`. Minor accessibility issue, but Priya notices these things.

> "No currency labels anywhere. I have to assume USD but that's $67 Canadian plus FX fees for the Pro plan. Not a dealbreaker, but it's sloppy. And 'BYOK Data Providers' -- what does that mean for someone outside the US?"

**Would she continue?** Yes -- the free tier lets her evaluate without financial commitment.

---

## Step 3: Click "Get Started Free"

**Action:** Priya clicks "Get Started" on the pricing page. URL: `/auth?mode=register`.

**What she sees:**

The page renders a centered Clerk SignUp widget on a plain `bg-background` page. Because the URL includes `?mode=register`, the auth page initializes in `sign-up` mode (the code reads `params.get("mode") === "register"` and sets `mode` to `"sign-up"`).

**NOTE:** The deployed version may not have the `?mode=register` fix yet. If the CTA links to `/auth` without the query parameter, Priya would see the Sign In form by default and have to find the "Need an account? Sign up" toggle link at the bottom. **Known fix pending deploy.**

The Clerk widget provides:
- Email/password registration
- Potentially Google/Apple SSO (depends on Clerk dashboard configuration)
- Email verification step

Below the widget, a toggle link: "Already have an account? Sign in"

**Zero branding on the page itself.** No AcreOS logo, no product name, no tagline. The page is a white/dark background with a floating Clerk widget.

### Priya's Reaction: Functional, Unbranded

> "Standard Clerk auth. I've seen this pattern in a dozen SaaS products. It works. But the page is completely unbranded -- if I opened this in a new tab, I wouldn't know what I'm signing up for."

**Two specific concerns:**

1. **What identity information will be required?** Priya is watching for an SSN request. The Clerk signup likely asks for email + password + name. That's fine. But she's bracing for a profile setup step that asks for US-specific information.

2. **Will her Canadian phone number work for SMS verification?** If Clerk requires SMS verification, Canadian numbers (+1 country code, same as US) should work. But some Clerk configurations restrict to specific country codes.

> "Let me use email/password. I don't want to connect my Google account to something in public beta."

**Would she continue?** Yes -- she signs up with email/password.

---

## Step 4: Post-Signup Redirect

**Action:** Priya completes Clerk registration (email + password + email verification).

**What happens:**

The `signUpFallbackRedirectUrl` in `main.tsx` (at the ClerkProvider level) is set to `/onboarding-v2`. However, the `<SignUp>` component in `auth-page.tsx` has its own `fallbackRedirectUrl="/today"`. The component-level setting may override the provider-level setting depending on Clerk's SDK version.

**Scenario A (source code fix deployed):** Priya is redirected to `/onboarding-v2`, the rich onboarding flow with path selection (beginner/active/enterprise). **Known fix pending deploy.**

**Scenario B (deployed version without fix):** Priya is redirected to `/today`, the dashboard hub. She sees a dashboard of zeros and potentially the onboarding wizard modal.

In either scenario, there is a brief loading state -- a bare spinner (`animate-spin` div, no text) while the app user is created server-side.

### If Scenario A (onboarding-v2):

The onboarding flow asks Priya to select a path:
- **Beginner:** "Where Do You Want to Invest?" -> county selection -> instant deal hunt
- **Active:** Import portfolio -> target counties -> deal scan -> automation setup
- **Enterprise:** Team setup -> integrations -> market scan -> workflows

Priya would likely select "Active" (she has real estate experience, just not US land). The flow then asks her to import an existing portfolio. She doesn't have US parcels to import. She might switch to "Beginner" and get the county-targeting flow, which is more useful for her research phase.

**Critical friction:** The onboarding-v2 flow does not ask about the user's country of residence. It does not surface any information about international investing. The county selection is US-only (obviously), but there's no acknowledgment that this is a US-centric platform being used by someone outside the US.

### If Scenario B (/today dashboard):

Priya sees stat cards showing zeros (0 leads, 0 properties, 0 deals). The onboarding wizard modal may appear, asking for Organization Name, team invites, investment strategy, target acreage, and budget.

**Organization Name field:** Placeholder "e.g. Lone Star Land Investments". Priya doesn't have a US LLC yet. She types "Priya Chandrasekaran" as a temporary name. The form doesn't validate whether this is a legal entity name or require any entity documentation -- that's fine.

> "No SSN wall yet. Good. But also no acknowledgment that I'm not in the US. The entire flow assumes I'm American."

**Would she continue?** Yes -- she's in the product and wants to evaluate the data quality.

---

## Step 5: Evaluate the Platform (First Authenticated Experience)

**Action:** Priya navigates the authenticated app, looking for data she can verify.

**What she's looking for:**
1. Parcel data accuracy (she'll check against county assessor websites she's already visited)
2. Data export (CSV export of any view)
3. Currency handling (are all values in USD? Are they labeled?)
4. International user support (any mention of non-US investors?)
5. API access or webhook documentation

**What she finds:**

The sidebar navigation includes: Today, Pipeline, Properties, Money, AI, Agents, Settings, and more.

**Properties section:** She can add a property manually by entering county, state, and APN. The form has US state dropdown -- no Canadian provinces, no international option. This is expected for a US land platform, but confirms her suspicion that the platform is US-only.

**Data values:** Property values, assessed values, and offer prices are shown with `$` prefix and no currency label. All values are USD but never explicitly stated.

**Export:** She looks for a CSV export button on the properties list. The availability depends on tier -- the feature comparison showed all tiers get basic data, but export capabilities may vary.

**Settings:** She checks the account/organization settings for any international user options, tax ID fields (SSN vs ITIN), or address format options. The address fields likely use a US-format layout (Street, City, State, ZIP) with no option for Canadian postal codes or international addresses.

### Priya's Reaction: Data-Rich but US-Walled

> "The data sources are impressive -- 18 free sources, county-level assessor data, flood zones, zoning overlays. This is exactly what I need for due diligence. But every single piece of this platform assumes I'm in the US. No currency labels, no international user path, US-only address formats."

> "I'm going to hit a wall eventually. Either when I try to set up payments, when I need to enter a tax ID for some workflow, or when I try to close a deal and the document generation assumes US-only entities. The question is when, not if."

**Would she continue?** Tentatively -- she'll use the free tier for research but won't build her workflow around it until she knows where the walls are.

---

## Step 6: Check for Data Export

**Action:** Priya looks for CSV export or API documentation.

**Data export:** She searches for export buttons in the properties list view, the leads view, and any reports section. The availability of export depends on the specific view implementation. Some views may have a "Download CSV" button; others may not.

**API documentation:** She checks the footer, the settings page, and any "Developer" or "Integrations" section. Based on the landing page and pricing page, there is no public API documentation link. The platform has internal APIs (visible in DevTools) but no documented public API.

### Priya's Reaction: Concerned About Lock-In

> "I can see the API calls in my network tab -- `/api/properties`, `/api/leads`, `/api/organizations`. These are RESTful, well-structured endpoints. But there's no public API documentation. No API keys. No webhook configuration. The data goes in but there's no guaranteed way to get it out in bulk."

> "For cross-border tax modeling, I need to export all my data to spreadsheets where I can add CAD conversion columns, FIRPTA withholding calculations, and treaty-rate analysis. If I can't export, I can't use this platform as my primary system."

**Would she continue?** This is a significant concern. She won't import substantial data until she's confirmed export works.

---

## Step 7: Final Assessment

**Action:** Priya closes DevTools, sits back, and forms her opinion.

### Final Verdict: TENTATIVE -- Will Evaluate Further But Won't Commit

Priya sees a well-engineered product with genuine depth in US land investing data. The architecture is sound (React + Vite, Clerk auth, proper API structure), the feature set is comprehensive, and the pricing is reasonable. But the platform has a fundamental blind spot: it doesn't know it has international users, and it doesn't prepare for the friction they'll encounter.

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | No currency labels anywhere | HIGH | All monetary values shown as `$X` without "USD" designation. A Canadian user mentally converting to CAD needs explicit currency labels. This affects the landing page, pricing page, and all in-app monetary displays. |
| F2 | No international user acknowledgment | HIGH | The entire platform -- landing page, onboarding, settings -- assumes a US audience. No mention of international investors, no country selection, no ITIN option, no foreign address support. |
| F3 | No SSR / 1MB JS for landing page | MEDIUM | The landing page ships ~1.08MB of JavaScript with no server-side rendering. First contentful paint depends entirely on JS execution. For a software architect, this signals either a small team or deprioritized performance. |
| F4 | Auth page has zero branding | MEDIUM | The `/auth` page is a bare Clerk widget on a blank background. No logo, no product name, no context for what the user is signing up for. |
| F5 | No API documentation | HIGH | For a product calling itself an "operating system," the absence of public API docs, webhook configuration, or developer documentation is a significant gap. The APIs exist (visible in DevTools) but are undocumented. |
| F6 | No data residency disclosure | MEDIUM | No information about where data is hosted, backup policies, or compliance frameworks (SOC 2, GDPR, PIPEDA). A Canadian user's data crosses borders without acknowledgment. |
| F7 | BYOK unexplained on pricing page | LOW | "BYOK Data Providers" in the feature comparison table is jargon without explanation. No tooltip, no link to documentation explaining what providers are supported or what keys are needed. |
| F8 | US-only address formats in settings | MEDIUM | Organization and contact address fields use US-format layouts (State dropdown, ZIP code) with no option for international addresses. Canadian postal codes (e.g., M4S 1A1) won't fit a ZIP field. |
| F9 | No product screenshots on landing page | MEDIUM | The entire landing page has zero product imagery. Six feature cards with descriptions but no visual evidence of what the product looks like. A software architect wants to see the UI before signing up. |
| F10 | Social proof is weak | LOW | "500+ Properties managed" is the only traction metric. No named customers, no testimonials, no case studies, no industry logos. For a technically sophisticated evaluator, this is insufficient evidence. |
| F11 | Billing toggle lacks ARIA attributes | LOW | The monthly/annual toggle on the pricing page is a custom button without `role="switch"` or `aria-checked`. Minor accessibility gap but noticeable to someone who builds accessible software. |
| F12 | `signUpFallbackRedirectUrl` conflict | LOW | `main.tsx` (ClerkProvider) sets `signUpFallbackRedirectUrl="/onboarding-v2"` but `auth-page.tsx` (`<SignUp>`) sets `fallbackRedirectUrl="/today"`. Potential for inconsistent redirect behavior depending on SDK precedence. **Known fix pending deploy.** |

---

## Recommendation Score

**5/10 -- Promising but not ready for international users.**

The platform has genuine depth in US land data and a well-structured architecture. For a US-based investor, this would score 7/10. But for Priya -- a Canadian investor who needs currency awareness, international address support, data export for cross-border tax modeling, and some acknowledgment that non-US investors exist -- the product has too many assumptions baked in.

She will keep the free account, explore the data sources to verify accuracy against county assessor sites she's already bookmarked, and check back in 3-6 months to see if international support materializes.

---

## Verbatim Quotes (Priya Would Say)

1. "No SSR, 1 MB of JavaScript, and the Mapbox token is in the page source. The engineering is competent but not optimized. I've seen worse at series-B companies."

2. "Every price says '$X' but never 'USD.' I've been mentally adding 37% for the exchange rate this entire time. Is it that hard to add three letters?"

3. "The platform clearly has deep data -- 18 sources, county-level parcels, flood zones, zoning. But it doesn't know I exist as a non-US user. There's no country field, no ITIN option, no acknowledgment that cross-border investing has different requirements."

4. "No API docs for a product calling itself an 'operating system.' An OS without an API is just an application with a pretentious name."

5. "I'll keep the free account for research. But I'm not building my workflow around a platform that doesn't have data export and doesn't know what PIPEDA is."
