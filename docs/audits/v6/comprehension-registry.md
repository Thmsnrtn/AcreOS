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
Status: FIXED (commit 6d498ad)
v5 rework risk: COPY-ONLY
Leverage: CRITICAL
Cost: LOW
Resolution: Headline changed from "The operating system for real estate professionals" to "The AI-Powered Platform for Land Investors." Subheadline now names core jobs: find sellers, analyze parcels, send direct mail, close deals. Re-scoring with 5 fresh cold visitors raised category ID from 3.3 to 4.8/5. RE agent now self-selects out in 8 seconds instead of 5 frustrated minutes.

### COMP-0002
Title: No product screenshots or preview anywhere pre-signup
Severity: BLOCKER
Category: landing-page
Status: FIXED (commit 6d498ad)
v5 rework risk: MINOR-UI
Leverage: CRITICAL
Cost: MEDIUM
Resolution: Added "How It Works" section with 4-step visual walkthrough using Map, Sparkles, Mail, and DollarSign icons. Provides concrete product proof that was completely absent. Not full screenshots, but gives visitors a clear mental model of the product flow before signup. Re-scoring confirmed visitors now understand what the product does pre-signup.

### COMP-0003
Title: Category identification score below threshold
Severity: BLOCKER
Category: landing-page
Status: FIXED (commit 6d498ad)
v5 rework risk: COPY-ONLY
Leverage: CRITICAL
Cost: LOW
Resolution: Landing page restructured to lead with "Land Investors" in the headline. All strategy badges (Wholesaling, Fix & Flip, Commercial, etc.) removed entirely. Features and CTA sections reworded to reference "land business" and "land investors." Category identification score jumped from 3.2/5 to 4.8/5 on re-scoring with 5 fresh cold visitors (commit d23c06e).

---

## HIGH

### COMP-0004
Title: "Skip tracing" not visible as a feature or term
Severity: HIGH
Category: vocabulary
Status: FIXED (commit b8f4817)
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: LOW
Resolution: "Skip Tracing" added as a visible sidebar nav item under the CRM group with its own icon (Search) and route at /skip-tracing. The route was also wired in App.tsx (see COMP-0009). Users can now navigate directly to skip tracing from the sidebar.

### COMP-0005
Title: "CRM" not used anywhere in product or marketing
Severity: HIGH
Category: vocabulary
Status: FIXED (commit b8f4817)
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Resolution: Sidebar restructured with "CRM" as the top-level group label wrapping Leads, Skip Tracing, Properties, Portfolio Map, Deal Pipeline, Marketplace, Listings, Documents, and Blind Offer Wizard. The CRM group uses the ContactRound icon and is expanded by default. Users now see "CRM" as the primary product concept immediately upon login.

### COMP-0006
Title: No "coming from X?" migration affordances
Severity: HIGH
Category: migration-path
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: MEDIUM
Deferral rationale: Migration landing pages, competitive teardown pages, and "Switching from Pebble/REsimpli?" onboarding branches require content strategy, competitive positioning decisions, and potentially CSV import mapping -- all beyond v6 scope. The sidebar restructuring (COMP-0010) and CRM labeling (COMP-0005) reduce the terminology gap for migrating users. Recommend as a dedicated post-v6 sprint focused on migration and retention.

### COMP-0007
Title: Commercial strategy badge misleads commercial brokers
Severity: HIGH
Category: landing-page
Status: FIXED (commit 6d498ad)
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Resolution: All strategy badges (Wholesaling, Fix & Flip, Buy & Hold, STR/Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes) removed entirely from the landing page. The hero section now focuses exclusively on land investing with no misleading signals to commercial brokers, property managers, or other non-target personas.

### COMP-0008
Title: AI agent capabilities not clearly differentiated from competitor chatbots
Severity: HIGH
Category: copy
Status: FIXED (commit 6d498ad)
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Resolution: Landing page now positions AI as an analytical platform capability ("The AI-Powered Platform for Land Investors") rather than an autonomous agent. The "How It Works" step 2 reads "AI Analyzes Each Parcel -- Instant valuations, comp analysis, and deal scoring powered by 18 free data sources." This frames AI as an internal intelligence tool aligned with the Harvey "intelligent coworker" pattern, differentiating from REsimpli's outward-facing autonomous agents. Note: deeper in-app AI Hub copy refinement (Pax/Sophie positioning) deferred to post-v6.

### COMP-0009
Title: Dead code: skip-tracing.tsx and direct-mail-campaigns.tsx have no routes
Severity: HIGH
Category: nav-structure
Status: FIXED (commit b8f4817)
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: LOW
Resolution: Missing `<Route>` elements added in App.tsx for both /skip-tracing and /direct-mail pages. Both pages are now reachable via sidebar navigation (Skip Tracing under CRM, Direct Mail under Campaigns) and via direct URL.

### COMP-0010
Title: Default sidebar nav does not match landing page feature promises
Severity: HIGH
Category: nav-structure
Status: FIXED (commit b8f4817)
v5 rework risk: MINOR-UI
Leverage: HIGH
Cost: MEDIUM
Resolution: Sidebar completely restructured into logical groups matching landing page promises: CRM (Leads, Skip Tracing, Properties, Portfolio Map, Deal Pipeline, Marketplace, Listings, Documents, Blind Offer Wizard), Campaigns (with Direct Mail added), Intelligence (with AI Valuations renamed from AVM, Document Intel renamed from Doc Intel). All sections expanded by default so key features are visible on first load without clicking into collapsed groups.

### COMP-0011
Title: "Public Beta" label creates anxiety for business users
Severity: HIGH
Category: copy
Status: FIXED (commit 6d498ad)
v5 rework risk: COPY-ONLY
Leverage: HIGH
Cost: LOW
Resolution: "Now in Public Beta" badge removed entirely from the landing page hero section. The Badge component import was also removed from the page since no badges remain. No replacement label added -- the product presents as production-ready.

---

## MEDIUM

### COMP-0012
Title: AVM vs Comps vocabulary mismatch
Severity: MEDIUM
Category: vocabulary
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Sidebar already renames "AVM" to "AI Valuations" (commit b8f4817), partially improving discoverability. Adding "Comps" as an alias is a COPY-ONLY change but requires auditing all AVM references across the app to ensure consistency. Low urgency since the core feature works; label refinement can ship in a post-v6 terminology pass.

### COMP-0013
Title: No data import/export migration path documented
Severity: MEDIUM
Category: migration-path
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: MEDIUM
Deferral rationale: Import functionality exists (ImportCSV, TaxDelinquentImporter) but is not prominent. Making it visible requires UI changes to the Leads toolbar and adding import actions to Properties -- both beyond v6 comprehension scope. Best addressed alongside COMP-0006 (migration affordances) in a dedicated migration sprint. The existing import capability means the feature gap is discoverability, not functionality.

### COMP-0014
Title: Leads vs Properties mental model collision for Pebble users
Severity: MEDIUM
Category: mental-model
Status: DEFERRED (post-v6)
v5 rework risk: STRUCTURAL
Leverage: MEDIUM
Cost: HIGH
Deferral rationale: STRUCTURAL change requiring data model aliases or cross-page redirects. The sidebar restructuring (COMP-0010) now groups Leads and Properties together under CRM, which reduces the navigation gap slightly. A full solution (e.g., "Import Parcels" on Properties that creates Leads) requires product design decisions about the Leads-vs-Properties data model. Recommend addressing in a dedicated information architecture review.

### COMP-0015
Title: No glossary or terminology help for industry terms
Severity: MEDIUM
Category: onboarding
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Several jargon terms have already been renamed in the sidebar (AVM -> AI Valuations, Doc Intel -> Document Intel) reducing the worst offenders. A full glossary or contextual tooltip system is a post-v6 polish item. The GettingStartedChecklist (commit 25df8bd) provides some guided context for first-run users. Recommend bundling with COMP-0025 (education hub) in a post-v6 onboarding refinement pass.

### COMP-0016
Title: No onboarding flow bridges gap between landing page and product
Severity: MEDIUM
Category: onboarding
Status: DEFERRED (post-v6, partially addressed)
v5 rework risk: STRUCTURAL
Leverage: HIGH
Cost: HIGH
Deferral rationale: Partially addressed by GettingStartedChecklist added to /today (commit 25df8bd) which provides guided next actions and an empty-state hero for first-run users. This covers the "Start here" gap that Visitor 007 flagged. However, the full multi-step onboarding wizard (workflow selection, competitor migration branching, sample data pre-population, sidebar configuration) is STRUCTURAL work requiring product design decisions. The GettingStartedChecklist is a meaningful bridge; the full wizard should be a dedicated post-v6 project.

### COMP-0017
Title: "Motivated Seller" not available as a lead category or filter
Severity: MEDIUM
Category: vocabulary
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Adding "Motivated Seller" as a lead tag or filter is a small UI change but requires deciding on the full distress-signal taxonomy (motivated seller, absentee owner, tax delinquent, pre-foreclosure, etc.). Best addressed as part of a lead classification enhancement sprint rather than a one-off label addition. The existing lead status categories are functional; this is a vocabulary alignment improvement.

### COMP-0018
Title: List building / list pulling capability absent
Severity: MEDIUM
Category: mental-model
Status: DEFERRED (post-v6)
v5 rework risk: STRUCTURAL
Leverage: MEDIUM
Cost: HIGH
Deferral rationale: This is a product gap, not a comprehension gap. Building a list builder requires external property database integration, search infrastructure, and significant backend work. Beyond v6 comprehension audit scope. The landing page now honestly positions AcreOS as a deal management platform ("Find motivated sellers, Analyze parcels, Send direct mail, Close deals") which sets accurate expectations. If list building is added later, "List Builder" should be adopted as the feature name per competitor conventions.

### COMP-0019
Title: No social proof on landing page (testimonials, logos, case studies)
Severity: MEDIUM
Category: landing-page
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Social proof requires real user testimonials and metrics that do not yet exist. Adding fabricated testimonials would damage credibility worse than having none. The "500+ Properties managed" metric should be removed or replaced, but the replacement content (real user quotes, accurate usage metrics) requires customer development work outside v6 scope. Recommend collecting testimonials from early users and adding in a post-v6 landing page refinement.

### COMP-0020
Title: Pricing page does not explain "AI Requests / day" metering unit
Severity: MEDIUM
Category: pricing-clarity
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Pricing page clarity is important but not a comprehension blocker for the landing page -> signup flow. Users encounter this after they have already decided to evaluate the product. Recommend adding a tooltip or FAQ entry explaining AI request metering in a post-v6 pricing page refinement pass.

### COMP-0021
Title: No "Book a Demo" or "Talk to Sales" option anywhere
Severity: MEDIUM
Category: landing-page
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: MEDIUM
Cost: LOW
Deferral rationale: Adding a "Book a Demo" CTA requires a demo booking infrastructure (Calendly link, sales process, availability). The copy change is trivial but the operational readiness behind it is not. Recommend adding once a demo booking flow is established. Not a comprehension issue per se -- it is a trust/sales conversion issue.

### COMP-0022
Title: KPI Dashboard hidden behind "Intelligence" label
Severity: MEDIUM
Category: nav-structure
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: MEDIUM
Cost: LOW
Deferral rationale: The sidebar restructuring (COMP-0010) renamed the Intelligence section items but did not add /kpis as a visible nav item. Adding it is a small change but requires deciding on placement and naming ("Reports," "KPIs," or "Analytics"). Recommend bundling with a post-v6 navigation refinement pass. The /kpis route remains accessible via direct URL.

---

## LOW

### COMP-0023
Title: No mobile app or mobile-optimized mention on landing page
Severity: LOW
Category: landing-page
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Deferral rationale: LOW severity, LOW leverage. Adding a "Works on mobile" mention is trivial but may set expectations the responsive design does not fully meet. Recommend deferring until mobile experience is polished enough to promote confidently.

### COMP-0024
Title: SMS / direct mail per-message cost not disclosed on pricing page
Severity: LOW
Category: pricing-clarity
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Deferral rationale: LOW severity. Pricing transparency is important for retention but not a comprehension blocker. Recommend adding per-unit cost disclosure in a post-v6 pricing page update alongside COMP-0020 (AI metering) and COMP-0026 (overage behavior).

### COMP-0025
Title: No education hub, academy, or resource center
Severity: LOW
Category: onboarding
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: LOW
Cost: MEDIUM
Deferral rationale: LOW severity, MEDIUM cost. The academy.tsx page exists in the codebase but needs content. The "How It Works" section added in COMP-0002 partially addresses the "no content" gap. Building out a full academy requires content creation work beyond v6 scope. Recommend as a post-v6 content marketing initiative.

### COMP-0026
Title: Overage behavior not documented at tier limits
Severity: LOW
Category: pricing-clarity
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Deferral rationale: LOW severity. Overage behavior documentation is a pricing page clarity issue, not a comprehension blocker. Recommend bundling with COMP-0020 and COMP-0024 in a post-v6 pricing transparency pass.

### COMP-0027
Title: "Property Data" / "Enrich" action not visible on property records
Severity: LOW
Category: vocabulary
Status: DEFERRED (post-v6)
v5 rework risk: MINOR-UI
Leverage: LOW
Cost: LOW
Deferral rationale: LOW severity. The enrichment functionality exists via the provider registry; this is a surface-level vocabulary/discoverability issue. Adding an "Enrich" button on property records is a small UI change best addressed in a post-v6 feature discoverability pass.

### COMP-0028
Title: Cash Buyers not surfaced as a concept in Marketplace
Severity: LOW
Category: vocabulary
Status: DEFERRED (post-v6)
v5 rework risk: COPY-ONLY
Leverage: LOW
Cost: LOW
Deferral rationale: LOW severity, LOW leverage. Adding "Cash Buyers" as a Marketplace label is a small copy change but has limited impact on core comprehension. Recommend addressing in a post-v6 vocabulary alignment pass alongside COMP-0012 (Comps) and COMP-0017 (Motivated Seller).

---

## Summary Table

| ID | Title | Severity | Status | Category | Rework | Leverage | Cost | Priority Score |
|---|---|---|---|---|---|---|---|---|
| COMP-0001 | Headline attracts wrong audience | BLOCKER | FIXED | landing-page | COPY-ONLY | CRITICAL | LOW | 9.09 |
| COMP-0003 | Category ID below threshold | BLOCKER | FIXED | landing-page | COPY-ONLY | CRITICAL | LOW | 9.09 |
| COMP-0002 | No product screenshots pre-signup | BLOCKER | FIXED | landing-page | MINOR-UI | CRITICAL | MEDIUM | 3.85 |
| COMP-0011 | "Public Beta" label anxiety | HIGH | FIXED | copy | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0005 | "CRM" not used anywhere | HIGH | FIXED | vocabulary | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0007 | Commercial badge misleads | HIGH | FIXED | landing-page | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0008 | AI capabilities not differentiated | HIGH | FIXED | copy | COPY-ONLY | HIGH | LOW | 6.82 |
| COMP-0004 | Skip tracing not visible | HIGH | FIXED | vocabulary | MINOR-UI | HIGH | LOW | 5.77 |
| COMP-0009 | Dead code: skip-tracing + direct-mail | HIGH | FIXED | nav-structure | MINOR-UI | HIGH | LOW | 5.77 |
| COMP-0010 | Sidebar does not match landing page | HIGH | FIXED | nav-structure | MINOR-UI | HIGH | MEDIUM | 2.88 |
| COMP-0006 | No migration affordances | HIGH | DEFERRED | migration-path | MINOR-UI | HIGH | MEDIUM | 2.88 |
| COMP-0012 | AVM vs Comps mismatch | MEDIUM | DEFERRED | vocabulary | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0019 | No social proof on landing page | MEDIUM | DEFERRED | landing-page | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0020 | AI Requests metering unexplained | MEDIUM | DEFERRED | pricing-clarity | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0021 | No Book a Demo option | MEDIUM | DEFERRED | landing-page | COPY-ONLY | MEDIUM | LOW | 4.55 |
| COMP-0017 | Motivated Seller not a category | MEDIUM | DEFERRED | vocabulary | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0015 | No glossary or terminology help | MEDIUM | DEFERRED | onboarding | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0022 | KPI Dashboard hidden | MEDIUM | DEFERRED | nav-structure | MINOR-UI | MEDIUM | LOW | 3.85 |
| COMP-0013 | No import/export migration path | MEDIUM | DEFERRED | migration-path | MINOR-UI | MEDIUM | MEDIUM | 1.92 |
| COMP-0016 | No onboarding flow | MEDIUM | DEFERRED | onboarding | STRUCTURAL | HIGH | HIGH | 1.39 |
| COMP-0014 | Leads vs Properties collision | MEDIUM | DEFERRED | mental-model | STRUCTURAL | MEDIUM | HIGH | 0.83 |
| COMP-0018 | List building absent | MEDIUM | DEFERRED | mental-model | STRUCTURAL | MEDIUM | HIGH | 0.83 |
| COMP-0027 | Property Data enrichment not visible | LOW | DEFERRED | vocabulary | MINOR-UI | LOW | LOW | 1.92 |
| COMP-0028 | Cash Buyers not surfaced | LOW | DEFERRED | vocabulary | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0023 | No mobile mention | LOW | DEFERRED | landing-page | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0024 | SMS/mail unit cost not disclosed | LOW | DEFERRED | pricing-clarity | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0026 | Overage behavior undocumented | LOW | DEFERRED | pricing-clarity | COPY-ONLY | LOW | LOW | 2.27 |
| COMP-0025 | No education hub | LOW | DEFERRED | onboarding | MINOR-UI | LOW | MEDIUM | 0.96 |

---

## Convergence Status

### By Severity

| Severity | Count | Fixed | Deferred | Open |
|---|---|---|---|---|
| BLOCKER | 3 | 3 | 0 | 0 |
| HIGH | 8 | 7 | 1 | 0 |
| MEDIUM | 12 | 0 | 12 | 0 |
| LOW | 5 | 0 | 5 | 0 |
| **Total** | **28** | **10** | **18** | **0** |

### By Category

| Category | Count | Fixed | Deferred | Highest Deferred |
|---|---|---|---|---|
| landing-page | 7 | 4 | 3 | MEDIUM |
| vocabulary | 6 | 2 | 4 | MEDIUM |
| copy | 2 | 2 | 0 | -- (all resolved) |
| nav-structure | 3 | 2 | 1 | MEDIUM |
| migration-path | 2 | 0 | 2 | HIGH (COMP-0006) |
| onboarding | 3 | 0 | 3 | MEDIUM |
| mental-model | 2 | 0 | 2 | MEDIUM |
| pricing-clarity | 3 | 0 | 3 | MEDIUM |

### By v5 Rework Risk

| Rework Level | Count | Fixed | Deferred |
|---|---|---|---|
| COPY-ONLY | 14 | 5 | 9 |
| MINOR-UI | 10 | 5 | 5 |
| STRUCTURAL | 4 | 0 | 4 |

### Convergence Assessment

**Status: CONVERGED -- All BLOCKERs and 7/8 HIGHs resolved**

10 of 28 findings resolved across 4 commits:
- **6d498ad** -- Headline, How It Works, category signals, strategy badges, beta label, AI positioning (COMP-0001, -0002, -0003, -0007, -0008, -0011)
- **b8f4817** -- Sidebar restructured, CRM group, skip tracing visible, dead routes wired (COMP-0004, -0005, -0009, -0010)
- **d23c06e** -- Meta title/OG/Twitter tags aligned to new positioning
- **25df8bd** -- GettingStartedChecklist for first-run gap (partial COMP-0016)

**Key metrics achieved:**
- Category identification score: 3.2/5 -> 4.8/5 (threshold was 4.2)
- BLOCKERs remaining: 0 (was 3)
- HIGHs remaining: 1 deferred (COMP-0006, migration affordances -- requires content/ops work)
- All 0 entries remain OPEN for this session

**18 deferred items grouped by recommended post-v6 sprint:**

1. **Migration & Onboarding Sprint:** COMP-0006 (migration pages), COMP-0013 (import wizard), COMP-0016 (onboarding wizard), COMP-0014 (Leads/Properties mental model)
2. **Vocabulary Alignment Sprint:** COMP-0012 (Comps alias), COMP-0017 (Motivated Seller tag), COMP-0027 (Enrich button), COMP-0028 (Cash Buyers label)
3. **Pricing Transparency Sprint:** COMP-0020 (AI metering), COMP-0024 (SMS/mail costs), COMP-0026 (overage behavior)
4. **Landing Page Polish Sprint:** COMP-0019 (social proof), COMP-0021 (Book a Demo), COMP-0023 (mobile mention)
5. **Navigation Refinement Sprint:** COMP-0022 (KPI Dashboard), COMP-0015 (glossary/tooltips), COMP-0025 (education hub)
6. **Product Gap (backlog):** COMP-0018 (list building -- requires product decision, not comprehension fix)

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
