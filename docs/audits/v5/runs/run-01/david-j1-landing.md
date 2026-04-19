# Persona Audit: David Whelan — Journey 1: Landing to First Parcel

| Field | Value |
|---|---|
| Persona | David Whelan, 52, full-time Florida land investor |
| Device | Desktop 1440x900 |
| Network | Fast (fiber) |
| Session | Fresh / incognito |
| Concurrency | Solo |
| Date | 2026-04-18 |
| URLs tested | `/`, `/auth`, `/pricing` |

---

## Persona Profile

David buys 10-20 parcels per year, all tracked in spreadsheets (Excel and Google Sheets). He knows his APNs, his counties, his per-acre numbers. He has tried two other "land CRM" tools in the past and abandoned both within a week. He is deeply skeptical of AI claims. He wants raw data — county records, parcel boundaries, comp sales — not AI-generated summaries. He reads every word on a landing page before signing up. He will not enter a credit card until he has proof the tool works.

---

## Step 1: Arrival at Landing Page (`/`)

### What David sees

**Navigation bar** (sticky top):
- AcreOS logo (gradient square with "A") + "AcreOS" wordmark
- "Pricing" link (ghost button)
- "Sign In" link (ghost button)
- "Get Started Free" button (primary, filled)

**Hero section:**
- Badge: "Now in Public Beta"
- Headline: "The operating system for **real estate professionals**"
- Subhead: "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals — powered by AI."
- Category badges: Wholesaling, Fix & Flip, Buy & Hold, STR / Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes
- Two CTAs: "Start Free" (primary) | "View Pricing" (outline)

**Social proof strip:**
- "18" — Free data sources
- "$0" — To get started
- "14" — Day free trial
- "500+" — Properties managed

**Feature grid (6 cards):**
1. Portfolio Mapping — "Visualize every parcel on interactive maps with GIS overlays, flood zones, and zoning data."
2. AI Valuations — "Instant property valuations powered by comps analysis and 18 open data sources."
3. AI Deal Intelligence — "Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities."
4. Document Generation — "Auto-generate purchase agreements, contracts, and closing documents in seconds."
5. Campaign Automation — "Multi-channel outreach with SMS, email, and direct mail sequences."
6. Compliance Built-In — "TCPA consent tracking, DNC list checks, and audit trails for every communication."

**Pricing teaser (4 cards):**
- Free: $0 — "10 leads, 3 properties"
- Starter: $20/mo — "250 leads, campaigns"
- Pro: $49/mo — "500 leads, BYOK, unlimited"
- Scale: $79/mo — "10 seats, unlimited everything"
- CTA: "See Full Comparison"

**Final CTA section:**
- "Ready to modernize your real estate business?"
- "Join operators who are closing more deals with less effort."
- "Get Started Free" button

**Footer:**
- "(c) 2026 AcreOS. All rights reserved."
- Links: Pricing | Sign In

### David's internal monologue

> "The operating system for real estate professionals." Okay. At least they didn't say 'land investors' like every guru-adjacent tool. But 'operating system' is the kind of vague buzzword that makes me nervous. What does it actually DO with my data?

> "Replaces your spreadsheets." I've heard that before. My spreadsheet does exactly what I tell it to. The question is whether this thing gives me better data, not whether it has a prettier interface.

> "Powered by AI." There it is. Sophie, your AI copilot. I don't want a copilot. I want county records and comp data. Let me decide what a parcel is worth.

> "18 open data sources." That's interesting. WHICH 18? They don't say. If I can't see the list, I can't evaluate the quality. Are we talking FEMA flood maps and county assessor feeds, or are we talking scraped Zillow data?

> "500+ properties managed." That's... not impressive. That's maybe 25-50 users. This is a beta product.

> "3 properties" on the free tier. That's barely enough to evaluate anything. I have 40+ parcels in my current portfolio. But okay, I can test with 3 to see if the data quality is real.

### Friction events

| ID | Severity | Element | Issue |
|---|---|---|---|
| F-1.1 | **Medium** | Social proof: "500+ properties managed" | For a skeptic, 500 properties is a red flag, not social proof. It signals tiny user base. David thinks: "So maybe 30 users? This could disappear in 6 months." |
| F-1.2 | **High** | Feature card: "18 open data sources" | No list of which data sources. David cannot evaluate data quality — his #1 concern. This is the single most important claim on the page and it is unsubstantiated. |
| F-1.3 | **Medium** | AI-heavy messaging | 3 of 6 feature cards mention AI. David is AI-skeptical. The page leads with AI rather than data quality and accuracy. |
| F-1.4 | **Low** | Category badges | "Land" is listed 5th out of 9 categories. David is a land-only investor. The page feels like it is targeting every RE niche, which makes him worry it is a jack-of-all-trades, master-of-none. |
| F-1.5 | **Low** | No footer links to Terms/Privacy | No link to Terms of Service or Privacy Policy visible from the landing page. David, who is cautious, notices this. |
| F-1.6 | **Low** | No demo/screenshot | Zero screenshots, videos, or interactive demos. David cannot see what the product looks like before signing up. He is being asked to create an account on faith. |
| F-1.7 | **Low** | "Guesswork" phrasing | "Replaces your... guesswork" implies current operators are guessing. David does not guess. He runs comps. This phrasing is mildly insulting to experienced operators. |

---

## Step 2: Pricing Page (`/pricing`)

### What David sees

**Navigation:**
- Back arrow + AcreOS logo (links to home)
- "Get Started" button

**Header:**
- "Simple, transparent pricing"
- "Start free. Upgrade when you're ready. Every paid plan includes a 14-day free trial."

**Billing toggle:** Monthly | Annual (toggle switch). Annual shows "Save 20%" badge.

**Tier cards (4 columns):**

| | Free | Starter | Pro (Most Popular) | Scale |
|---|---|---|---|---|
| Price | $0 | $20/mo | $49/mo | $79/mo |
| Annual | - | $192/yr ($16/mo) | $470/yr ($39/mo) | $758/yr ($63/mo) |
| Tagline | Explore the platform | Replace your spreadsheet | For serious operators | For growing teams |
| CTA | Get Started | Start 14-Day Free Trial | Start 14-Day Free Trial | Start 14-Day Free Trial |

**Feature comparison table (16 rows):**

| Feature | Free | Starter | Pro | Scale |
|---|---|---|---|---|
| Leads | 10 | 250 | 500 | Unlimited |
| Properties | 3 | 50 | 100 | Unlimited |
| Notes | 2 | 25 | 50 | Unlimited |
| AI Requests/day | 25 | 500 | 1,000 | Unlimited |
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

**Enterprise CTA:** "Need custom enterprise pricing? Contact us." (mailto:hello@acreos.com)

**Footer:**
- "(c) 2026 AcreOS. All rights reserved."
- Links: Home | Sign In

### David's internal monologue

> "3 properties on free." Okay, that's tight but I can live with it for testing. Let me see what I actually get.

> "BYOK Data Providers" — only on Pro and Scale. So on free and Starter, I'm locked into their data sources. And I still don't know WHICH data sources those 18 are.

> "Notes: 2 on free." Wait, 'Notes' here means seller-financed notes, not text notes? Or text notes? The label is ambiguous. If it means seller-finance notes, I don't need that. If it means text annotations on parcels, 2 is absurdly low.

> "$49/mo for 'serious operators.'" That's not bad IF the data quality is real. But I won't know until I try free first.

> "AI Requests/day: 25 on free." I don't plan to use AI, so that's fine.

> "Open Data Sources (18)" is a checkmark on every tier. Good. But I STILL don't know what those 18 sources are. This is the third time I've looked for that list and it's nowhere.

### Friction events

| ID | Severity | Element | Issue |
|---|---|---|---|
| F-2.1 | **High** | "Open Data Sources (18)" — no breakdown | The pricing page mentions 18 data sources as a feature row but provides no tooltip, expandable list, or link to documentation. David's #1 evaluation criterion remains unanswered across two pages. |
| F-2.2 | **Medium** | "Notes" label ambiguity | "Notes" in the feature table could mean seller-financed notes (a financial instrument) or text/annotation notes. Both exist in RE. The landing page categories include "Notes" as an investment type AND the onboarding wizard has "Note Investor" as a business type, but the pricing table does not clarify. |
| F-2.3 | **Low** | No FAQ section | Pricing page has no FAQ. Common questions — What happens when I hit the limit? Can I export my data? What counts as an "AI request"? — are unanswered. |
| F-2.4 | **Low** | Per-seat pricing asymmetry | Pro charges $20/extra seat, Scale charges $40/extra seat. This is counterintuitive — the higher tier charges MORE per extra seat. Likely a bug or intentional but unexplained. |
| F-2.5 | **Low** | No annual savings displayed inline | When viewing monthly pricing, there is no indication of annual savings. The user must toggle to Annual to discover the 20% discount. A small "or $X/yr" note under each monthly price would help. |

---

## Step 3: Auth Page (`/auth`)

### What David sees

A centered page with Clerk's pre-built `<SignIn>` component rendered via hash routing. Below it, a toggle link:

- **Default mode:** Sign In form (Clerk-managed)
- **Toggle text:** "Need an account? Sign up" / "Already have an account? Sign in"

The Clerk component renders its own UI including:
- Email field
- Password field (or magic link, depending on Clerk dashboard config)
- OAuth buttons (Google, etc. — depends on Clerk instance configuration)
- Clerk branding at the bottom

The page has no AcreOS branding, no logo, no contextual copy. It is a bare Clerk form on a blank background.

### David's internal monologue

> Where am I? The AcreOS logo is gone. The nav is gone. This looks like some third-party login page. Is this actually AcreOS? The URL says acreos.fly.dev/auth but the form has a different look.

> "Secured by Clerk." What is Clerk? I don't know what that is. Am I giving my credentials to a third party? Let me google that later.

> All the CTAs on the landing page said "Get Started Free" and "Start Free" — but this page defaults to Sign In, not Sign Up. If I'm a new user, I have to find the tiny "Need an account? Sign up" link at the bottom. The primary action on the page contradicts what brought me here.

> No mention of what I'm signing up for. No "Free tier — 3 properties, 10 leads" reminder. No reassurance. Just... a form.

### Friction events

| ID | Severity | Element | Issue |
|---|---|---|---|
| F-3.1 | **High** | Auth page defaults to Sign In, not Sign Up | Every CTA on the landing page and pricing page says "Get Started Free" or "Start Free" — language that implies registration. But `/auth` defaults to the Sign In view. A first-time visitor clicking "Get Started Free" lands on a Sign In form, which is confusing. The `?mode=register` param exists in the code but is never used by landing page links. |
| F-3.2 | **High** | No AcreOS branding on auth page | The page is a bare Clerk widget on a plain background. No AcreOS logo, no tagline, no context. The user loses all visual continuity from the landing page. On a desktop at 1440x900, this is a mostly-empty screen with a small form widget. |
| F-3.3 | **Medium** | No value reminder at sign-up | The auth page provides zero context about what the user is signing up for. No "Free tier includes..." copy. No reassurance about no credit card required. The user must remember what they read on the previous page. |
| F-3.4 | **Medium** | Third-party branding ("Secured by Clerk") | David is privacy-conscious. Seeing unfamiliar third-party branding on the auth form creates trust friction. He doesn't know what Clerk is or what data it collects. |
| F-3.5 | **Low** | No link back to landing page | The auth page has no navigation whatsoever — no back button, no logo link, no breadcrumb. The only way back is the browser back button. |

---

## Step 4: Post-Sign-Up — Onboarding Wizard (projected)

### What David would see

After completing Clerk sign-up (email + password), David is redirected to `/today`. An onboarding wizard modal (`OnboardingWizard` component) automatically opens as a dialog overlay. It has 6 steps:

1. **Welcome** — Select business type from 7 options: Land Flipper, Residential Wholesaler, Fix & Flip, Buy & Hold / Rental, Commercial Investor, Note Investor, Land + Notes (Hybrid). Each has an icon and one-line description.
2. **Your First Steps** — Role-specific recommended actions (for Land Flipper: Import Leads, Set Up Campaign, Configure Deal Criteria).
3. **Add Property** — Address, acres, county, state fields.
4. **Connect Integrations** — Email, SMS, Direct Mail channel cards with "Configure in Settings" badges.
5. **Create Campaign** — Campaign setup prompt.
6. **Complete** — Celebration screen.

Each step can be skipped. Progress bar shows completion percentage.

### David's internal monologue

> Okay, "Land Flipper." That's me. But the description says "Buy raw land at wholesale and resell for profit." That's reductive. I do both flips and holds. I guess I'll pick "Land Flipper" but I'm not thrilled about being boxed in.

> Step 2 wants me to "Import Leads." I don't have a lead CSV ready. I just want to add ONE parcel and see if the data is any good. Let me skip this.

> Step 3 — Add Property. Now we're talking. But it wants "Address" not APN? That's odd. My parcels are vacant land. They don't always have addresses. The main property form (on the Properties page) asks for APN prominently, which is correct. But this onboarding step seems to ask for address/acres/county/state — no APN field visible in the wizard.

> Steps 4 and 5 — integrations and campaigns. I don't want to set up campaigns. I just want to see my parcel data. Skip, skip.

### Friction events

| ID | Severity | Element | Issue |
|---|---|---|---|
| F-4.1 | **Medium** | Onboarding wizard step 3 asks for address, not APN | The actual Properties page form prominently features APN as the first field (for land investors). But the onboarding wizard's "Add Property" step uses simpler fields (address, acres, county, state). For a land investor, APN is the primary identifier. This inconsistency means the first property added via onboarding may be less useful than one added via the Properties page. |
| F-4.2 | **Low** | 6-step onboarding for a skeptic | David just wants to test data quality on one parcel. A 6-step wizard with campaigns, integrations, and team invites is overhead. The ability to skip steps mitigates this, but the wizard still feels like it is designed for an eager adopter, not a skeptical evaluator. |
| F-4.3 | **Low** | "Land Flipper" label | David buys and holds some parcels long-term. The "Land Flipper" label implies short-term flipping only. "Hybrid" exists but is described as "Land + Notes" which David may not identify with if he doesn't do seller financing. |

---

## Step 5: Properties Page — Adding First Parcel (projected)

### What David would see

After completing or dismissing the onboarding wizard, David navigates to the Properties page. With zero properties, he sees the `PropertiesEmptyState` component:

- Large map icon with tree and mountain decorations
- **"Build your property portfolio"**
- "Add properties you're evaluating or already own. Get instant valuations, track due diligence, and manage your entire inventory."
- Two buttons: "Add a Property" | "Import from CSV"
- Pro tip: "Enter the APN (Assessor Parcel Number) to automatically pull county records, GIS data, and comparable sales."

Clicking "Add a Property" opens a dialog with the `PropertyForm`:

**Required fields:**
- APN (placeholder: "123-456-789")
- Acres (placeholder: "5.0")
- County (placeholder: "San Bernardino")
- State (placeholder: "CA" — 2-letter code required)
- Status (default: "available")

**Optional fields:**
- Purchase Price (number)
- Market Value (number)
- Description (text)

Submit button: "Add Property"

### David's internal monologue

> "Enter the APN to automatically pull county records, GIS data, and comparable sales." NOW you have my attention. That's exactly what I want. Let me try it.

> APN first, County, State, Acres. Clean form. I know all of these for every parcel I own. Let me put in one of my Polk County, FL parcels and see what it pulls.

> No address field. Good. They understand vacant land doesn't always have an address. The form is APN-centric, which is correct for land.

> "Purchase Price" and "Market Value" are optional. Fine. I want to see what THEY think the market value is before I tell them mine.

> Submitted. Now let's see what data it actually pulls. That's the real test.

### Friction events

| ID | Severity | Element | Issue |
|---|---|---|---|
| F-5.1 | **Low** | No immediate feedback on data enrichment | After adding a property, it is unclear whether the system is actively pulling county records and GIS data, or whether that happens later. There is no progress indicator for enrichment. The pro tip promises automatic data pull on APN entry, but the form has no live-lookup behavior — enrichment happens after submission. |
| F-5.2 | **Low** | Free tier: 3 properties max | David has 40+ parcels. He can only test 3 before hitting the wall. If enrichment quality is good, he needs to commit to at least Starter ($20/mo) immediately. The free-to-paid jump requires evaluating data quality on just 3 parcels. |

---

## Cumulative Friction Summary

| Severity | Count | IDs |
|---|---|---|
| **High** | 3 | F-1.2, F-3.1, F-3.2 |
| **Medium** | 6 | F-1.1, F-1.3, F-2.2, F-3.3, F-3.4, F-4.1 |
| **Low** | 10 | F-1.4, F-1.5, F-1.6, F-1.7, F-2.3, F-2.4, F-2.5, F-3.5, F-4.2, F-4.3, F-5.1, F-5.2 |

---

## Verdict

**Would David sign up?** Reluctantly yes — because it is free and he is curious about the "18 data sources" claim. But he is irritated that he cannot verify that claim before creating an account.

**Would David add his first parcel?** Yes. The Properties page form is well-designed for land investors (APN-first, no address required). The pro tip about automatic data enrichment is the most compelling copy on the entire site.

**Would David pay?** Not today. He needs to see what the enrichment actually returns for his Florida parcels. If it pulls real county assessor data, flood zone status, and usable comps, he would consider Starter at $20/mo. If it returns AI-generated summaries without source attribution, he will close the tab.

**Trust level at end of journey:** 4/10. The product makes big claims ("18 data sources," "instant valuations," "county records") but provides no evidence before sign-up. The auth page break in branding damages trust. The social proof is weak (500 properties).

---

## Recommendations

### P0 — Fix immediately

1. **Auth page: default to Sign Up when arriving from "Get Started" CTAs.** Change all landing page "Get Started Free" / "Start Free" links from `/auth` to `/auth?mode=register`. The code already supports this parameter but no link uses it.

2. **Auth page: add AcreOS branding.** Add the logo, a heading ("Create your free account" or "Welcome back"), and a one-line value prop above the Clerk widget. Add a link back to the landing page.

3. **List the 18 data sources.** Add an expandable section or linked page that enumerates all 18 open data sources by name (e.g., "FEMA NFHL flood zones," "USDA soil survey," "US Census TIGER boundaries," "County assessor records via [provider]"). This is the single highest-impact change for skeptical users like David. Consider placing it on both the landing page (under the "18 free data sources" stat) and the pricing page (as a tooltip or footnote on the "Open Data Sources (18)" row).

### P1 — Fix soon

4. **Add Terms of Service and Privacy Policy links to the landing page footer.** These routes exist (`/terms`, `/privacy`) but are not linked from the landing page or pricing page.

5. **Clarify "Notes" in pricing table.** Add a parenthetical: "Notes (seller-financed)" or change the label to "Seller-Finance Notes" to distinguish from text annotations.

6. **Onboarding wizard: add APN field to the Add Property step.** Match the Properties page form so that land investors can enter their parcel's primary identifier during onboarding.

7. **Reduce AI emphasis on landing page.** Reframe "AI Valuations" as "Automated Valuations (18 Data Sources)" and "AI Deal Intelligence" as "Deal Scoring & Analysis." Skeptical users respond better to "automated" and "data-driven" than "AI."

### P2 — Nice to have

8. **Add a screenshot or interactive demo to the landing page.** Even a single screenshot of the property detail view with enrichment data would significantly reduce sign-up friction for skeptical evaluators.

9. **Increase free tier property limit to 5.** Three properties is barely enough to test. Five gives the user enough room to test across 2-3 counties and see data quality variation.

10. **Fix per-seat pricing inconsistency.** Pro at $20/seat and Scale at $40/seat is counterintuitive. Either reduce Scale's per-seat price or explain the differentiation.

11. **Add social proof with specificity.** Replace "500+ properties managed" with something like "Tracking parcels across 38 states" or "Connected to 1,200+ county data feeds" — metrics that speak to data coverage rather than user count.

---

## Verbatim Quotes (David, projected)

> "Show me the 18 data sources. I'm not signing up until I know whether you're pulling real county data or scraping Zillow."

> "Why does the sign-up button take me to a sign-in form? Am I supposed to already have an account?"

> "Where did AcreOS go? This login page looks like it belongs to a different company."

> "500 properties managed is not a selling point. That's one medium-sized operator."

> "'Replaces your guesswork' — I don't guess. I run comps. Your copy is insulting your own target customer."

> "The property form asks for APN first. Finally. Someone who understands land."
