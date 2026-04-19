# Mental Model Simulation: REsimpli User in AcreOS

**Date:** 2026-04-18
**Source competitor:** REsimpli (resimpli.com)
**AcreOS navigation snapshot:** Sidebar nav modules from `client/src/components/layout-sidebar.tsx`

---

## REsimpli Mental Model Summary

REsimpli users think in an all-in-one CRM model: **List Build -> Skip Trace -> Drip Campaign -> Deal Pipeline -> Accounting -> KPI Dashboard**. Their mental model is lead-centric (contact records, not parcels). They expect skip tracing to be a one-click action on any lead. Drip campaigns are multi-channel sequences (SMS + email + RVM + direct mail + task reminders) configured visually. KPI dashboards show marketing spend vs. deal count and cost-per-lead. AI features are branded agents with specific names: VoiceFollow AI, CallAnswer AI, Conversational AI. These are autonomous voice/SMS agents, not chat assistants.

---

## AcreOS Navigation Structure (for reference)

| Nav Group | Items |
|---|---|
| **Dashboard** | Overview |
| **Leads** | All Leads, Blind Offer Wizard |
| **Properties** | Properties, Maps, Documents |
| **Deals** | Deal Pipeline, Marketplace, Listings |
| **Campaigns** | Campaigns, Sequences |
| **Inbox** | Messages and communications |
| **AI Hub** | AI assistant, agents, automation |
| **Intelligence** | Insights, Cohort Retention, AVM, Land Credit, Markets, Counties, Acq. Radar, Doc Intel, Compliance |
| **Finance** | Finance, Cash Flow, Portfolio, Capital Mkts |
| **Settings** | Settings, Tools, Data Export, Help & Support |

---

## Workflow 1: "Add a Lead" (inbound lead from marketing)

### What the REsimpli user expects
Click "Leads" or a prominent "+" button. Fill in contact info (name, phone, email, property address). The lead is immediately created and can be assigned to a drip campaign, skip traced, or moved into the pipeline. REsimpli also has "Speed to Lead" -- an AI that auto-calls new leads within 15 seconds of form submission.

### Where they look in AcreOS
1. **Leads** (sidebar) -> **All Leads** -- correct first instinct.
2. They see an "Add Lead" button (`button-add-lead`). Clicking opens a create form powered by `insertLeadSchema` with fields for name, contact info, status, etc.
3. The lead is created and appears in the list with status, contact details, and action buttons.

### Do they find it?
**Yes.** This is a direct match. AcreOS's lead creation flow is standard CRM functionality. The form fields align with REsimpli's expectations. Leads can be created individually or bulk-imported via CSV.

The only gap: REsimpli's "Speed to Lead" (AI auto-calls within 15 seconds) has no equivalent. AcreOS's AI Hub (Pax) is a chat-based assistant, not an autonomous outbound caller. The REsimpli user may look for an "auto-call new leads" toggle and not find one.

### Time to completion
**Under 30 seconds.** Standard CRM add-lead flow.

### Mental Model Mismatch: **NONE**

Both platforms use "lead" as the primary data unit with identical semantics. The create flow is immediately recognizable.

---

## Workflow 2: "Skip Trace" a contact

### What the REsimpli user expects
On any lead record, click a "Skip Trace" button. The system looks up phone numbers, email addresses, and mailing addresses from the owner's name and property address. Results appear inline on the lead record. REsimpli includes free skip tracing (volume-capped per plan tier) -- no per-trace billing friction.

### Where they look in AcreOS
1. **Leads** -> open a specific lead record.
2. In the lead detail view, there is a `SkipTracePanel` component (imported and rendered at line 2350 of `leads.tsx`).
3. The panel allows running a skip trace on the selected lead, showing results (phones, emails, addresses, relatives, age range) with confidence scores.
4. Batch skip tracing also exists via the skip-tracing API (`/api/skip-tracing/batch`).

### Do they find it?
**Yes, but it is not as prominent as REsimpli's.** In REsimpli, skip tracing is a top-level action on every lead card -- you see a "Skip Trace" button in the lead list view. In AcreOS, the user must open the lead detail to access the SkipTracePanel. There is no bulk "skip trace all leads" button visible in the lead list toolbar.

Additionally:
- There is a standalone `/skip-tracing` page in the codebase (`pages/skip-tracing.tsx`) with batch trace capability, but **it has no route in App.tsx** -- it is unreachable dead code.
- There is no nav item for "Skip Tracing" in the sidebar.
- REsimpli includes free skip tracing bundled into the plan. AcreOS's skip tracing has a `costCents` field, suggesting per-trace billing.

### Time to completion
**1-2 minutes.** They find the lead, open it, and see the skip trace panel. But if they want to batch-trace 500 leads, they have no visible UI path to do so.

### Mental Model Mismatch: **MODERATE**

The feature exists but is buried. REsimpli treats skip tracing as a headline capability (free, prominent, batch-capable). AcreOS treats it as a detail-level action on individual leads. The REsimpli user expects to see "Skip Trace" as a bulk action in the lead list toolbar or as a standalone nav item. They would also expect no per-trace cost.

---

## Workflow 3: "Run a Drip Campaign" (automated follow-up sequence)

### What the REsimpli user expects
Navigate to "Drip Campaigns" or "Automation." Create a multi-step sequence: Day 1 SMS, Day 3 Email, Day 7 Ringless Voicemail, Day 14 Direct Mail, Day 21 Task Reminder. Assign leads to the sequence. The system executes the sequence automatically over time with no manual intervention. REsimpli's drip campaigns are multi-channel by default.

### Where they look in AcreOS
1. **Campaigns** (sidebar) -> they see "Campaigns" and "Sequences" as children.
2. Clicking **Sequences** redirects to `/campaigns#sequences` (the Sequences tab within the Marketing Hub).
3. The `SequencesContent` component provides the sequence builder.
4. The sequence builder (`sequence-builder.tsx`) exists with multi-step capability.

### Do they find it?
**Yes, with minor terminology friction.** REsimpli calls them "Drip Campaigns." AcreOS calls them "Sequences." The REsimpli user might first click "Campaigns" expecting to find drip campaigns there, and they would -- the Sequences tab is within the Campaigns/Marketing Hub.

Key differences:
- REsimpli's drip campaigns explicitly combine SMS + email + RVM + direct mail + task reminders in one visual sequence. AcreOS's sequence builder needs to be examined for whether it supports all these channel types in a single sequence.
- REsimpli's "Ringless Voicemail" (RVM) channel does not appear to exist in AcreOS.
- The "Sequences" label is familiar to email marketing users (Mailchimp, HubSpot) but REsimpli users specifically think "drip campaign."

### Time to completion
**1-2 minutes.** The Campaigns nav item is logical and Sequences is the second child. The redirect from `/sequences` to `/campaigns#sequences` works seamlessly.

### Mental Model Mismatch: **MINOR**

The concept maps cleanly. "Sequences" vs. "Drip Campaigns" is a label difference, not a structural one. The user finds the feature where expected. The gap is in channel breadth -- if AcreOS sequences lack RVM and direct mail as step types, the REsimpli user will feel the platform is less capable.

---

## Workflow 4: "Check my KPIs" (marketing spend vs deal count)

### What the REsimpli user expects
Click "KPIs" or "Dashboard." See a unified view of: cost per lead, cost per deal, marketing spend by channel, deal count by source, ROI by campaign, revenue vs. expense. REsimpli has a dedicated "KPI Dashboard" that rolls up financial data from deal-level tracking. There is also a "Leaderboard" for team performance.

### Where they look in AcreOS
1. **Dashboard** (top of sidebar) -- first instinct. They click the overview page.
2. The Dashboard may show high-level metrics but is not a dedicated KPI view.
3. **Intelligence > Insights** -- this is the analytics hub with tabs: Analytics, Team, Activity, Cohorts, Retention, Attribution.
4. The Analytics tab shows KPI cards: Total Revenue, Active Notes Value, Deals in Pipeline, Lead Conversion Rate. Campaign performance shows sent/responses/responseRate/ROI per campaign.
5. The **Team** tab shows team performance.
6. The **Attribution** tab shows which marketing channels produce results.
7. There is also a separate `/kpis` route and `/team-kpi` route in App.tsx, but **neither appears in the sidebar navigation**.

### Do they find it?
**Partially, with navigation friction.** The data exists but is scattered:
- Revenue and deal metrics are under Intelligence > Insights > Analytics tab.
- Team performance is under Intelligence > Insights > Team tab.
- Attribution (which channel produces deals) is under Intelligence > Insights > Attribution tab.
- There is no single "KPI Dashboard" that shows marketing spend vs. deal count on one screen the way REsimpli does.
- The "cost per lead" and "cost per deal" metrics are available in the campaign analytics component but require navigating to a specific campaign, not shown as aggregate KPIs.
- The `/kpis` page exists as a route but is not in the sidebar nav -- it is a hidden page.

### Time to completion
**3-7 minutes.** The REsimpli user must explore multiple tabs under Intelligence to assemble the picture that REsimpli shows on a single KPI Dashboard screen. They would not think to look under "Intelligence" for marketing KPIs -- that label suggests AI/market analysis, not operational performance metrics.

### Mental Model Mismatch: **MODERATE**

The data is present but the information architecture does not match. REsimpli's KPI Dashboard is a single, purpose-built screen. AcreOS distributes equivalent data across multiple tabs within "Intelligence" (a label that does not signal "operational KPIs" to a CRM user). The hidden `/kpis` route suggests this was identified as a need but not promoted to the nav. The REsimpli user expects "KPIs" or "Reports" as a top-level nav item.

---

## Workflow 5: "Use AI" (VoiceFollow, CallAnswer -- AI voice features)

### What the REsimpli user expects
Navigate to "AI" or "Agents." See three distinct, named AI agents:
- **VoiceFollow AI**: Automatically follows up with leads via outbound phone calls, schedules appointments, transfers calls to humans.
- **CallAnswer AI**: Answers inbound calls 24/7, gathers property details, schedules follow-ups, connects qualified leads.
- **Conversational AI**: Engages leads through two-way SMS conversations to qualify and nurture automatically.

Each agent has clear on/off controls, performance metrics, and call logs. These are autonomous agents that operate without human intervention.

### Where they look in AcreOS
1. **AI Hub** (sidebar) -- correct first instinct. They click it.
2. The AI Hub (`/ai`) loads the Pax page with tabs: Insights, Chat, Activity, Agents, Automation.
3. The **Chat** tab (default) is a conversational AI assistant (Pax) -- but this is a human-to-AI chat interface, not an autonomous agent that talks to leads.
4. The **Agents** tab loads `AgentCommandCenterPage` which may show AI agents.
5. The **Automation** tab loads an automation page.

### Do they find it?
**They find AI, but not the AI they expect.** The fundamental mismatch:
- REsimpli's AI agents are **outward-facing**: they call leads, answer phones, send SMS to prospects. They are customer-facing autonomous agents.
- AcreOS's AI (Pax) is **inward-facing**: it assists the user with analysis, insights, and operational tasks. It is an internal productivity tool, not a lead-engagement engine.

The REsimpli user would:
1. Click AI Hub, expecting to find "VoiceFollow" or equivalent outbound calling AI.
2. See Pax Chat -- a chat interface for asking questions about their business.
3. Check the Agents tab -- may find agent configurations, but these are likely operational agents (data enrichment, observation, analysis), not voice/SMS agents that interact with leads.
4. Find no equivalent to autonomous outbound calling, inbound call answering, or two-way SMS bots.

AcreOS does have phone-related features (`phone-numbers-settings`, `call-log`, `voice-analytics`) but these appear to be call tracking and analytics tools, not autonomous AI callers.

### Time to completion
**N/A -- feature does not exist in equivalent form.** The user finds the AI Hub quickly but discovers it solves a different problem. AcreOS's AI is an internal assistant; REsimpli's AI is an external sales agent.

### Mental Model Mismatch: **SEVERE**

This is a category-level mismatch. REsimpli markets AI as "agents that do your follow-up for you" -- autonomous outbound/inbound voice and SMS bots. AcreOS markets AI as "an intelligent assistant that helps you work smarter" -- an internal copilot. A REsimpli user evaluating AcreOS's "AI Hub" will feel the platform is missing what they consider the most valuable AI feature: autonomous lead engagement. The word "AI" means fundamentally different things in these two products.

---

## Summary Table

| # | Workflow | AcreOS Location | Found? | Time | Mismatch |
|---|---|---|---|---|---|
| 1 | Add a Lead | Leads > Add Lead button | Yes | <30 sec | **NONE** |
| 2 | Skip Trace | Leads > Lead Detail > SkipTracePanel | Yes, buried | 1-2 min | **MODERATE** |
| 3 | Run a Drip Campaign | Campaigns > Sequences tab | Yes | 1-2 min | **MINOR** |
| 4 | Check my KPIs | Intelligence > Insights (multiple tabs) | Scattered | 3-7 min | **MODERATE** |
| 5 | Use AI (voice agents) | AI Hub -- wrong type of AI | No equivalent | N/A | **SEVERE** |

---

## Key Recommendations

1. **Surface skip tracing as a bulk action.** Add a "Skip Trace Selected" button to the lead list toolbar alongside existing bulk actions (Export, Change Status, Delete). Wire up the existing `/skip-tracing` page (currently dead code with no route) or integrate its batch functionality into the leads list view. Consider bundling skip trace credits into plan tiers rather than per-trace billing.

2. **Create a unified KPI Dashboard.** The data for marketing spend vs. deal count exists across multiple analytics endpoints. Consolidate it into a single "KPIs" or "Performance" screen accessible from the sidebar. The hidden `/kpis` route should be promoted to a nav item, or the Intelligence section should be relabeled to make "Insights" feel more like an operational dashboard. Consider renaming "Intelligence" to "Reports" or "Analytics" -- terminology that CRM users universally understand.

3. **Clarify what "AI Hub" delivers.** REsimpli users will expect autonomous voice/SMS agents. If AcreOS does not plan to build outward-facing AI agents, the AI Hub positioning should be explicit about what it does (internal assistant, data analysis, observation) so users do not arrive with mismatched expectations. If autonomous lead engagement is on the roadmap, consider naming future agents distinctly (like REsimpli's VoiceFollow/CallAnswer branding) to make them discoverable and marketable.

4. **Verify sequence channel support.** Confirm that AcreOS's sequence builder supports all channel types REsimpli users expect: SMS, email, direct mail, and task reminders within a single sequence. If RVM (ringless voicemail) is not planned, document this as a known gap. Multi-channel sequences are a core REsimpli differentiator.

5. **Add "Skip Tracing" and "Direct Mail" to the sidebar or command palette.** Both features exist in AcreOS's codebase but are not discoverable from the main navigation. Pages exist at `/skip-tracing` and `/direct-mail-campaigns` but have no routes. Either wire them up as routable pages with nav items, or ensure they are findable via the command palette / search.

6. **Consider a "Marketing" top-level group.** REsimpli users think in terms of "marketing tools" -- skip tracing, list stacking, drip campaigns, direct mail, and KPIs are all part of their marketing workflow. AcreOS splits these across Leads (skip trace), Campaigns (drip/mail), and Intelligence (KPIs). A "Marketing" nav group that aggregates these would reduce cognitive load for users switching from REsimpli.
