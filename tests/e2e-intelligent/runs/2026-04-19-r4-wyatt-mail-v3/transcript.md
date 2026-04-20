# E2E Intelligent Test Transcript — r4 Wyatt × Mail Campaign (v3)

- **Run ID**: 2026-04-19-r4-wyatt-mail-v3
- **Persona**: 09-land-academy-style (Wyatt Kessler)
- **Journey**: 02-mail-campaign-to-county
- **Date**: 2026-04-20
- **Steps**: 6
- **Canonical URL**: https://acreos.io

## Persona Summary

Wyatt Kessler, 29, Provo UT, 2 years investing, 18 deals. Land Academy graduate, active in mastermind. Current stack: DataTree + Excel + Click2Mail. Wants to replace the stack with one tool that lets him set his own pricing formula, pull county data, generate blind offers, and send at 500-2000/batch scale. Evangelist — tells 40 people if it works, tells 40 people if it doesn't.

## Journey Objective

Select a target county, build/import a mailing list, configure a direct mail campaign with his Land-Academy-style blind offer pricing, and launch it.

---

## Steps

### Step 1 — Sign in via ticket → /today

- **URL**: ticket → /today (auto-redirect ~9s)
- **In-character thought**: _"Okay, let's see what AcreOS's mail flow looks like. Straight to Campaigns."_

### Step 2 — Navigate to /campaigns

- **URL**: /campaigns
- **Observed**: Marketing Hub page with tabs (Campaigns, A/B Tests, Sequences). Top banner: "Low credit balance: $0.00 remaining. Add credits to continue using AI features, emails, and SMS." Stats row: Active Campaigns 0, Total Sent 0, Response Rate 0%, **Available Leads 0**. One draft campaign already exists: "Cochise Blind Offer Test 2026-04".
- **Structural finding**: STR-R4-001 HIGH — Available Leads counter shows 0 despite the org having 2 leads per /today dashboard ("Active Leads: 2"). The Campaigns surface and the Today dashboard disagree on lead count. Same disease as UX-001 in r1 (Portfolio counter), different location.
- **In-character thought**: _"Low credit balance warning before I've even done anything — fine, makes sense, no auto-charging. Interesting that someone pre-seeded a 'Cochise Blind Offer Test' draft. That's actually what I'd start with — Cochise is a legit target county. Zero Available Leads though? The dashboard just told me I had two. Already a trust issue."_

### Step 3 — Click the existing Cochise draft → JS error

- **URL**: /campaigns (draft clicked)
- **Action**: click on "Cochise Blind Offer Test 2026-04" card
- **Observed**: Page crashed. Body text: "Something went wrong / We encountered an unexpected error. Please try refreshing the page or go back to the home page. / **Error ID: err_1776686372260_azzj6l8f6** / **d?.filter is not a function** / Home / Retry / Refresh"
- **Structural finding**: STR-R4-002 CRITICAL — Clicking any existing campaign throws an unhandled TypeError ("d?.filter is not a function") and renders the global error boundary. The campaign detail page is unreachable through normal UI interaction. Minified variable name "d" suggests a prod build; the bug is likely a `.filter` called on `undefined` because an expected array (recipients? leads? segments?) arrived as undefined for this particular draft.
- **In-character thought**: _"Well. I clicked the campaign and the page crashed with 'd?.filter is not a function.' Error ID as consolation. This is the kind of thing I'd mention in the mastermind in the least flattering way possible."_

### Step 4 — Back to /campaigns, click New Campaign

- **URL**: /campaigns (reload) → dialog open
- **Action**: find and click "New Campaign" button via DOM evaluate (test instrumentation)
- **Observed**: "Create Campaign" modal opens with fields:
  - Campaign Name
  - Type: Direct Mail / Email / SMS (not configured)
  - Schedule
  - Template: Neutral Offer / Blind Offer / Follow-Up Mailer / Custom Message
  - Variables: `{{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}`
  - Subject, Content, Budget
  - Create Campaign button
  - Pricing footer: "Direct mail: $0.75–$1.45 per piece"
- **In-character thought**: _"Okay, the creation dialog has the right skeleton — Blind Offer is listed as a template, good. But let me look at the variables: {{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}. That's ... thin. Where's {{acreage}}? Where's {{assessedValue}}? Where's {{ownerType}}? In Land Academy you price the offer per-recipient based on formula inputs from the tax roll. If {{offerAmount}} is a single dollar amount I type into the template, every recipient gets the same offer — that's not blind-offer pricing, that's a marketing blast. Dealbreaker for my core workflow unless the list-attach step adds per-row fields."_
- **Workflow finding**: WF-R4-001 HIGH — Create Campaign dialog exposes only 6 merge variables ({{firstName, lastName, county, state, apn, offerAmount}}) with no {{acreage}}, {{assessedValue}}, {{landUse}}, {{lastSalePrice}}, or custom-formula support. Wyatt's Land-Academy-style per-recipient pricing formula cannot be expressed with these primitives.

### Step 5 — Look for list/recipient selection

- **URL**: /campaigns (Create Campaign dialog open)
- **Observed**: The dialog contains no visible "Upload list," "Select segment," or "Import CSV" control. It has Name / Type / Schedule / Template / Content / Budget. Recipient selection must happen outside this dialog.
- **Abandonment decision candidate**: Wyatt's journey requires going from "county selection" to "list attached to campaign." The Create Campaign dialog does not offer that inline. The pre-seeded Cochise draft might have had a list attached but is unreachable due to STR-R4-002.
- **In-character thought**: _"There's no list picker in this dialog. No 'Choose recipients' step. No 'Upload CSV.' So either (a) the list is attached somewhere I haven't found, or (b) I have to build the list first in /leads and then come back. Neither flow matches what O2O or DataTree does where list-and-offer are the same motion. Let me bail and take another look at the sidebar — maybe /direct-mail or /blind-offer-wizard is the real entry point."_

### Step 6 — Abandon (mostly): bail before full completion given context budget

- **URL**: /campaigns
- **Action**: `abandon: core flow blocked by STR-R4-002, secondary flow lacks per-recipient offer pricing`
- **Reasoning**: Wyatt would give this 90 seconds more and try `/direct-mail` and `/blind-offer-wizard` from the sidebar, each of which could be the real workflow. Due to this test session's context budget, those paths are deferred to the next session with a specific checklist below.
- **In-character thought**: _"Two minutes in and I'm batting one crash, one limited-variables dialog, one zero-leads counter that contradicts the dashboard. Campaign detail is a JS crash, new-campaign is template-only. There may be a blind-offer wizard that fixes all this, but my first-30-seconds experience is a rough one. I'm making a note to come back when these surfaces harden."_

### What was not yet examined (for next session)

- `/direct-mail` sidebar link — separate from Campaigns, likely the real per-recipient workflow
- `/blind-offer-wizard` sidebar link — possibly the Land-Academy-style per-APN formula flow
- CSV import from /leads — does the column mapping pick up acreage, assessed value, land-use fields?
- Lob API key configuration — Settings → Tools / Integrations

---

## Journey Verdict

- **Outcome**: **BLOCKED** (partial — two surfaces broken, others not yet reached)
- **Satisfaction**: 2/5
- **Would Recommend**: no
- **Reasoning**: The campaign detail page crashes on click (CRITICAL), the new-campaign dialog lacks the merge variables Wyatt's pricing formula requires (HIGH), and the lead-count number on /campaigns disagrees with the dashboard (HIGH — trust). A motivated evangelist persona like Wyatt survives one friction event but not three in sixty seconds. The `/direct-mail` and `/blind-offer-wizard` entry points (not reached this session) could potentially redeem the journey — flagged for next session.

### Top Issues

- Clicking any existing campaign throws "d?.filter is not a function" and renders the global error boundary, making campaign detail unreachable (STR-R4-002 CRITICAL).
- Create Campaign dialog's merge variables ({{firstName, lastName, county, state, apn, offerAmount}}) omit {{acreage}}, {{assessedValue}}, {{landUse}}, and provide no per-recipient formula affordance (WF-R4-001 HIGH). Land-Academy pricing cannot be expressed.
- Available Leads counter on /campaigns reports 0 while /today dashboard reports Active Leads 2 — same-data-different-numbers is a specific trust-eroder for a scaled-campaign persona (STR-R4-001 HIGH).
