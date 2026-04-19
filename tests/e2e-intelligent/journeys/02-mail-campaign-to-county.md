---
id: mail-campaign-to-county
name: Mail Campaign to County
title: Mail Campaign to County
goal: Select a target county, build or import a mailing list, configure a direct-mail campaign, and send it.
description: End-to-end direct mail campaign creation from county targeting through send.
start_url: /
max_steps: 150
timeout_minutes: 30
estimated_duration_minutes: 25
starting_state: Authenticated user with Lob API key configured in Settings, at least one lead list available.
success_criteria:
  - User identifies and selects a target county for the campaign
  - A mailing list is assembled from existing leads or a new CSV import
  - Mail template is selected or customized with correct merge fields
  - Campaign preview renders with accurate recipient count and merge-field values
  - Campaign transitions through draft to scheduled or sending state
  - Budget and daily send limits are configured and enforced
success_conditions:
  - Campaign created with status draft
  - Template preview renders merge fields correctly
  - Recipient count matches filtered list size
  - Campaign status advances to scheduled or sending
abandonment_criteria:
  - Campaign creation form requires Lob API key but Settings page has no clear path to configure it
  - Template merge-field preview shows raw mustache tags instead of resolved values
  - Recipient count shows zero despite selecting a populated list
  - Campaign submit button is disabled with no explanation of what is missing
  - Page crashes or shows unhandled error during template customization
common_failure_modes:
  - Lob API key invalid or expired causes campaign send to fail silently
  - Merge fields reference columns that do not exist in the selected list
  - Large recipient lists (1000+) cause the preview to time out
  - Budget validation allows $0 budget, creating a campaign that never sends
  - Campaign status gets stuck in "sending" if Lob webhook delivery fails
---

# Journey Context

Direct mail is the primary outbound marketing channel for land real estate professionals. This journey covers the full loop: picking a county to target, assembling the list of owners to mail, choosing a mail template, previewing the output, and launching the campaign.

The persona typically starts from the Campaigns section in the sidebar. They may already have a target county in mind — perhaps one they researched in the Counties or Markets intelligence pages — or they may be working from an imported lead list filtered to a specific county. The first decision is whether to build the list inside AcreOS (filtering existing leads by county, acreage, assessed value, and owner type) or to import a fresh CSV from an external source like the county assessor or PropStream.

If importing, the persona navigates to the import flow, uploads a CSV, maps the columns to AcreOS's canonical fields (APN, owner name, mailing address, acreage, assessed value), and waits for the import to complete. Duplicate detection should flag any records that already exist in the CRM. The persona reviews the import summary — total records, duplicates found, records added — and proceeds.

With a list ready, the persona creates a new campaign. They select the campaign type (direct mail), choose a template (yellow letter, postcard, professional letter, or blind offer), and customize the merge fields. The template editor should show a live preview with at least one sample record's data merged in, so the persona can verify that "Dear {{owner_first_name}}" becomes "Dear Robert" and not "Dear undefined."

Budget configuration is the next step. The persona sets a total budget or a daily send limit. For a typical campaign, they might send 200-500 letters per day over a week. The system should display the estimated total cost (number of recipients times cost per piece) and warn if the budget is insufficient to mail the entire list.

The persona reviews the campaign summary: recipient count, template preview, estimated cost, and schedule. They click "Launch" or "Schedule" and the campaign transitions to the sending state. The persona then monitors delivery status — processed, in transit, delivered, returned to sender — from the campaign detail page.

What "good" looks like: the persona creates a campaign from scratch in under 10 minutes, the merge-field preview is accurate and confidence-inspiring, the cost estimate matches expectations, and the campaign status updates reflect real progress. The persona never wonders "did it actually send?" — the UI provides clear confirmation and tracking.

Variations include: the persona discovers their Lob API key is not configured and needs to set it up in Settings first, the persona re-uses a template from a previous campaign, or the persona sends a test piece to their own address before launching to the full list.
