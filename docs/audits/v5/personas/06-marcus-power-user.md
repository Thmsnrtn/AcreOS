# Persona 06 — Marcus Chen, Power User

## Demographics
- **Name:** Marcus Chen
- **Age:** 38
- **Location:** Phoenix, Arizona
- **Role:** CEO / Founder, Desert Ridge Land Acquisitions LLC

## Background

Marcus started buying tax-delinquent parcels in Maricopa County at 27. Within five years he scaled from a solo operation to a team of five: two acquisitions managers, a due diligence analyst, a disposition manager, and an admin/bookkeeper. The company now holds 10,000+ parcels across Arizona, Nevada, New Mexico, Texas, Colorado, Utah, Oregon, and Florida. Annual revenue exceeds $4M. Marcus manages by exception — he does not look at individual parcels unless something is flagged.

Before land, Marcus spent six years as a database administrator at a logistics company. He is deeply technical: comfortable with SQL, spreadsheet macros, API integrations, and Zapier automations. He types 95 WPM and navigates every application keyboard-first. He will discover every keyboard shortcut the product offers within 30 minutes, and will be frustrated by any action that requires the mouse when a shortcut should exist.

## Current Situation

Marcus currently runs operations across a patchwork of Salesforce (CRM), Google Sheets (pipeline tracking), Airtable (due diligence checklists), and a custom Node.js script that scrapes county assessor sites. He pays $380/month for Salesforce alone. He is evaluating AcreOS as a single platform that could replace three of these four tools. His team will not migrate unless the product can handle their volume without degradation.

Marcus has a CSV export of 10,247 parcels ready to import on day one. His smallest filter query returns 800+ results. His largest bulk operation is "mark 3,000 parcels as mailed" in a single action. He does this weekly.

## Goal for Using AcreOS

Consolidate his entire land operation into one platform that handles:
1. Bulk import and management of 10,000+ parcels without performance degradation
2. Sub-second filtering and sorting across all fields
3. Bulk status updates, tag assignments, and export operations on 1,000+ selected records
4. Team-wide visibility into pipeline stages with real-time updates
5. API access or webhook support for his existing automation scripts

## Technical Comfort Level

**Expert.** Marcus will:
- Open browser DevTools within 5 minutes to check network request latency
- Notice if a table re-renders unnecessarily on scroll
- Identify N+1 query patterns from the loading waterfall
- Test every keyboard shortcut documented and undocumented
- Attempt to break pagination boundaries (page 0, page -1, page 99999)
- Try to select all 10,000 records and click "Export"

## Expectations Shaped by Other Products

| Product | Expectation Set |
|---------|----------------|
| **Salesforce** | List views with instant column sorting, saved filters, bulk actions on arbitrary selections, CSV export of any view, keyboard shortcuts for navigation |
| **HubSpot** | Clean UI that doesn't sacrifice power, inline editing, activity timeline per record, bulk enrollment in sequences |
| **Airtable** | Linked records, formula fields, grouped views, instant search across all fields |
| **Gmail** | Select-all-across-pages behavior, bulk archive, keyboard-driven workflow (j/k navigation, x to select, e to archive) |

Marcus expects AcreOS to match or exceed the speed and bulk-operation capability of these tools. He has no patience for "it works fine at small scale."

## Realistic Failure Modes

1. **Pagination collapse at scale.** Imports 10,000 parcels, opens the list view, and the table shows a spinner for 8+ seconds, renders only 25 rows, and "select all" only selects the visible page. He clicks "Export" expecting 10,000 rows and gets 25.
2. **Filter timeout.** Applies a compound filter (state = "AZ" AND status = "New" AND acreage > 5) and the query takes 4+ seconds. On Salesforce this takes 200ms.
3. **Bulk action failure without feedback.** Selects 2,000 parcels, clicks "Update Status," and the UI freezes. No progress indicator. No confirmation of how many succeeded. He refreshes and discovers 847 were updated and 1,153 were not, with no error log.
4. **Keyboard dead ends.** Tabs through the interface and discovers that the modal for creating a new parcel cannot be submitted with Enter, the dropdown menus cannot be navigated with arrow keys, and there is no shortcut to return to the list view.
5. **Import truncation.** Uploads his 10,247-row CSV and the system silently imports only 5,000 due to an undocumented row limit. No warning, no error. He discovers the gap three days later.
6. **Memory leak on long sessions.** Keeps AcreOS open in a pinned tab for 8 hours. By afternoon, the tab is consuming 2GB of RAM and every click has a 500ms delay.

## What Would Make Him Abandon

Marcus will close the tab and never return if:

- **The product cannot handle his data volume.** If importing 10,000 parcels fails, times out, or visibly degrades the UI, he is done. He will not "try with fewer records."
- **Bulk operations are fake.** If "select all" only selects the current page, or bulk status update silently caps at 100 records, he will call it a toy and go back to Salesforce.
- **There is no export.** If he cannot get a full CSV export of his filtered view within 10 seconds, the product is a roach motel and he will not put his data in it.
- **Performance is perceptibly slower than Salesforce.** He is paying $380/month for Salesforce. AcreOS needs to be faster, not slower, to justify migration risk.

## Signature Quote

> "If it can't handle 10,000 parcels without choking, it's a weekend project, not a product."
