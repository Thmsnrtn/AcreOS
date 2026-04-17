# Lens 22 -- UX Researcher

Auditor: UX Research Specialist
Date: 2026-04-15
Scope: User mental models, task flow linearity, cognitive load, terminology clarity, action discoverability, and alignment with how land investors actually think about their work.

---

## Executive Summary

AcreOS attempts to serve as a full-lifecycle operating system for land investors, covering
lead sourcing through note servicing. The mental model it presents, however, diverges from
how practitioners actually think about their workflow in several critical ways. The
application exposes 157 page files and 15 settings tabs, creating substantial cognitive
overhead for users whose daily workflow involves 4-6 core tasks. Key pain points include:
a missing lead-to-deal conversion action on the critical path, two incompatible status
taxonomies for the same entities, the overloaded term "Notes" (sticky notes vs. promissory
notes), and a pipeline page that re-renders entire sub-pages inside tabs rather than
presenting a unified view. The onboarding wizard is well-structured for role-based
personalization but deposits users onto a "Today" page that offers no guidance on what to
do next once the wizard closes.

---

## Findings

### F22-01 -- No "Convert to Deal" action on the lead detail view (P1)

**Files:** `client/src/pages/leads.tsx` (lines 2216-2555), `client/src/pages/deals.tsx`

The core mental model for land investors is: find a lead, evaluate the property, make an
offer, negotiate, close the deal. The critical transition from "lead" to "deal" has no
discoverable UI affordance. The lead detail drawer (`LeadDetailDrawer`) shows contact info,
score details, TCPA compliance, assignment, custom fields, and a timeline -- but no button
to create a deal from this lead. Users must leave the lead context entirely, navigate to
`/deals`, click "Add Deal," and manually re-enter or select the property. The Deal form
(`DealForm`, line 1792) asks for a property but does not accept a lead reference at all,
severing the conceptual link between the lead who owns the land and the deal to acquire it.

The only "conversion" flow in the codebase exists in `/deal-hunter` (a separate AI feature),
where discovered opportunities can be converted to leads or properties -- but this is the
reverse direction (opportunity to lead), not the critical lead-to-deal path.

**User impact:** The single most important transition in the land investing workflow requires
context-switching, re-entering data, and provides no continuity between the person (lead)
and the transaction (deal).

### F22-02 -- Two incompatible status taxonomies for leads (P1)

**Files:** `client/src/pages/leads.tsx`, `client/src/pages/pipeline.tsx` (lines 64-69)

The leads page uses a "nurturing stage" taxonomy for filtering: `hot`, `warm`, `cold`, `dead`.
These are temperature-based metaphors for lead quality/engagement.

The lead form and bulk actions use a "status" taxonomy: `new`, `contacting`, `negotiation`,
`closed`, `dead`. These represent workflow stages.

The pipeline page introduces a third set of funnel stages: `new`, `contacted` (maps to
`mailed`, `responded`, `interested`), `qualifying` (maps to `qualified`, `negotiating`),
`accepted`, `closed`. These are yet another taxonomy that partially overlaps with the
form statuses but uses different labels and groupings.

A user looking at a lead that shows a "hot" badge, a "contacting" status, and a "Contacted"
pipeline stage is seeing three different labels for what they perceive as one piece of
information: "where is this lead in my process?" The cognitive cost of reconciling these
three systems is high and the relationships between them are never explained in the UI.

### F22-03 -- "Notes" is semantically overloaded (P1)

**Files:** `client/src/pages/finance.tsx`, `client/src/pages/leads.tsx`, `client/src/pages/money.tsx`, `client/src/components/layout-sidebar.tsx`

The term "Notes" refers to two entirely different concepts:

1. **Promissory notes** (seller-financed loans) -- the core financial instrument in the
   Finance page, with borrower, principal, interest rate, amortization schedule, and payment
   tracking.
2. **Sticky notes / annotations** -- free-text comments attached to leads, visible in the
   lead detail drawer under a "Notes" card with a `StickyNote` icon.

The sidebar labels the finance section as "Finance" (not "Notes"), but the Money hub page
uses "Notes" as the default tab label. The lead detail drawer shows a "Notes" card. The
pricing page lists "Notes" as a limit ("2 free, 25 starter, 50 pro"). A user seeing "Notes:
2" on their plan would reasonably wonder whether that means they can only write two
annotations on their leads.

Land investors universally use "notes" to mean promissory notes. The annotation feature
should use "Comments," "Memos," or "Activity notes" to avoid confusion.

### F22-04 -- Pipeline page embeds full sub-pages instead of providing a unified view (P1)

**Files:** `client/src/pages/pipeline.tsx` (lines 24-27)

The Pipeline page is conceptually the "command center" for the deal workflow. However, it
implements its tabs by lazy-loading and rendering the entire `LeadsPage`, `PropertiesPage`,
`DealsPage`, and `CampaignsPage` components inside tab panels:

```typescript
const LeadsPage = lazy(() => import("@/pages/leads"));
const PropertiesPage = lazy(() => import("@/pages/properties"));
const CampaignsPage = lazy(() => import("@/pages/campaigns"));
```

Each of these sub-pages has its own header, its own title ("Leads CRM," "Finance,"
"Marketing Hub"), its own filter bars, and its own pagination state. The result is a
page-within-a-page that doubles the visual chrome, creates inconsistent headers (the
Pipeline page title sits above the sub-page title), and forces each tab to load its own
data independently.

A land investor thinks of their pipeline as one continuous flow. The current implementation
presents it as four separate applications glued together with tabs, which fragments the
mental model rather than unifying it.

### F22-05 -- Settings page has 15 tabs with no grouping or search (P2)

**Files:** `client/src/pages/settings.tsx` (lines 744-800)

The settings page presents 15 horizontal tabs: General, Team, Payments, Communications,
Notifications, AI, Data, Appearance, Integrations, Developer, Goals, Security, Referral,
Automations, AI Tasks. On desktop, these tabs overflow horizontally requiring scrolling.
On mobile, this would be extremely difficult to navigate.

There is no grouping into categories (e.g., "Account," "Business," "Advanced"), no search
within settings, and no visual hierarchy to help users find what they need. A land investor
who wants to set up their Stripe payment processing must scan all 15 tabs to find
"Payments." One who wants to configure their mailing address for direct mail must
distinguish between "Communications" and "Integrations" (the answer is neither -- it is
under a separate `/mail-settings` page).

### F22-06 -- Campaigns page renders its own sidebar, creating dual-sidebar confusion (P2)

**Files:** `client/src/pages/campaigns.tsx` (lines 51-81)

The Campaigns page (`MarketingHub`) renders its own `<Sidebar>` component from `shadcn/ui`
with a "Marketing Hub" header and a single "Dashboard" navigation link. This inner sidebar
appears alongside the application's main sidebar, creating a dual-sidebar layout. The inner
sidebar adds no navigational value (it contains one link that goes to `/`, the home page)
but consumes horizontal space and visually implies the user has entered a separate
application.

Land investors do not think of campaign creation as leaving their main workspace. The
secondary sidebar creates a jarring context shift that does not match the mental model of
"I want to mail these leads."

### F22-07 -- Onboarding wizard ends without guiding the user to their first action (P2)

**Files:** `client/src/components/onboarding-wizard.tsx` (lines 138-181)

The onboarding wizard has a well-designed 6-step flow (Welcome, First Steps, Add Property,
Connect Integrations, Create Campaign, Complete) with role-specific recommendations. Step 1
("Your First Steps") shows 3 tailored action cards based on business type (e.g., "Import
Leads," "Set Up Campaign," "Configure Deal Criteria" for land flippers).

However, these action cards link to deep pages (`/leads?action=import`, `/campaigns`,
`/settings?tab=deal-criteria`) while the user is still inside a modal dialog. If the user
clicks one of these links, they navigate away from the wizard. If they complete the wizard
without clicking, they land on the Today page with no persistent reminder of the
recommended first steps. The "complete" step (step 5) shows a celebration animation but
no "Start with X" call-to-action.

The Today page does show AI-generated priorities, but these are generic ("Score your
leads," "Launch a campaign") rather than personalized to the business type selected during
onboarding.

### F22-08 -- "Betty-style" scoring label is unexplained jargon (P2)

**Files:** `client/src/pages/leads.tsx` (line 259)

The score details dialog describes its methodology as "Betty-style lead scoring breakdown."
The name "Betty" appears nowhere else in the user-facing UI and is not defined. Land
investors familiar with the Podolsky method (referenced correctly in the Blind Offer
Wizard) will not recognize "Betty" as a scoring methodology. The dialog also uses factor
names like `ownershipDuration`, `taxDelinquency`, `absenteeOwner` in camelCase, converted
to display via a regex (`key.replace(/([A-Z])/g, ' $1').trim()`), producing labels like
"ownership Duration" and "tax Delinquency" with inconsistent capitalization.

### F22-09 -- Blind Offer Wizard is buried under leads submenu (P2)

**Files:** `client/src/components/layout-sidebar.tsx` (line 290), `client/src/pages/blind-offer-wizard.tsx`

The Blind Offer Wizard -- a flagship feature that implements the Podolsky formula for
calculating land offers -- is nested as a child item under "Leads" in the sidebar. In the
mental model of a land investor, blind offers are a deal-making activity, not a lead
management activity. A user thinking "I want to calculate an offer on this county" would
look under Deals, Intelligence, or Tools -- not under Leads.

Additionally, there is no contextual entry point. A user viewing a lead with property
details cannot launch the Blind Offer Wizard pre-populated with that lead's county and
acreage. The wizard always starts from a blank state.

### F22-10 -- "Money" vs. "Finance" vs. "Notes" vs. "Portfolio" naming collision (P2)

**Files:** `client/src/components/layout-sidebar.tsx` (lines 366-378), `client/src/pages/money.tsx`, `client/src/pages/finance.tsx`, `client/src/pages/portfolio.tsx`

The financial section of the application uses four different names depending on context:

| Context | Label | URL |
|---------|-------|-----|
| Sidebar | Finance | `/finance` |
| Top-level page | Money | `/money` |
| Money tab 1 | Notes | `#notes` |
| Money tab 2 | Finance | `#finance` |
| Money tab 3 | Portfolio | `#portfolio` |
| Sidebar child | Cash Flow | `/cash-flow` |
| Sidebar child | Portfolio | `/portfolio` |
| Sidebar child | Capital Mkts | `/capital-markets` |

The sidebar links to `/finance`, which renders the Finance page (promissory notes list).
The route `/money` renders the Money hub, which embeds the Finance page as its first tab.
The Money hub also has a "Finance" tab distinct from the "Notes" tab, but both relate to
the same underlying data. A user clicking "Finance" in the sidebar sees a different view
than clicking "Finance" inside the Money page.

This naming collision means users cannot form a stable mental model of where their
financial data lives.

### F22-11 -- Lead form status options do not include pipeline-relevant stages (P2)

**Files:** `client/src/pages/leads.tsx` (lines 2097-2103)

The lead creation and edit form offers five status choices: `new`, `contacting`,
`negotiation`, `closed`, `dead`. The pipeline funnel (F22-02) recognizes statuses like
`mailed`, `responded`, `interested`, `qualified`. A user who has mailed a lead and received
a response has no way to record that progression using the form's status dropdown. They
must choose between "contacting" (too vague) or "negotiation" (too advanced). The
disconnect between what the form allows and what the pipeline displays means leads will
appear stuck in incorrect funnel stages.

### F22-12 -- Today page requires 7+ API calls with no progressive disclosure (P2)

**Files:** `client/src/pages/today.tsx` (lines 175-308)

The Today page fires at least 9 parallel API queries on mount: dashboard stats, leads,
properties, tasks, system alerts, active goals, dashboard intelligence, pax insights,
pax suggestions, all deals, all notes, agent activity, pending approvals, autonomy score,
and today priorities. This creates a loading waterfall where the page renders skeleton
states or spinners across multiple sections simultaneously.

More critically, the page attempts to show everything at once: stat cards, priorities,
tasks, AI suggestions, agent activity, goals, alerts, pipeline summary, and cash position.
There is no progressive disclosure -- a new user with zero data sees a wall of empty
sections, while an active user sees an overwhelming amount of information with no clear
hierarchy of what demands attention first.

### F22-13 -- Deal creation requires a pre-existing property record (P2)

**Files:** `client/src/pages/deals.tsx` (lines 1838-1862)

The deal creation form requires selecting a property from a dropdown of existing property
records. A land investor who receives a call from a motivated seller and wants to quickly
log a potential deal must first navigate to Properties, create the property record, then
navigate back to Deals to create the deal. There is no inline "create property" option
within the deal form and no way to create a deal without a property reference.

This friction point on the critical path means users are likely to skip deal creation
entirely and track negotiations informally (spreadsheet, notebook) until a deal is far
enough along to justify creating both records.

### F22-14 -- Campaign page title says "Marketing Hub" but sidebar says "Campaigns" (P3)

**Files:** `client/src/pages/campaigns.tsx` (line 88), `client/src/components/layout-sidebar.tsx` (line 321)

The sidebar navigation item reads "Campaigns." Clicking it loads a page with the title
"Marketing Hub" and a secondary sidebar branded "Marketing Hub." The tab within that page
is also labeled "Campaigns." A user navigating via the sidebar expects to arrive at a page
called "Campaigns," not "Marketing Hub." This mismatch between the navigation label and
the page title undermines wayfinding confidence.

### F22-15 -- "Pax," "AI Hub," "Intelligence," and "Command Center" fragment the AI concept (P2)

**Files:** `client/src/components/layout-sidebar.tsx` (lines 341-363), `client/src/pages/pax.tsx`, `client/src/pages/command-center.tsx`, `client/src/pages/agent-command-center.tsx`

The AI capabilities are distributed across multiple navigation entries and pages:

- **AI Hub** (sidebar) -> loads `/ai` -> renders `PaxPage` with tabs: Insights, Chat, Activity, Agents, Automation
- **Intelligence** (sidebar) -> loads `/analytics` -> child items: Insights, Cohort Retention, AVM, Land Credit, Markets, Counties, Acq. Radar, Doc Intel, Compliance
- **Command Center** (`/command-center`) -> embedded inside AI Hub's "Chat" tab
- **Agent Command Center** (`/agent-command-center`) -> separate page, accessible from AI Hub's "Agents" tab

A land investor who wants to "ask the AI something" must choose between AI Hub, Intelligence,
or the Pax Copilot Rail (a persistent side panel). The distinction between "AI Hub" (agent
operations) and "Intelligence" (data analytics) is an engineering-centric categorization,
not a user-centric one. From the user's perspective, both are "the AI helping me make
decisions." The name "Pax" for the AI assistant is used inconsistently -- sometimes "Pax,"
sometimes "AI Hub," sometimes just the chat interface.

### F22-16 -- Borrower Portal URL structure exposes implementation detail (P3)

**Files:** `client/src/App.tsx` (lines 321-322)

The borrower portal is accessed via `/portal` or `/portal/:accessToken`. Sharing a URL
like `https://acreos.io/portal/abc123-token-value` with a borrower exposes the access
token directly in the URL bar. While functional, this creates a poor impression for
borrowers (who may be uncomfortable with a visible token) and means the token appears in
browser history, bookmarks, and potentially analytics tools.

### F22-17 -- Score breakdown factors use camelCase developer labels (P3)

**Files:** `client/src/pages/leads.tsx` (lines 196-199, 227-228)

The score detail dialog groups factors into categories: Property Factors, Owner Factors,
Market/Location, and Engagement. Individual factor names are rendered via a regex that
splits camelCase: `ownershipDuration` becomes "ownership Duration", `taxDelinquency`
becomes "tax Delinquency", `absenteeOwner` becomes "absentee Owner". The inconsistent
capitalization and developer-oriented naming (e.g., "responseRecency" rather than "Recent
Response") make the scoring feel unpolished and reduce trust in the scoring system.

### F22-18 -- No contextual help or explanation for financial terms in the Note form (P3)

**Files:** `client/src/pages/finance.tsx` (lines 1362-1435)

The promissory note creation form asks for "Principal ($)," "Interest Rate (%)," "Term
(months)," "Grace Period Days," "Service Fee," and "Late Fee" with no tooltips, helper
text, or contextual explanation. While experienced note investors understand these terms,
the application targets users across seven business types (including beginners like
"Residential Wholesaler" and "Fix & Flip"). A user creating their first seller-financed
note would benefit from inline guidance explaining what typical values look like and what
the implications of their choices are. The auto-calculated monthly payment is shown but
not labeled as being calculated from the inputs above it.

### F22-19 -- Lead table row actions require 3+ clicks to reach useful operations (P3)

**Files:** `client/src/pages/leads.tsx` (lines 1500-1600 approximate)

Each lead row in the table has a vertical ellipsis menu (`MoreVertical` icon) that opens
a dropdown with actions. To perform an action like "Rescore Lead" or "Generate Offer
Letter," the user must: (1) find the lead row, (2) click the ellipsis, (3) click the
action. For the most common operation (viewing lead details), the user clicks the row
itself, which opens a drawer. But for the second most common operation (editing a lead),
they must click the ellipsis, then "Edit." Since the row click is consumed by the detail
drawer, there is no keyboard shortcut or quick-action pattern for editing.

---

## Recommendations (not implemented -- documentation only)

1. **Add "Create Deal from Lead" button** to the lead detail drawer, pre-populating the
   deal form with the lead's property information and maintaining the lead reference.

2. **Unify lead status taxonomy** into a single linear progression: New -> Contacted ->
   Interested -> Qualified -> Negotiating -> Offer Sent -> Accepted -> Closed / Dead.
   Remove the separate "nurturing stage" concept or make it a computed display based on
   the single status field.

3. **Rename lead annotations** from "Notes" to "Comments" or "Memos" throughout the UI
   to eliminate collision with promissory notes.

4. **Replace Pipeline tab embedding** with a purpose-built pipeline view showing a compact
   summary of leads, properties, and deals in a single unified interface rather than
   rendering full standalone pages inside tabs.

5. **Group settings tabs** into 3-4 categories (Account, Business, Integrations, Advanced)
   with a left-rail navigation pattern instead of 15 horizontal tabs.

6. **Remove the Campaigns page inner sidebar** and render it as a standard PageShell page
   consistent with the rest of the application.

7. **Add post-onboarding persistent checklist** to the Today page that reflects the
   role-specific first steps from the wizard until each is completed.

8. **Consolidate AI entry points** into a single "AI" or "Pax" section with clear
   sub-navigation, rather than splitting across AI Hub, Intelligence, Command Center,
   and the copilot rail.

9. **Allow inline property creation** from the deal form to eliminate the mandatory detour.

10. **Add human-readable factor labels** to the scoring system with a display name mapping
    rather than relying on camelCase-splitting regex.
