# Persona Simulation: Sarah Okonkwo -- J1 Landing to First Parcel

| Field | Value |
|---|---|
| Persona | Sarah Okonkwo, 26, junior analyst at Lone Star Land Partners, Dallas TX |
| Device | Laptop 1280x720 |
| Browser | Chrome |
| Network | Fast |
| Session | Fresh (incognito) |
| Concurrency | Solo |
| Role | Evaluator / gatekeeper (not buyer, not end user) |
| Date | 2026-04-18 |

---

## Persona Context

Sarah is evaluating AcreOS on behalf of her VP, David, who saw it mentioned in a real estate professionals' forum. She has a 47-item requirements checklist across 6 categories: user management, data security, audit trails, reporting/export, integrations, and pricing transparency. She has two weeks to produce a 3-page written recommendation. The firm manages 1,200 active parcels and handles $2.5M in annual transactions with an 8-person team.

Sarah has already evaluated and rejected Salesforce (too expensive), Podio (insufficient audit trail), REI Pebble (poor data export), and a custom Airtable build (no proper access controls). She is methodical, documentation-oriented, and does not file support tickets during evaluations.

> "I can't recommend this to my VP without proper access controls and an audit trail. We handle real money."

---

## Step 0: Pre-Evaluation Setup

Sarah opens a Google Sheet with her 47-item requirements checklist. She will score AcreOS 1-5 on each item. Any "must-have" item scored below 3 is automatically disqualifying. Her must-have items include:

- Role-based access control (RBAC)
- Audit trail / change history
- Full data export (CSV, all fields)
- Multi-user concurrency (8 seats)
- Pricing transparency (no hidden fees)
- Data encryption (at rest and in transit)

She opens a new incognito Chrome window and navigates to `acreos.fly.dev`.

---

## Step 1: Landing Page Evaluation

**URL:** `https://acreos.fly.dev/`

### What Sarah Sees (1280x720 viewport)

**Nav bar:** Logo + "Pricing" + "Sign In" + "Get Started Free"

At 1280px, the nav renders cleanly. All elements fit comfortably.

**Hero section:**
- Badge: "Now in Public Beta"
- H1: "The operating system for real estate professionals"
- Subhead: "AcreOS replaces your spreadsheets, disconnected tools, and guesswork with a single platform that manages leads, automates outreach, and closes deals -- powered by AI."
- Strategy badges: Wholesaling, Fix & Flip, Buy & Hold, STR / Airbnb, Land, Multifamily, Commercial, Creative Finance, Notes
- CTAs: "Start Free" + "View Pricing"

**Social proof:** 18 Free data sources | $0 To get started | 14 Day free trial | 500+ Properties managed

**Features (6 cards, 2-column at 1280px):**
1. Portfolio Mapping
2. AI Valuations
3. AI Deal Intelligence
4. Document Generation
5. Campaign Automation
6. Compliance Built-In

**Pricing teaser:** Free $0, Starter $20/mo, Pro $49/mo, Scale $79/mo

**Final CTA:** "Ready to modernize your real estate business?"

**Footer:** (c) 2026 AcreOS | Pricing | Sign In

### Sarah's Reaction: Methodical Note-Taking

Sarah does not react emotionally. She opens her checklist and starts scoring.

**Item 1: Does the product clearly state what it does?**
"Yes -- 'manages leads, automates outreach, and closes deals.' Clear value prop for a CRM-type tool. But it also says 'AI-powered' which is vague. Score: 4/5."

**Item 2: Does the landing page mention user management or team features?**
"Scale tier says '10 seats.' Feature card mentions nothing about user management, roles, or permissions. No mention of admin controls, role-based access, or team hierarchy. Score: 2/5."

**Item 3: Does the landing page mention security or compliance?**
"'Compliance Built-In' card mentions 'TCPA consent tracking, DNC list checks, and audit trails for every communication.' This is communication compliance, not platform security compliance. No mention of SOC 2, data encryption, or security certifications. Score: 2/5."

**Item 4: Does the landing page mention data export?**
"No. Zero mention of export, data portability, or API access anywhere on the landing page. Score: 1/5."

> "The landing page is consumer-grade marketing. It tells me features but not capabilities. I need to know about access controls, audit trails, data export, and security -- none of which are mentioned. I have to sign up and check empirically."

**FRICTION EVENT F-01: Landing page silent on enterprise/team capabilities.**
The landing page doesn't mention RBAC, audit trails, data export, API access, or security certifications. For an evaluator with a 47-item enterprise checklist, the landing page provides almost no decision-useful information. Sarah is forced to sign up to evaluate features that should be marketed on the landing page.

---

## Step 2: Pricing Page Evaluation

**Action:** Sarah clicks "Pricing" or "View Pricing." URL: `/pricing`.

### What Sarah Sees

**Pricing header:** "Simple, transparent pricing" with Monthly/Annual toggle.

**Tier cards:** Free ($0), Starter ($20/mo), Pro ($49/mo), Scale ($79/mo).

**Feature comparison table (16 rows, 5 columns):**

Sarah reads the entire table, row by row, scoring against her checklist:

| Checklist Item | Feature Table Says | Sarah's Score |
|---|---|---|
| User seats | 1 / 1 / 2+$20/seat / 10+$40/seat | 3/5 -- 8 seats would require Scale ($79) + custom config. Pricing for seats 11+ unclear. |
| RBAC / Permissions | Not mentioned anywhere | 1/5 -- MUST-HAVE. Not listed = likely doesn't exist. |
| Audit trail | Not mentioned in pricing table | 1/5 -- MUST-HAVE. "Audit trails for every communication" in compliance card, but no general audit trail for data changes. |
| Data export | Not mentioned | 1/5 -- MUST-HAVE. |
| API access | Not mentioned | 1/5 -- Desirable but not must-have for initial eval. |
| Integrations | "Stripe Connect Payments," "Direct Mail Integration," "SMS/Voice Outreach" | 2/5 -- These are channel integrations, not platform integrations (no Zapier, no QuickBooks, no Slack). |
| Data encryption | Not mentioned | 0/5 -- Cannot score what isn't disclosed. |
| Pricing transparency | Mostly clear. Seat pricing disclosed. Credit system not explained. | 3/5 -- Need to check for hidden credit costs. |

**Critical finding:** The per-seat add-on pricing:
- Pro: 2 seats included, additional at $20/seat. For 8 users: $49 + (6 x $20) = $169/mo.
- Scale: 10 seats included, additional at $40/seat. For 8 users: $79/mo.

Scale is cheaper for an 8-person team. But wait -- if the 8-person team grows to 12, Scale becomes $79 + (2 x $40) = $159/mo. Why is the additional seat price HIGHER on Scale ($40) than Pro ($20)? That's counterintuitive.

> "The seat pricing doesn't make sense. Why does an additional seat cost $40 on the Scale plan but only $20 on Pro? If I'm on Scale with 10 seats and need 2 more, I pay $159. But if I'm on Pro with 2 seats and add 10 more at $20 each, I pay $249. So Scale is still cheaper for 12+ seats, but the per-seat premium on Scale feels punitive."

**FRICTION EVENT F-02: Per-seat pricing is counterintuitive.**
Scale tier charges $40/additional seat vs. Pro's $20/additional seat. While Scale includes more base seats (10 vs. 2), the higher marginal seat cost creates confusion for evaluators calculating total team cost.

**Enterprise pricing:** "Need custom enterprise pricing? Contact us." This is a mailto link to `hello@acreos.io`. Sarah notes this -- she may need to contact them if RBAC turns out to be an enterprise-only feature.

> "I've scored 4 must-have items and three of them are 1/5. If the product doesn't have RBAC, audit trails, and data export, I'm done. I need to sign up and verify empirically."

---

## Step 3: Sign Up for Trial

**Action:** Sarah clicks "Get Started" on the pricing page. URL: `/auth?mode=register`.

**What she sees:** Clerk SignUp widget on blank background. The `?mode=register` query parameter initializes in sign-up mode. **Known fix pending deploy** -- if the deployed version links to `/auth` without the parameter, Sarah sees Sign In first.

**Sarah's observation:** No branding on the auth page. No terms of service link. No privacy policy link. No mention of what data will be collected or how it will be stored.

> "No privacy policy link on the signup page. I need this for my security evaluation. Let me check the footer... also no privacy policy or terms of service link there. That's a gap."

**FRICTION EVENT F-03: No privacy policy or terms of service.**
The signup page and footer have no links to a privacy policy, terms of service, or data processing agreement. For an evaluator assessing the platform for a firm handling $2.5M in transactions, this is a compliance requirement, not a nice-to-have.

Sarah signs up with email/password. She uses a work email to test whether the platform restricts domains.

---

## Step 4: Post-Signup -- Evaluating Access Controls

**Action:** After signup and redirect (to `/onboarding-v2` or `/today` depending on deployment state), Sarah's first priority is finding access controls.

### Finding RBAC

Sarah navigates to Settings. She looks for:
- "Team" or "Members" section
- "Roles" or "Permissions" section
- "Invite User" with role assignment

**What she expects to find (from Salesforce experience):**
- Predefined roles: Admin, Manager, Analyst, Viewer
- Custom role creation with granular permissions
- Field-level security (e.g., hide financial data from certain roles)
- Record-level access controls

**What she actually finds:**
The Settings page likely has a "Team" or "Members" section where she can invite users. The invitation flow may or may not include role selection. Based on the pricing table showing "Team Seats" as a count without mentioning roles, Sarah suspects roles are limited or absent.

If there are only two roles (Owner/Admin and Member), Sarah scores RBAC as 2/5.
If there is only one role (everyone is equal), Sarah scores RBAC as 1/5 -- disqualifying.

> "If every team member has the same permissions, my acquisitions manager can see disposition financials, my bookkeeper can delete lead records, and my intern can export the entire database. That's not a configuration issue -- it's a design decision that says 'we didn't build this for teams.'"

### Finding Audit Trail

Sarah edits a test record (changes a property status, edits a note, updates a lead name). Then she looks for:
- A "History" or "Activity" tab on the record
- A "Last modified by" field with timestamp
- A global audit log in Settings

**What she expects (from Salesforce):**
- Field-level change tracking: "Status changed from 'New' to 'Active' by Sarah Okonkwo on 2026-04-18 at 14:32 CST"
- Setup > Audit Trail showing all admin changes
- Login history

**What she finds:**
The Today page references "system alerts" and "activity" but these are operational alerts (note overdue, stale leads), not a change audit trail. Individual records may or may not have a modification history.

If there is no per-record change history, Sarah scores audit trail as 1/5 -- disqualifying.

> "No audit trail means I can't answer the basic question: 'Who changed this deal amount from $15,000 to $1,500 and when?' For a firm that handles $2.5M annually, that's not acceptable."

### Finding Data Export

Sarah navigates to the properties list and looks for an export button. She checks:
- A "Download" or "Export" button on the list view toolbar
- A "Export to CSV" option in a dropdown menu
- An "Export" option in Settings

**What she needs:**
- Full CSV export with ALL fields (including custom fields and notes)
- Filtered export (export the current view, not just everything)
- Scheduled exports (weekly CSV to email -- nice to have)

**FRICTION EVENT F-04: Must-have capabilities require empirical testing.**
The pricing page and landing page don't mention RBAC, audit trails, or data export. Sarah has to sign up, create test data, and manually check for each feature. This adds 2-3 hours to her evaluation for features that should be disclosed upfront.

---

## Step 5: Evaluate Remaining Checklist Items

Sarah works through her remaining checklist items:

**Multi-user concurrency:** She needs to test whether two users can edit the same pipeline without overwriting each other. This requires inviting a second test user. She looks for an invite function.

**Data encryption:** She checks whether the site uses HTTPS (yes -- Fly.io serves HTTPS by default). For data at rest, she has no way to verify without asking the vendor. No security page, no SOC 2 badge, no encryption disclosure.

**Backup/recovery:** No mention of backup frequency, retention period, or point-in-time recovery. She adds "unknown" to her checklist.

**Data residency:** She checks the response headers for `server` or `x-fly-region`. Fly.io hosts on global edge infrastructure -- she doesn't know which region her data lives in. No data residency disclosure on the site.

> "I can't find information about data hosting, encryption at rest, backup policies, or compliance certifications. My VP will ask 'Where is our data?' and my answer will be 'I don't know.' That's not a recommendation."

**FRICTION EVENT F-05: No security or compliance documentation.**
No privacy policy, terms of service, security page, SOC 2 badge, data residency disclosure, or DPA. For an evaluator producing a recommendation memo for a firm managing $2.5M in transactions, this information is required, not optional.

---

## Step 6: Draft Preliminary Scoring

Sarah opens her Google Sheet and fills in scores for AcreOS:

| Category | Must-Have? | Score | Notes |
|---|---|---|---|
| Role-based access control | YES | 1-2/5 | Not visible on pricing/landing. Must verify empirically. If single-role, disqualifying. |
| Audit trail | YES | 1/5 | No mention anywhere. Communication audit exists but no data change history. |
| Full data export (CSV) | YES | 1/5 | Not mentioned on pricing or landing page. Must verify in product. |
| Multi-user support | YES | 3/5 | Seat counts are clear. Concurrency behavior unknown. |
| Pricing transparency | YES | 3/5 | Mostly clear. Per-seat add-on pricing is counterintuitive. Credit system unexplained. |
| Data encryption (in transit) | YES | 5/5 | HTTPS confirmed. |
| Data encryption (at rest) | YES | 0/5 | No information available. |
| Data residency | NO | 0/5 | No information available. |
| Integrations | NO | 2/5 | Channel integrations only (SMS, email, mail). No platform integrations (API, Zapier, QuickBooks). |
| API access | NO | 1/5 | Not offered. Internal API exists but is not documented or accessible. |

**Running total against disqualification criteria:** 3 must-have items at 1/5 (RBAC pending verification, audit trail, data export). If any of these are confirmed absent after in-product testing, AcreOS is automatically disqualified.

---

## Step 7: Final Landing-Page Assessment

### Final Verdict: PENDING -- Likely Disqualified, Needs In-Product Confirmation

Sarah has enough information from the landing page, pricing page, and initial product inspection to form a preliminary opinion: AcreOS is likely a disqualify for Lone Star Land Partners. Three must-have items (RBAC, audit trail, data export) are either absent or undisclosed.

However, Sarah is thorough. She will spend another 2-3 hours testing these features empirically before writing her final memo. If the product has hidden RBAC settings, an audit trail she hasn't found yet, or CSV export behind a button she missed, her score could change.

Her preliminary memo draft:

> "AcreOS is a well-designed CRM/operations platform for individual land investors. The UI is clean, the feature set is comprehensive for solo operators, and the pricing is competitive. However, the platform does not appear to offer role-based access controls, a data change audit trail, or documented data export -- three must-have requirements for our 8-person firm. Additionally, the vendor provides no security documentation (SOC 2, encryption disclosures, DPA, privacy policy). I will continue testing for 2 more days before finalizing, but my preliminary recommendation is DO NOT PROCEED."

---

## Friction Events

| # | Event | Severity | Description |
|---|-------|----------|-------------|
| F1 | Landing page silent on enterprise/team capabilities | HIGH | No mention of RBAC, audit trails, data export, API access, or security on the landing page. An evaluator with enterprise requirements gets zero useful information. |
| F2 | Per-seat pricing is counterintuitive | MEDIUM | Scale tier charges $40/additional seat vs. Pro's $20. While Scale includes more base seats, the higher marginal cost creates confusion when calculating team costs. |
| F3 | No privacy policy or terms of service | HIGH | Signup page and site footer have no links to privacy policy, terms of service, or DPA. For compliance evaluation, this is a mandatory disclosure. |
| F4 | Must-have capabilities undisclosed -- require empirical testing | HIGH | RBAC, audit trails, and data export are nowhere on the pricing page or marketing site. An evaluator must sign up and test manually, adding hours to the evaluation. Features this important should be prominently marketed. |
| F5 | No security or compliance documentation | HIGH | No SOC 2 badge, no encryption disclosure, no data residency information, no backup/recovery documentation. An evaluator cannot assess data security without this information. |
| F6 | No product screenshots showing team/admin features | MEDIUM | The landing page has zero product imagery. Team management, permission settings, and admin interfaces should be visible to enterprise evaluators before signup. |
| F7 | "Compliance Built-In" feature card is misleading | MEDIUM | The card mentions "TCPA consent tracking, DNC list checks, and audit trails for every communication" -- this is communication compliance, not platform security compliance. An evaluator might initially think the platform has comprehensive audit trails, only to discover they're limited to outbound communications. |
| F8 | Credit system unexplained | MEDIUM | The pricing table mentions "AI Requests / day" with different limits per tier. Is this a credit system? What counts as a request? What happens when you exceed the limit? This is unclear. |
| F9 | Auth page unbranded and lacks legal links | MEDIUM | No logo, no terms of service checkbox, no privacy policy link on the signup page. For enterprise evaluation, the signup flow itself is a compliance checkpoint. |
| F10 | Social proof insufficient for enterprise evaluation | LOW | "500+ Properties managed" doesn't help Sarah evaluate team features. She needs case studies from multi-person teams, not individual property counts. |

---

## Recommendation Score

**3/10 -- Likely disqualifying for team use, strong for solo operators.**

AcreOS appears well-suited for individual investors or very small teams (1-2 people) who don't need granular access controls or audit trails. But Lone Star Land Partners has 8 people handling $2.5M in annual transactions. Without RBAC, audit trails, and exportable data, Sarah cannot recommend the platform. The absence of security documentation makes the recommendation even harder to justify.

If AcreOS adds proper RBAC, field-level change tracking, full CSV export, and publishes a security page (even a basic one with hosting details and encryption disclosures), Sarah would re-evaluate and could potentially score it 6-7/10.

---

## Verbatim Quotes (Sarah Would Say)

1. "The pricing page tells me how many leads and properties I get, but doesn't mention access controls, audit trails, or data export. Those are the features I was sent here to evaluate. It's like buying a car and the spec sheet only lists the paint colors."

2. "No privacy policy. No terms of service. My VP will ask 'Did they sign a DPA?' and my answer will be 'They don't appear to have one.' That's a hard no from legal."

3. "'Audit trails for every communication' in the compliance feature card is communication compliance -- TCPA/DNC. It's not a platform audit trail. If our analyst changes a deal amount from $15,000 to $1,500, I need to see who did it and when. This platform doesn't seem to track that."

4. "I've evaluated four platforms this year. Two had better access controls than this. One was Podio, which isn't even designed for real estate. If Podio has permission levels and AcreOS doesn't, that's a problem."

5. "The product is clearly well-built for what it does. The UI is clean, the data features sound impressive, and the pricing is fair. But it's built for a solo operator, not a team. Adding '10 seats' to the Scale plan doesn't make it a team product -- it makes it a solo product that 10 people share."
