# AcreOS v6 Comprehension Registry

**Generated:** 2026-04-18
**Sources:** 10 cold-visit transcripts, 8 competitor dossiers, 2 mental-model simulations, master vocabulary translation (8 competitors)
**Schema version:** COMP-NNNN

Entries sorted by priority = leverage / (cost x (1 + rework_factor)).

Rework factor values: NONE=0, COPY-ONLY=0.1, MINOR-UI=0.3, STRUCTURAL=0.8.

---

## BLOCKER

### COMP-0001
Title: Landing page headline attracts wrong audience
Severity: BLOCKER
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: CRITICAL
Cost: LOW
Recommendation: Replace "The operating system for real estate professionals" with a headline that explicitly signals land investing / REI deal management. Visitors 001 (RE agent, 2/5), 004 (property manager, 2/5), and 008 (commercial broker, 2/5) all wasted 3-5 minutes before concluding the product was not for them. The headline should name the outcome ("Find, evaluate, and close land deals") or the audience ("The operating system for land investors and deal makers"). Current average category identification score across all 10 visitors is approximately 3.2, well below the 4.2 threshold. Located in `client/src/pages/landing.tsx` and `client/src/components/onboarding/OnboardingWizard.tsx` (line 105, 382).

### COMP-0002
Title: No product screenshots or preview anywhere pre-signup
Severity: BLOCKER
Category: landing-page
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: CRITICAL
Cost: MEDIUM
Recommendation: Add 2-3 product screenshots or a 60-second demo video to the landing page. Every single cold visitor noted this gap. Visitor 003 (tech founder): "No screenshots, no demo, no video. I'm signing up completely blind." Visitor 007 (rural flipper): "I wish someone from the Facebook group had posted screenshots." Visitor 010 (YouTube beginner): "I want to see what it looks like before I put in my email." Competitors Pebble, PropStream, and DealMachine all show product UI on their landing pages. This is the single highest-leverage trust signal missing.

### COMP-0003
Title: Category identification score below threshold
Severity: BLOCKER
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: CRITICAL
Cost: LOW
Recommendation: Restructure the landing page to lead with the land investing vertical and REI deal flow, not generic "real estate professional" positioning. Scores by visitor: 001=2, 002=4, 003=3, 004=2, 005=4, 006=4, 007=3, 008=2, 009=5, 010=3. Average=3.2. Only 3 of 10 visitors scored 4+. The strategy badges (Wholesaling, Fix & Flip, etc.) are doing more harm than good for non-target audiences -- they create false hope for property managers and commercial brokers while diluting the land-specific message for target users. Consider removing or deprioritizing non-core badges and leading with "Land," "Creative Finance," and "Notes."

---

## HIGH

### COMP-0004
Title: "Skip tracing" not visible as a feature or term
Severity: HIGH
Category: vocabulary
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: LOW
Recommendation: Surface "Skip Trace" as a user-facing label on lead records and in the sidebar or command palette. Five competitors (BatchLeads, DealMachine, PropStream, REsimpli, Pebble) use "skip tracing" as a headline feature. AcreOS has the functionality (`SkipTracePanel` in lead detail, batch API at `/api/skip-tracing/batch`) but calls it "data enrichment" internally and never surfaces the term. REsimpli user mental model simulation shows MODERATE mismatch: users expect a top-level "Skip Trace" button on lead lists and bulk actions. Add "Skip Trace" as a bulk action in the leads toolbar and consider adding it to the sidebar under Leads.

### COMP-0005
Title: "CRM" not used anywhere in product or marketing
Severity: HIGH
Category: vocabulary
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Recommendation: Add "CRM" as a meta-term in SEO, marketing copy, and as a sidebar group label or subtitle. Seven of eight competitors use "CRM" prominently. Users searching for "land CRM" or "real estate investor CRM" will not find AcreOS. AcreOS's Leads + Deals + Inbox IS a CRM but never calls itself one. Consider sidebar group label "CRM" wrapping Leads/Deals/Inbox, or add "Your land investing CRM" as landing page copy. Visitor 002 (land investor): "It's like a REI CRM with built-in tools specifically for land deals." He identified the category himself but the product never confirmed it.

### COMP-0006
Title: No "coming from X?" migration affordances
Severity: HIGH
Category: migration-path
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: MEDIUM
Recommendation: Add migration landing pages and onboarding paths for users switching from Pebble, REsimpli, PropStream, and Podio. Visitors 005 (Pebble user, 3.6/5), 006 (PropStream+Podio user, 3.6/5), and 009 (REsimpli user, 4.6/5) are the highest-intent prospects and all flagged the absence of migration support. No "Switching from Pebble?" page. No CSV import wizard. No data mapping documentation. REsimpli has a dedicated "Compare" nav tab with competitive teardowns. Pebble user mental model shows SEVERE mismatch on property import (they go to Properties, but data lives in Leads). A "Switching from..." onboarding branch that maps competitor terminology to AcreOS concepts would capture the highest-LTV audience.

### COMP-0007
Title: Commercial strategy badge misleads commercial brokers
Severity: HIGH
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Recommendation: Remove "Commercial" from the strategy badges or add genuine commercial features to back it up. Visitor 008 (commercial broker, 1.5/5) was actively irritated: "The 'Commercial' badge on the landing page is misleading. If you list 'Commercial' as a supported strategy, I expect to see at least one commercial-specific feature. There are none." No lease management, tenant tracking, cap rate analysis, or CoStar integration exists. The badge damages credibility with professional brokers who might otherwise refer land investors to AcreOS. Located in `client/src/pages/landing.tsx`.

### COMP-0008
Title: AI agent capabilities not clearly differentiated from competitor chatbots
Severity: HIGH
Category: copy
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Recommendation: Reframe AI Hub / Sophie / Pax messaging to clearly describe what AcreOS AI does vs. what competitor AI does. REsimpli user mental model simulation shows SEVERE mismatch: REsimpli's AI agents (VoiceFollow, CallAnswer, Conversational AI) are outward-facing autonomous agents that call leads and answer phones. AcreOS's AI is an inward-facing copilot that assists the user with analysis. Users arriving from REsimpli will expect autonomous lead engagement and find a chat assistant instead. Either (a) explicitly position Pax as an internal intelligence partner ("research any parcel in 30 seconds") following Harvey AI's "intelligent coworker" pattern, or (b) build outward-facing agent capabilities. The Harvey dossier shows the right vocabulary: "workflow agents," not "autonomous AI agents."

### COMP-0009
Title: Dead code: skip-tracing.tsx and direct-mail-campaigns.tsx have no routes
Severity: HIGH
Category: nav-structure
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: LOW
Recommendation: Wire up routes for `/skip-tracing` and `/direct-mail-campaigns` in `App.tsx`, or remove the dead code. Both pages exist as lazy imports (lines 127 and 132 of `App.tsx`) and have complete implementations (`client/src/pages/skip-tracing.tsx`, `client/src/pages/direct-mail-campaigns.tsx`), but neither has a `<Route>` element. The skip-tracing page has batch trace capability that REsimpli and PropStream users will look for. The direct-mail page has campaign management features Pebble users expect as a standalone view. Both Pebble and REsimpli mental model simulations flagged these as navigation gaps.

### COMP-0010
Title: Default sidebar nav does not match landing page feature promises
Severity: HIGH
Category: nav-structure
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: MEDIUM
Recommendation: Align the default sidebar with the features marketed on the landing page. The landing page promotes Portfolio Mapping, Campaign Automation, Document Generation, and Compliance as headline features. The default 5-item sidebar (Today, Pipeline, Money, AI Hub, Settings) hides all of them. Visitors 002, 003, 005, 007, and 010 all noted this disconnect. Visitor 005 (Pebble user): "Campaigns -- the landing page made a big deal about Campaign Automation. It's not in the sidebar." Consider adding Campaigns and Maps to the default sidebar for new users, or implement a first-run onboarding that asks the user to choose their sidebar configuration based on their workflow (land investor, wholesaler, etc.).

### COMP-0011
Title: "Public Beta" label creates anxiety for business users
Severity: HIGH
Category: copy
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Recommendation: Remove or replace the "Now in Public Beta" badge on the landing page (`client/src/pages/landing.tsx`, line 94). Every single visitor who noticed it expressed concern. Visitor 005 (Pebble user): "I have VAs depending on me, deals in progress, and notes being serviced. I can't afford beta-quality software." Visitor 009 (REsimpli user): "I'm running a real business with active deals." Visitor 007 (rural flipper): "I don't know what beta means. Is this a test version? Am I a guinea pig?" If the product is stable enough for production use, remove the label. If it genuinely is unstable, keep it but add a data safety guarantee ("Your data is backed up daily. Export anytime.").

---

## MEDIUM

### COMP-0012
Title: AVM vs Comps vocabulary mismatch
Severity: MEDIUM
Category: vocabulary
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Recommendation: Add "Comps" as a subtitle or alias alongside AVM: "AVM (Comps)" or "Comps / AVM." Four competitors (BatchLeads, DealMachine, PropStream, Pebble) use "comps" or "comparable sales" as the standard term. "AVM" is technically precise but unfamiliar to the majority of target users. Visitor 006 (wholesaler): "Where's the comp tool? In PropStream I can pull comps for any address." The master translation table flags this as RENAMED status requiring ADOPT or TRANSLATE action.

### COMP-0013
Title: No data import/export migration path documented
Severity: MEDIUM
Category: migration-path
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: MEDIUM
Recommendation: Add a visible CSV import wizard accessible from the Leads page toolbar, Properties page, and onboarding flow. Build a "Migration Guide" help page documenting import from Pebble, REsimpli, PropStream, and generic CSV. Visitor 005 (Pebble user): "I have 1,500 leads and 200 properties in Pebble. Can I bring that with me?" Visitor 009 (REsimpli user): "I have 3,000 leads, 300+ properties, and 12 active seller-financed notes." The Leads page has import functionality (ImportCSV, TaxDelinquentImporter) but it is not prominent and there is no "Import" action on the Properties page, creating a dead end for Pebble users who think property-first.

### COMP-0014
Title: Leads vs Properties mental model collision for Pebble users
Severity: MEDIUM
Category: mental-model
Status: OPEN
v5 rework risk: STRUCTURAL
Leverage: MEDIUM
Cost: HIGH
Recommendation: Add a "Property Records" or "Parcels" alias/view that maps to Leads for users who think property-first. Alternatively, add an "Import Parcels" action to the Properties page that creates lead records under the hood. The Pebble mental model simulation shows a SEVERE mismatch: Pebble's "property record" (any parcel you might acquire) maps to AcreOS's "lead," not AcreOS's "property" (something you already own). A Pebble user importing 2,000 parcels to mail will go to Properties first and hit a dead end. Time to complete basic property import: 5-10 minutes vs. <30 seconds for workflow-aligned navigation.

### COMP-0015
Title: No glossary or terminology help for industry terms
Severity: MEDIUM
Category: onboarding
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Recommendation: Add contextual tooltips or a help glossary for AcreOS-specific and industry terms. AcreOS has 11 terms found in no competitor (Land Credit, AVM, Blind Offer Wizard, Acq. Radar, Doc Intel, Capital Mkts, Pax, etc.). These are genuine differentiators but require education. Visitor 007 (rural flipper): "What's 'BYOK Data Providers'? I have no idea what that means." Visitor 010 (YouTube beginner): "'Campaign Automation,' 'sequences,' 'BYOK' -- I don't know what any of that means." Harvey AI's pattern of verb-first, jargon-free descriptions should be adopted: "Research any parcel" not "AI data enrichment engine."

### COMP-0016
Title: No onboarding flow bridges gap between landing page and product
Severity: MEDIUM
Category: onboarding
Status: OPEN
v5 rework risk: STRUCTURAL
Leverage: HIGH
Cost: HIGH
Recommendation: Implement a first-run onboarding wizard that asks: (1) "What do you do?" (land investor, wholesaler, beginner), (2) "What tools have you used?" (Pebble, REsimpli, PropStream, spreadsheets, nothing), (3) "What do you want to do first?" (add a property, run comps, send mailers). Then configure the sidebar, show a guided walkthrough, and pre-populate sample data. Visitors 002, 005, 006, 007, 009, and 010 all flagged the absence of onboarding. Visitor 007 scored 1/5 on first-run: "I'm lost. There's no guidance. No 'Start here' button." Pebble offers live onboarding on all plans. REsimpli offers Zoom support. AcreOS offers nothing.

### COMP-0017
Title: "Motivated Seller" not available as a lead category or filter
Severity: MEDIUM
Category: vocabulary
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Recommendation: Add "Motivated Seller" as a named lead tag, filter category, or list type in the Leads UI. Four competitors (BatchLeads, DealMachine, PropStream, REsimpli) use this term as a primary lead classification. It is industry-standard vocabulary that every wholesaler and land investor uses daily. AcreOS's Leads page has generic status categories but no distress-signal taxonomy.

### COMP-0018
Title: List building / list pulling capability absent
Severity: MEDIUM
Category: mental-model
Status: OPEN
v5 rework risk: STRUCTURAL
Leverage: MEDIUM
Cost: HIGH
Recommendation: If AcreOS adds external property database search, adopt "List Builder" as the feature name. Four competitors (BatchLeads, DealMachine, PropStream, REsimpli) offer list building as a core top-of-funnel feature. Visitor 009 (REsimpli user): "I don't see a list builder or list pulling feature. In REsimpli, I set my filters and pull a list. I don't see that workflow here." Visitor 010 (YouTube beginner) had the same gap: "I need the software to help me FIND leads, not just track them." This is a product gap, not just a vocabulary gap. AcreOS is a deal management system; users expect a deal discovery system.

### COMP-0019
Title: No social proof on landing page (testimonials, logos, case studies)
Severity: MEDIUM
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Recommendation: Add at least one named testimonial from a real user, replace "500+ Properties managed" with a user count or deal count, and add "hours saved" metrics. Every competitor has stronger social proof. REsimpli: "#1 AI-powered CRM." BatchLeads: "Trusted by 10,000+ Real Estate Professionals." DealMachine: "150 million+ properties." Harvey AI: "100,000+ professionals." AcreOS's "500+ Properties managed" is a feature metric that actually hurts credibility -- visitor 003: "500 properties across all users is pre-product-market-fit." Visitor 010: "I Googled 'AcreOS reviews' and found nothing."

### COMP-0020
Title: Pricing page does not explain "AI Requests / day" metering unit
Severity: MEDIUM
Category: pricing-clarity
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Recommendation: Add a tooltip or footnote explaining what counts as an "AI Request" and provide examples. Visitors 002, 003, 006, 007, and 010 all asked "What does 'AI Requests / day' mean?" Visitor 003 (tech founder): "What consumes an AI request? If I'm evaluating 50 properties in a batch, does each one cost a request?" The metering unit is invisible in competitor pricing -- REsimpli and Pebble bundle AI without per-request limits. If AcreOS keeps this metric, explain it clearly. If not necessary, consider removing it and bundling AI into plans.

### COMP-0021
Title: No "Book a Demo" or "Talk to Sales" option anywhere
Severity: MEDIUM
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Recommendation: Add a "Book a Demo" link alongside the "Get Started Free" CTA. Pebble has "Book a Demo" as a primary CTA. PropStream offers a "Talk to an Expert" path. InvestorFuse has dedicated demo booking. Visitor 005 (Pebble user): "For a $50-80/mo commitment involving a full platform migration, I'd want to talk to someone first." Visitor 007 (rural flipper): "There's no phone number anywhere. No chat. No way to talk to a real person."

### COMP-0022
Title: KPI Dashboard hidden behind "Intelligence" label
Severity: MEDIUM
Category: nav-structure
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Recommendation: Promote the `/kpis` route to the sidebar nav or rename "Intelligence > Insights" to "Reports" or "KPIs." Three competitors (InvestorFuse, REsimpli, Pebble) use "KPI Dashboard" as a named feature. REsimpli user mental model simulation shows MODERATE mismatch: "I'd look for 'KPIs' or 'Reports,' not 'Intelligence.'" The `/kpis` route exists in `App.tsx` but has no sidebar nav item -- it is a hidden page. CRM users universally expect "Reports" or "Analytics" as a top-level nav concept.

---

## LOW

### COMP-0023
Title: No mobile app or mobile-optimized mention on landing page
Severity: LOW
Category: landing-page
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Recommendation: If the product works on mobile, state it. If a mobile app exists or is planned, mention it. PropStream dedicates an entire nav item to mobile. DealMachine's Driving for Dollars is a mobile-first workflow. Visitors 006, 007, and 010 all asked about mobile. Visitor 010 is phone-only (no desktop) and the mobile experience was "functional but cramped."

### COMP-0024
Title: SMS / direct mail per-message cost not disclosed on pricing page
Severity: LOW
Category: pricing-clarity
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Recommendation: Add per-unit costs for SMS and direct mail to the pricing page or feature comparison table. Visitor 006 (wholesaler): "One thing I notice: there's no mention of per-message costs for SMS or direct mail. $49/mo for unlimited campaigns with SMS sounds too good." DealMachine shows per-piece mail costs by tier ($0.72, $0.67, $0.62). PropStream shows postcard and email unit costs. Transparency prevents churn from billing surprise.

### COMP-0025
Title: No education hub, academy, or resource center
Severity: LOW
Category: onboarding
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: LOW
Cost: MEDIUM
Recommendation: Add an "Academy" or "Resources" link in the top nav or footer. PropStream has a top-level "Academy" nav item with webinars and video library. Harvey AI has "Harvey Academy." REsimpli has a "Resources" dropdown. AcreOS has an `academy.tsx` page in the codebase but no visible link from the landing page. Visitor 003 (tech founder): "There's no content anywhere. No blog. No docs. No 'How it works' page."

### COMP-0026
Title: Overage behavior not documented at tier limits
Severity: LOW
Category: pricing-clarity
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Recommendation: Add a FAQ entry or tooltip explaining what happens when a user hits their lead, property, or AI request limit. Visitors 005, 006, and 009 all asked: "What happens when I hit 500 leads?" Options: hard block, soft notification, auto-upgrade, or per-unit overage. The current pricing page is silent, which creates anxiety for users planning campaigns.

### COMP-0027
Title: "Property Data" / "Enrich" action not visible on property records
Severity: LOW
Category: vocabulary
Status: OPEN
v5 rework risk: MINOR-UI
Leverage: LOW
Cost: LOW
Recommendation: Add a visible "Enrich" or "Pull Property Data" button on property detail records. Five competitors (BatchLeads, DealMachine, PropStream, REsimpli, Pebble) surface property data enrichment as a named, one-click action. AcreOS performs enrichment via the provider registry but does not expose it as a user-facing verb. Users expect to see a button that says "Get Property Data" or "Enrich" on any record.

### COMP-0028
Title: Cash Buyers not surfaced as a concept in Marketplace
Severity: LOW
Category: vocabulary
Status: OPEN
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Recommendation: Add "Cash Buyers" as a section label or filter within the Marketplace page. Three competitors (BatchLeads, PropStream, REsimpli) use "Cash Buyers" as a named lead type. AcreOS's Marketplace says "Buy and sell deals" but does not use the industry term. Wholesalers specifically search for "cash buyer lists" as a feature.

---

## Summary Table

| ID | Title | Severity | Category | Rework | Leverage | Cost | Priority Score |
|---|---|---|---|---|---|---|---|
| COMP-0001 | Headline attracts wrong audience | BLOCKER | landing-page | COPY-ONLY | CRITICAL | LOW | 9.09 |
| COMP-0003 | Category ID below threshold | BLOCKER | landing-page | COPY-ONLY | CRITICAL | LOW | 9.09 |
| COMP-0011 | "Public Beta" label anxiety | HIGH | copy | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0005 | "CRM" not used anywhere | HIGH | vocabulary | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0007 | Commercial badge misleads | HIGH | landing-page | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0008 | AI capabilities not differentiated | HIGH | copy | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0004 | Skip tracing not visible | HIGH | vocabulary | MINOR-UI | HIGH | LOW | 5.77 |
| COMP-0009 | Dead code: skip-tracing + direct-mail | HIGH | nav-structure | MINOR-UI | HIGH | LOW | 5.77 |
| COMP-0012 | AVM vs Comps mismatch | MEDIUM | vocabulary | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0017 | Motivated Seller not a category | MEDIUM | vocabulary | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0015 | No glossary or terminology help | MEDIUM | onboarding | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0019 | No social proof on landing page | MEDIUM | landing-page | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0020 | AI Requests metering unexplained | MEDIUM | pricing-clarity | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0021 | No Book a Demo option | MEDIUM | landing-page | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0002 | No product screenshots pre-signup | BLOCKER | landing-page | MINOR-UI | CRITICAL | MEDIUM | 3.85 |
| COMP-0022 | KPI Dashboard hidden | MEDIUM | nav-structure | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0027 | Property Data enrichment not visible | LOW | vocabulary | MINOR-UI | LOW | LOW | 1.92 |
| COMP-0028 | Cash Buyers not surfaced | LOW | vocabulary | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0010 | Sidebar does not match landing page | HIGH | nav-structure | MINOR-UI | HIGH | MEDIUM | 2.88 |
| COMP-0006 | No migration affordances | HIGH | migration-path | MINOR-UI | HIGH | MEDIUM | 2.88 |
| COMP-0013 | No import/export migration path | MEDIUM | migration-path | MINOR-UI | MEDIUM | MEDIUM | 1.92 |
| COMP-0023 | No mobile mention | LOW | landing-page | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0024 | SMS/mail unit cost not disclosed | LOW | pricing-clarity | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0026 | Overage behavior undocumented | LOW | pricing-clarity | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0025 | No education hub | LOW | onboarding | MINOR-UI | LOW | MEDIUM | 0.96 |
| COMP-0016 | No onboarding flow | MEDIUM | onboarding | STRUCTURAL | HIGH | HIGH | 1.39 |
| COMP-0014 | Leads vs Properties collision | MEDIUM | mental-model | STRUCTURAL | MEDIUM | HIGH | 0.83 |
| COMP-0018 | List building absent | MEDIUM | mental-model | STRUCTURAL | MEDIUM | HIGH | 0.83 |

---

## Convergence Status

### By Severity

| Severity | Count | Resolved | Open |
|---|---|---|---|
| BLOCKER | 3 | 0 | 3 |
| HIGH | 8 | 0 | 8 |
| MEDIUM | 12 | 0 | 12 |
| LOW | 5 | 0 | 5 |
| **Total** | **28** | **0** | **28** |

### By Category

| Category | Count | Highest Severity |
|---|---|---|
| landing-page | 7 | BLOCKER |
| vocabulary | 6 | HIGH |
| copy | 3 | HIGH |
| nav-structure | 3 | HIGH |
| migration-path | 2 | HIGH |
| onboarding | 3 | MEDIUM |
| mental-model | 2 | MEDIUM |
| pricing-clarity | 3 | MEDIUM |

### By v5 Rework Risk

| Rework Level | Count | Description |
|---|---|---|
| COPY-ONLY | 14 | Text/label changes, no code beyond content strings |
| MINOR-UI | 10 | Small component additions, route wiring, sidebar config |
| STRUCTURAL | 4 | New pages, data model aliases, onboarding wizard |

### Convergence Assessment

**Status: PRE-CONVERGENCE**

Zero of 28 findings resolved. However, the distribution is favorable for rapid progress:

- **14 of 28 items are COPY-ONLY** -- achievable in a single sprint with zero backend changes. This includes all 3 BLOCKERs and 4 of 8 HIGHs.
- **10 items are MINOR-UI** -- route wiring, sidebar defaults, button additions. Most are under 2 hours of work each.
- **Only 4 items are STRUCTURAL** -- onboarding wizard, mental model aliases, and list building (which is a product gap, not a comprehension gap).

**Recommended convergence path:**

1. **Sprint 1 (COPY-ONLY BLOCKERs + HIGHs):** Fix COMP-0001 (headline), COMP-0003 (category signals), COMP-0011 (beta label), COMP-0005 (CRM term), COMP-0007 (commercial badge), COMP-0008 (AI positioning). Six items, zero code changes beyond string edits. Eliminates all BLOCKERs and 4 HIGHs.

2. **Sprint 2 (MINOR-UI):** Wire routes for COMP-0009 (dead code), add screenshots for COMP-0002, update sidebar defaults for COMP-0010, add skip trace button for COMP-0004, add Comps alias for COMP-0012. Five items, light frontend work.

3. **Sprint 3 (Migration + Onboarding):** Build migration pages for COMP-0006, import wizard for COMP-0013, onboarding flow for COMP-0016. Three items, moderate effort, highest long-term retention impact.

4. **Backlog:** COMP-0014 (Leads/Properties alias), COMP-0018 (list building) -- these are product decisions, not comprehension fixes.

**Target:** Resolve all BLOCKERs and HIGHs within 2 sprints. Achieve category identification score of 4.2+ on re-test with 5 cold visitors after Sprint 1 changes.

---

## Cross-Reference: Cold Visit Scores

| Visitor | Profile | Score | Target? | Key Blocker |
|---|---|---|---|---|
| 001 | RE Agent | 1.75/5 | No | Headline says "RE professionals" but means land investors |
| 002 | Land Investor (spreadsheet) | 3.8/5 | Yes | Beta label, no onboarding, sidebar hides features |
| 003 | Tech Founder | 3.2/5 | Partial | No screenshots, no social proof, nav scope alarming |
| 004 | Property Manager | 1.5/5 | No | Strategy badges create false hope |
| 005 | Pebble User | 3.6/5 | Yes | Beta label, no migration path, sidebar hides features |
| 006 | Wholesaler (PropStream) | 3.6/5 | Yes | No skip tracing mention, lead limits tight, beta label |
| 007 | Rural Land Flipper | 2.2/5 | Yes | Jargon overload, no screenshots, no onboarding |
| 008 | Commercial Broker | 1.5/5 | No | Commercial badge misleading, zero relevant features |
| 009 | REsimpli User | 4.6/5 | Yes | Beta label, no import wizard -- otherwise near-perfect |
| 010 | YouTube Beginner | 2.8/5 | Yes | No onboarding, no lead discovery, phone-only |

**Target visitors (6 of 10):** Average score = 3.43/5
**Non-target visitors (4 of 10):** Average score = 1.63/5

The comprehension gap is clearest in two dimensions:
1. **Non-target visitors score too high on initial category identification** (2/5 average) -- the headline pulls them in when it should filter them out.
2. **Target visitors score too low on first-run experience** (2.67/5 average) -- the product has the features but hides them behind misconfigured defaults and zero onboarding.

Fixing both requires the same intervention: sharpen positioning to repel non-targets and align first-run experience with the expectations the landing page creates for targets.

---

## Cross-Reference: Competitor Vocabulary Gaps

Terms used by 3+ competitors that AcreOS does not surface:

| Term | Competitors | AcreOS Status | Registry Entry |
|---|---|---|---|
| Skip Tracing | 5 | Exists but hidden | COMP-0004 |
| CRM | 7 | Never used | COMP-0005 |
| Comps | 4 | Called "AVM" | COMP-0012 |
| Motivated Seller | 4 | No lead taxonomy | COMP-0017 |
| List Building | 4 | Feature absent | COMP-0018 |
| Property Data | 5 | No "Enrich" button | COMP-0027 |
| KPI Dashboard | 3 | Hidden route | COMP-0022 |
| Cash Buyers | 3 | Not surfaced | COMP-0028 |

**8 vocabulary gaps total.** 5 are addressable with labels/copy. 2 require minor UI. 1 (list building) is a product gap.
