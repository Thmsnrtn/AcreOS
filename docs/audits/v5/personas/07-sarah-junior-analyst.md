# Persona 07 — Sarah Okonkwo, Junior Analyst / Evaluator

## Demographics
- **Name:** Sarah Okonkwo
- **Age:** 26
- **Location:** Dallas, Texas
- **Role:** Junior Analyst, Lone Star Land Partners (mid-sized land investment firm, 8-person team)

## Background

Sarah graduated from UT Austin two years ago with a degree in Finance and a minor in Information Systems. She joined Lone Star Land Partners as their first dedicated analyst hire. The firm has been operating on spreadsheets, a shared Dropbox, and the founder's personal contacts for seven years. Sarah was hired specifically to bring rigor: standardized processes, data hygiene, and eventually a real CRM.

Sarah is methodical and documentation-oriented. She writes internal memos for every tool evaluation, complete with pros/cons tables, risk assessments, and total cost of ownership projections. She has evaluated four other platforms in the past six months (Salesforce, Podio, REI Pebble, and a custom Airtable build). None passed her requirements matrix. Her VP, David, trusts her judgment but will not sign a purchase order without a written recommendation.

She is not the buyer. She is not the end user. She is the gatekeeper.

## Current Situation

David (VP of Operations) saw AcreOS mentioned in a real estate professionals' forum and forwarded the link to Sarah with a one-line email: "Can you look at this and tell me if it's real?" Sarah has two weeks to produce a written evaluation. She will sign up for a trial, put the product through her requirements checklist, and deliver a 3-page memo.

Her requirements checklist has 47 items across six categories: user management, data security, audit trails, reporting/export, integrations, and pricing transparency. She has a shared Google Sheet where she scores each tool 1-5 on every item. Any tool that scores below 3 on a "must-have" item is automatically disqualified.

The firm manages approximately 1,200 active parcels and handles $2.5M in annual transactions. They need a platform that can support 8 concurrent users with different permission levels.

## Goal for Using AcreOS

Sarah needs to determine whether AcreOS can serve as the firm's primary operational platform. Specifically:

1. **Role-based access control.** Can she create roles where acquisitions sees different data than dispositions? Can she restrict who can delete records or export data?
2. **Audit trail.** Can she see who changed what, when? Is there a history log per record? Can she export the audit trail for compliance?
3. **Data export.** Can she get all firm data out of the platform in a standard format at any time? Is there a "take your data and leave" option?
4. **Multi-user collaboration.** Can two people edit the same pipeline without overwriting each other? Are there conflict resolution mechanisms?
5. **Compliance readiness.** Does the platform support SOC 2, or at minimum, does it encrypt data at rest and in transit? Where is data hosted? Is there a DPA available?
6. **Pricing predictability.** Is pricing per-seat, per-parcel, or usage-based? Are there hidden costs for features she'd consider essential?

## Technical Comfort Level

**Intermediate.** Sarah is proficient with spreadsheets, can write basic SQL, and understands APIs conceptually but does not write integrations herself. She is comfortable navigating complex UIs and will read documentation thoroughly. She notices inconsistencies between docs and actual behavior and considers them red flags.

She will not hack around problems. If a feature is supposed to work a certain way and doesn't, she records it as a defect and moves on. She does not file support tickets during evaluations — the product needs to stand on its own.

## Expectations Shaped by Other Products

| Product | Expectation Set |
|---------|----------------|
| **Salesforce** | Granular permission sets, field-level security, comprehensive audit trail (Setup > Audit Trail), profile-based page layouts, sandbox environments |
| **Google Workspace** | Sharing permissions (viewer/commenter/editor), activity dashboard showing who accessed what, version history on documents |
| **Notion** | Team spaces with permission inheritance, page-level locking, export to Markdown/CSV/PDF |
| **Slack** | Channel-based access, admin controls for data retention, compliance exports (SCIM, DLP) |

Sarah expects enterprise-grade access controls even in a startup product. She knows most startups skip this, and that is precisely what she is looking for — the absence of access controls is a disqualifying finding.

## Realistic Failure Modes

1. **No role-based permissions.** Sarah invites a test user and discovers there is only one role: "member." Everyone can see everything, edit everything, delete everything. She marks RBAC as "not available" and scores it 1/5. This alone may disqualify the product.
2. **No audit trail.** She edits a parcel record, then looks for a history log. There is none. She changes a lead status and wants to see who changed it and when. No record. She cannot recommend a platform with no change tracking to a firm that handles $2.5M in transactions.
3. **Export produces incomplete data.** She exports all parcels and discovers the CSV is missing 6 of the 22 fields visible in the UI. Custom fields are not included. Notes are truncated at 255 characters.
4. **Pricing is opaque.** The pricing page says "$X/month" but does not mention per-seat costs, credit limits for data enrichment, or overage charges. Sarah finds a "credits" system buried in settings with no documentation on what consumes credits or how much they cost.
5. **Documentation gaps.** The help docs describe features that don't exist yet (roadmap items presented as current features) or omit features that do exist. Sarah loses trust in the documentation and has to verify everything empirically.
6. **No data residency information.** Sarah cannot find where data is hosted, whether backups exist, or whether there is a data processing agreement. Her VP will ask, and "I couldn't find out" is not an acceptable answer.

## What Would Make Her Abandon

Sarah will write a "do not recommend" memo if:

- **Access controls are absent or superficial.** If every team member has identical permissions, the product cannot be used by a professional firm. Her memo will read: "No role-based access control. Any team member can delete any record. Unacceptable risk for a firm managing $2.5M in annual transactions."
- **There is no audit trail.** If she cannot answer "who changed this and when," the product fails her compliance requirements.
- **Data cannot be fully exported.** If the export is incomplete, lossy, or requires contacting support, the product is a data trap.
- **She cannot explain the pricing to her VP.** If she has to write "pricing is unclear and may include hidden charges," David will not approve the purchase.

## Signature Quote

> "I can't recommend this to my VP without proper access controls and an audit trail. We handle real money."
