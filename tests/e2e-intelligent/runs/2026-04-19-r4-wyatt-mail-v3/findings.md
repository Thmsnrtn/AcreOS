# Findings Report — r4 Wyatt × Mail Campaign

- **Run ID**: 2026-04-19-r4-wyatt-mail-v3
- **Persona**: 09-land-academy-style (Wyatt Kessler)
- **Journey**: 02-mail-campaign-to-county
- **Total Findings**: 3

## CRITICAL

### STR-R4-002: Campaign detail page crashes with "d?.filter is not a function"

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 3
- **URL**: https://acreos.io/campaigns (after click on draft campaign card)
- **Description**: Clicking any existing campaign card (in this test org, the pre-seeded "Cochise Blind Offer Test 2026-04" draft) crashes the route with an unhandled TypeError. The global error boundary renders "Something went wrong / d?.filter is not a function / Error ID: err_1776686372260_azzj6l8f6".
- **Evidence**: DOM innerText captured: `"Something went wrong\n\nWe encountered an unexpected error. Please try refreshing the page or go back to the home page.\n\nError ID: err_1776686372260_azzj6l8f6\n\nd?.filter is not a function\nHome\nRetry\nRefresh"`. Minified "d" is likely an array-typed field from the campaign API response that arrived undefined.
- **Persona Impact**: The only reachable campaign in this test org becomes unclickable. A user with existing draft campaigns has no way to resume work on them.
- **Recommended Action**: Find the `.filter` callsite on the campaign detail page. Common culprit patterns: `campaign.recipients?.filter`, `campaign.segments.filter`, `campaign.mailPieces.filter`. Default these to `[]` when undefined. Add a guard / loading skeleton around the detail view so a partially loaded campaign doesn't explode. Browse the server response for this specific campaign ID to confirm which field is null.

## HIGH

### WF-R4-001: Create Campaign dialog lacks per-recipient merge variables

- **Severity**: HIGH
- **Category**: workflow
- **Step**: 4
- **URL**: https://acreos.io/campaigns (Create Campaign modal)
- **Description**: The Create Campaign modal's variable list is `{{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}`. Land-Academy-style blind-offer campaigns compute an offer price per-recipient from assessor fields: `offer = formula(acreage, assessedValue, lastSalePrice, landUseCode)`. Without {{acreage}}, {{assessedValue}}, etc., a single global {{offerAmount}} is the only option, forcing either a flat offer to every recipient (not a blind offer in the traditional sense) or a separate offer-generation step outside the campaign dialog.
- **Evidence**: Exact variable list captured from the dialog: `Variables: {{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}`.
- **Persona Impact**: Wyatt's core competitive moat (his specific pricing formula) cannot be expressed in this dialog. Falling back to a flat offer eliminates the dominant signal (price personalized by land characteristics) that drives Land-Academy response rates.
- **Recommended Action**: Either (a) add a list-attach step that binds the campaign to a recipient list and exposes every column on the list as a merge variable, or (b) add first-class variables for `{{acreage}}`, `{{assessedValue}}`, `{{lastSalePrice}}`, `{{landUseCode}}`, plus a formula-column affordance where a user can define `{{offerAmount}} = 0.25 * {{assessedValue}}` and have it computed per-row at send time.

### STR-R4-001: Available Leads counter disagrees with Today dashboard

- **Severity**: HIGH
- **Category**: structural
- **Step**: 2
- **URL**: https://acreos.io/campaigns
- **Description**: The /campaigns stats row shows "Available Leads: 0" while /today shows "Active Leads: 2". Two surfaces quoting different counts for the same underlying entity in the same org.
- **Evidence**: DOM text on /campaigns: `"Available Leads\n\n0"`. DOM text on /today (from r1): `"Active Leads 2 1 new"`.
- **Persona Impact**: A persona that benchmarks data density (Wyatt explicitly does — he calls data coverage a dealbreaker for his target counties) treats a disagreement in lead count as grounds to suspect data integrity across the platform.
- **Recommended Action**: Align the /campaigns stat definition with /today. If "Available Leads" has a specific meaning (e.g., leads eligible for a direct mail send, excluding do-not-contact or already-mailed), label it explicitly and explain the filter. Otherwise count the same thing.
