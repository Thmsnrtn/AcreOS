# Mental Model Simulation: Pebble User in AcreOS

**Date:** 2026-04-18
**Source competitor:** Pebble (pebblerei.com)
**AcreOS navigation snapshot:** Sidebar nav modules from `client/src/components/layout-sidebar.tsx`

---

## Pebble Mental Model Summary

Pebble users think in a linear deal lifecycle: **Property -> Campaign -> Communication -> Deal -> Close**. Their primary data unit is the "property record" (a parcel). Campaigns are direct mail first, with SMS/email secondary. The "Deal Board" is a visual Kanban. Every action ties back to a property record, not a "lead" in the CRM sense. The unified inbox is central -- all replies surface there. Auto Followups are branded sequences combining mail + text + email.

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

## Workflow 1: "Create a Campaign" (direct mail to property list)

### What the Pebble user expects
Click a top-level "Campaigns" or "Marketing" item. Upload or select a property list. Choose a mail piece template (neutral letter, blind offer letter). Set the target list. Hit send. Pebble's entire campaign concept starts with "which properties do I want to mail?"

### Where they look in AcreOS
1. **Campaigns** (sidebar) -- correct first instinct. They click it.
2. They land on the Marketing Hub with tabs: Campaigns, A/B Tests, Sequences.
3. The "Campaigns" tab loads `CampaignsContent`, which supports campaign types: `direct_mail`, `email`, `sms`. Direct mail is present with letter templates including "Neutral Letter," "Blind Offer Letter," and "Follow-Up Mailer."

### Do they find it?
**Yes, but with friction.** The campaign creation flow exists and includes direct mail as a channel type. However:
- Pebble users start from a property list, then create a campaign targeting that list. AcreOS campaigns are lead-centric (targeting leads, not property records). The user must first import properties as leads, then create a campaign against those leads. This is a conceptual inversion.
- The Pebble "Campaign Import" workflow (bulk upload CSV of parcels directly into a campaign) does not exist as a single action in AcreOS. The user must: (1) go to Leads, (2) Import CSV, (3) go to Campaigns, (4) create campaign targeting those leads.
- Direct mail requires Lob API key configuration in Settings. In Pebble, direct mail works out of the box on the free tier.

### Time to completion
**3-5 minutes** if they understand the lead-first model. **10+ minutes** if they try to start from Properties (which is for owned/evaluated parcels, not marketing targets).

### Mental Model Mismatch: **MODERATE**

The mismatch is structural: Pebble treats "property record" as the atomic unit that flows into campaigns. AcreOS separates "leads" (people/contacts) from "properties" (parcels you own or evaluate). A Pebble user importing 2,000 parcels to mail would naturally go to Properties, not Leads. The Properties section in AcreOS is for portfolio tracking, not marketing lists.

---

## Workflow 2: "Add Properties" (import a list of parcels)

### What the Pebble user expects
Click "Properties" or "Property Records." See an "Import" or "Upload CSV" button. Upload a CSV of parcels with APN, county, owner name, address. The records appear as property records ready to be used in campaigns.

### Where they look in AcreOS
1. **Properties** (sidebar) -- first instinct. This seems right.
2. They land on the Properties page. But this page is for "properties you own or evaluate" -- it is a portfolio tracker, not a marketing list manager.
3. There is no CSV import on the Properties page for bulk parcel upload.
4. The actual import capability is on the **Leads** page, which has "Import CSV" and "Import Tax List" (TaxDelinquentImporter) buttons.

### Do they find it?
**Not where they expect it.** The Pebble user's "property record" maps to an AcreOS "lead," not an AcreOS "property." They would need to:
1. Navigate to Leads (not Properties).
2. Click "Import CSV" or "Import Tax List."
3. Upload their parcel list, which creates lead records (not property records).

If they start at Properties, they hit a dead end for bulk import. They may try Settings > Data Export (wrong direction). Eventually they may find the Leads import, but the label mismatch ("I have properties, not leads") creates confusion.

### Time to completion
**5-10 minutes** due to navigating to the wrong section first. A Pebble user unfamiliar with lead-centric CRM terminology could spend significant time looking for "property import" in the Properties section.

### Mental Model Mismatch: **SEVERE**

This is the fundamental vocabulary collision. Pebble's "property record" = AcreOS's "lead." Pebble's concept of "property" is any parcel you might want to acquire. AcreOS's "property" is something you already own or are actively evaluating. The user must mentally remap their entire data model.

---

## Workflow 3: "Track a Deal" (move property through deal pipeline)

### What the Pebble user expects
Click "Deals" or "Deal Board." See a Kanban board with drag-and-drop columns: Lead -> Negotiation -> Due Diligence -> Under Contract -> Closed. Click a card to see property details, notes, tasks, documents.

### Where they look in AcreOS
1. **Deals** (sidebar) -> **Deal Pipeline** -- correct first instinct.
2. They land on a Kanban board with stages: Lead, Negotiation, Due Diligence, Under Contract, Closed, Cancelled.
3. Cards are draggable between stages. Each deal card shows property info, value, days-in-stage, and health indicators.
4. Deal detail view includes checklist/stage gates, negotiation tools, AI analysis.

### Do they find it?
**Yes.** This is a near-perfect match. AcreOS's Deal Pipeline is functionally equivalent to Pebble's Deal Board. The stages map closely. Drag-and-drop works. Stage gates (checklist items required before advancing) are actually more sophisticated than Pebble's implementation.

### Time to completion
**Under 30 seconds.** Direct nav hit with familiar UX.

### Mental Model Mismatch: **NONE**

The Kanban deal pipeline is universal CRM vocabulary. Both platforms use identical metaphors.

---

## Workflow 4: "Send Mailers" (physical mail via Lob/PostGrid)

### What the Pebble user expects
From within a campaign or from a property record, click "Send Mail." Choose a template. Preview the letter (ideally with satellite imagery of the parcel). Confirm and send. Track delivery status.

### Where they look in AcreOS
1. **Campaigns** -> create a `direct_mail` campaign. Templates exist (Neutral Letter, Blind Offer Letter, Follow-Up Mailer).
2. Direct mail status is shown via `MailModeIndicator` -- test mode vs. live mode toggle.
3. There is also a standalone `direct-mail-campaigns` page (`/direct-mail-campaigns`) that is imported in `App.tsx` but **has no route** -- it is dead code. The user cannot reach it.
4. Mail configuration requires Lob API key in Settings. If not configured, the user sees "Direct Mail Not Configured -- Add your Lob API key in settings."

### Do they find it?
**Partially.** The campaign-level direct mail flow works, but:
- There is no per-lead "send a quick mailer" action visible from the lead detail view.
- Satellite imagery inclusion (a Pebble differentiator) does not appear to be a feature.
- The standalone Direct Mail Campaigns page exists in code but is unreachable -- a dead route.
- Test/live mode distinction is clear, but the Pebble user expects mail to "just work" without API key setup.
- Mail attribution tracking exists (`useMailAttribution`) which is a strong parity feature.

### Time to completion
**2-5 minutes** if Lob is already configured. **15+ minutes** if they need to configure the API key first, since they must navigate to Settings, find the mail/integration section, and enter credentials.

### Mental Model Mismatch: **MINOR**

The flow exists and is discoverable. The friction is operational (setup required) rather than conceptual. The main gap is that Pebble treats direct mail as a zero-config default; AcreOS treats it as an integration that must be activated.

---

## Workflow 5: "View Campaign Analytics" (response rates, cost per lead)

### What the Pebble user expects
From the campaign list or a dashboard, see: total sent, total responses, response rate, cost per response, cost per acquisition, ROI. Pebble shows this per-campaign and aggregated.

### Where they look in AcreOS
1. **Campaigns** -- they might look for analytics within the campaign detail view. The `CampaignAnalytics` component exists and shows: response rate, cost per response, cost per acquisition, open/click rates.
2. **Intelligence > Insights** -- the analytics page has KPI cards (Total Revenue, Active Notes Value, Deals in Pipeline, Lead Conversion Rate) plus campaign performance tables with sent/responses/responseRate/ROI per campaign.
3. **Intelligence > Attribution** -- attribution analytics for tracking which marketing channels produce results.

### Do they find it?
**Yes, across two locations.** Per-campaign analytics are inline with the campaign detail (via `CampaignAnalytics` component). Aggregate marketing analytics live under Intelligence > Insights, which requires a second navigation step.

The Pebble user might not immediately think to check "Intelligence" for campaign analytics -- the word "Intelligence" suggests market data or AI insights, not marketing performance. In Pebble, campaign analytics are co-located with the campaign itself.

### Time to completion
**1-2 minutes** for per-campaign metrics (found inline). **3-5 minutes** for aggregate cross-campaign analytics (must navigate to Intelligence > Insights and find the campaigns section).

### Mental Model Mismatch: **MINOR**

Per-campaign analytics are well-placed. The aggregate view under "Intelligence" is a slight label mismatch -- a Pebble user would look for "Campaign Analytics" or "Marketing Reports," not "Intelligence > Insights." But the data is there and reasonably discoverable.

---

## Summary Table

| # | Workflow | AcreOS Location | Found? | Time | Mismatch |
|---|---|---|---|---|---|
| 1 | Create a Campaign | Campaigns > Campaigns tab | Yes, with friction | 3-5 min | **MODERATE** |
| 2 | Add Properties (import parcels) | Leads > Import CSV | Wrong section first | 5-10 min | **SEVERE** |
| 3 | Track a Deal | Deals > Deal Pipeline | Yes | <30 sec | **NONE** |
| 4 | Send Mailers | Campaigns > direct_mail type | Partial | 2-15 min | **MINOR** |
| 5 | View Campaign Analytics | Campaigns (inline) + Intelligence > Insights | Yes, split | 1-5 min | **MINOR** |

---

## Key Recommendations

1. **Rename or alias "Leads" for property-first users.** The single biggest friction point is that Pebble users think in "property records," not "leads." Consider adding a "Property Records" or "Parcels" view that is functionally the same as Leads but uses property-centric vocabulary. Alternatively, add a prominent "Import Parcels" action to the Properties section that creates lead records under the hood.

2. **Surface CSV import more prominently.** The import flow is buried inside the Leads page behind a button. A Pebble user switching to AcreOS needs bulk import to be a first-class onboarding action, not a secondary toolbar button.

3. **Wire up the Direct Mail Campaigns page.** The `/direct-mail-campaigns` page exists in code but has no route in `App.tsx`. Either add the route or remove the dead code. A dedicated direct mail management view would match Pebble's mental model.

4. **Reduce direct mail setup friction.** Consider offering a managed Lob integration (AcreOS-provided API key with per-piece billing) so users do not need to bring their own Lob account. This matches Pebble's "unlimited direct mailing included" positioning.

5. **Add "Campaign Analytics" as an explicit nav item or tab.** Pebble users expect campaign performance data co-located with campaigns, not under a separate "Intelligence" section. Consider adding a "Performance" or "Analytics" tab within the Marketing Hub alongside Campaigns, A/B Tests, and Sequences.
