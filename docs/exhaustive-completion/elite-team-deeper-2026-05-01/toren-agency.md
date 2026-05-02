# Toren Ashford — AcreOS as the back-office for a Land Investor agency

I'm Toren. Forty-one. I run Ashford Land Partners out of a converted bungalow off Krog Street in Atlanta. Twenty-five acquisitions in 2025, total deployed about $14.2M — but here's the thing the AcreOS marketing pages don't seem to anticipate: *none of those 25 are mine.* I bought them on behalf of seven clients. Two RIAs out of Charlotte and Birmingham who allocate a small alts sleeve into raw land for high-net-worth households, two single-family-office back offices that want recreational acreage as legacy holdings for grandkids, and three individual investors — a cardiologist in Roswell, a retired gas-utility exec in Knoxville, a software founder in Austin — who pay me a retainer to scout, underwrite, close, and steward parcels they'll never visit.

That's a *services firm*. Not an operator. Not a fund. The team-of-ten persona buys for the firm; the family-office persona is a single asset owner with internal staff. I'm something narrower and weirder: a fee-for-service Land Investor agency. AcreOS doesn't know I exist, and the audit below is whether I can make it work anyway.

---

## 1. Thirty-second verdict

AcreOS has the bones of a multi-tenant platform — `whiteLabelConfigs` (`shared/schema.ts:258-284`) gives me a parent_organization_id with revenue_share JSON, the reseller dashboard at `client/src/pages/reseller-dashboard.tsx` exists, and the `routes-white-label.ts` POST `/tenants` endpoint creates child orgs under a parent. So the *plumbing* for "Toren spins up an AcreOS workspace per client" is there. What's missing is everything an agency model needs above that plumbing: a per-client engagement letter, billable-hour capture, retainer accounting separated from deal accounting, cross-client deliverable templates, an agency-owner view that aggregates across all my client workspaces (the reseller dashboard shows tenant counts and MRR — not work-in-progress, not deliverable status, not unbilled hours), and a client-facing portal that's *narrow* — a client portal, not a full operator instance.

I can run my agency on AcreOS today. It will look like seven separate operator subscriptions plus a Notion doc holding it together, and I'll bill outside the platform via QuickBooks. AcreOS captures none of the agency-economics layer. The Enterprise tier ($899/mo, `shared/schema.ts:3081-3110`) markets "white-label your empire" but the empire shape it imagines is a SaaS reseller, not a services firm. That's the gap.

Net: usable as a system-of-record. Unusable as an agency-operating-system. Six features close it.

---

## 2. Daily-use walkthrough — Tuesday client review day

**7:00 AM.** Coffee. Tuesday is client-review day — every other Tuesday I send each of my seven clients a status memo: deals in pipeline for them, parcels acquired YTD, capital deployed vs commitment, hours billed this month, hours remaining on retainer. **First thing I want from AcreOS: a per-client status surface that aggregates pipeline + portfolio + hours + retainer balance into one printable page.** What exists: each client could be a child org under my parent org via the white-label tenant model, and I could pull each of their `/portfolio` views separately. What doesn't exist: the agency-owner overlay that shows me all seven clients side-by-side with the *same* metrics. The reseller-dashboard shows MRR and tenant count, which is the wrong frame — I'm not selling each client a SaaS subscription; *I'm* paying for the platform and they're paying *me* for the work.

**8:15 AM.** Cardiologist client (Roswell) wants me to scope an acquisition — 40 to 80 acres, recreational, North Georgia mountains, sub-$300K all-in. **Where does that scope live?** In email, today. AcreOS has no engagement-letter primitive, no scope-of-work object that defines a client's acquisition mandate (geography, size, price, hold horizon, exit strategy, restrictions). Zero references to `engagementLetter`, `scopeOfWork`, `mandate`, or `clientMandate` across the server. That's the *foundational* agency object — the thing every other agency activity references. Without it, every parcel I underwrite has an implicit "is this in-mandate?" check that lives in my head. I want the deal-underwriting page to surface a red banner when a parcel violates the active client mandate: *"108-acre parcel exceeds Roswell mandate cap of 80 acres."* That requires a `clientMandates` table with geography, size, price, and exclusion fields, joined into deal underwriting. Doesn't exist.

**10:00 AM.** Underwrite three parcels for the gas-utility-exec client (Knoxville). I open `/avm` and run valuations. AcreOS doesn't know which client this work is *for*. Every action I take inside the parent workspace is implicitly "for me" — there's no client-tagging on parcels, leads, deals, or activities. **I need a clientId foreign key on every billable artifact.** The team_members role enum at `schema.ts:124` has `owner, admin, acquisitions, marketing, finance, member` — none of which is "client representative" or "fiduciary delegate." If the cardiologist's wife wants read-only access to her husband's portfolio after he dies, AcreOS today routes that through a full team-member seat which gets her into my entire agency's data. Permission walls between client workspaces are the load-bearing requirement, and the current `permissionContext` model is flat per org, not nested.

**11:30 AM.** Time to log the hour I just spent underwriting. AcreOS has *nothing* for time tracking. Search for `timesheet`, `billable`, `hourly`, `engagement`: zero hits in agency-relevant code. The bookkeeping module (`routes-bookkeeping.ts`) is for deal P&L, not professional-services time-and-expense. I either bolt on Harvest/Toggl externally and reconcile monthly, or I lose the data — most agency owners lose the data. **The agency feature that pays back fastest is a frictionless timer button next to every parcel/deal/lead surface that says "log time against this artifact for this client" and writes to a `billableEntries` table tied to the active mandate.** AcreOS has the artifacts. It has no timer.

**1:00 PM.** Birmingham RIA wants their Q1 deliverable — the document I owe them under our $4,500/quarter retainer: a written market memo, three sourced parcels with full diligence packs, and a portfolio review of their existing 11-parcel sleeve. **AcreOS has the source data.** It has no concept of a *deliverable* — a structured output the agency owes a client by a date. No deliverable templates, no deliverable status workflow, no client-acceptance signature on a deliverable. The closest primitive is the deal-room, but a deal-room is per-deal; my deliverable is per-quarter, per-client, and aggregates across multiple deals. I want `/clients/:id/deliverables` with templated outputs (quarterly memo, annual portfolio review, parcel diligence pack, market scan) that auto-populate from the underlying data and ship to the client portal for review and acceptance.

**2:45 PM.** Austin software-founder client wires me $180K for a parcel I'm closing on his behalf next Friday. Where does that money live in AcreOS? The capital-markets module (`routes-capital-markets.ts`) thinks about syndication, not about *fiduciary trust* — me holding client funds in a segregated account, drawing them down at close, returning unused balance, with a paper trail that satisfies a state Bureau of Real Estate. Search for `escrow`, `trust account`, `client funds`, `IOLTA`: nothing agency-shaped. For an RIA-aligned agency this is a *regulatory* hole, not a feature gap. Massachusetts and Georgia both regulate agency-held client funds. AcreOS has no surface for it. I run a separate Mercury account and a spreadsheet. So does every other agency. None of us trust this part to a CRM. It's *interesting* that AcreOS could be the first.

**4:30 PM.** Two RIAs ask the same question this week: "Can we see the deal pipeline ourselves instead of waiting for your Tuesday memo?" The answer should be: yes, log into your client portal at `<rias-name>.ashfordpartners.com`, see your deals, your parcels, your retainer burn-down, your deliverable status. **AcreOS has white-label custom-domain support** (`whiteLabelConfigs.customDomain`, `middleware/customDomainRouter.ts`, `middleware/white-label-domain.ts`) — that's a real foundation. What it lacks is the *narrow* portal surface a client should see. Today if I gave a client a seat in their child-org workspace they'd see the full operator UI: campaigns, marketing, AI agents, leads, comps. They don't want any of that. They want a six-tab portal: *Mandate, Pipeline, Portfolio, Statements, Deliverables, Documents.* The borrower-portal at `client/src/pages/borrower-portal.tsx` proves AcreOS can ship a narrow external-user portal; the same pattern wants a client-portal cousin.

**5:30 PM.** Junior associate (Mara, $58K base, started in February) DMs me a question on the cardiologist's North Georgia parcel. She's done 11 hours of underwriting work this week. I have *no idea* whether those 11 hours are billable, against which mandate, or whether the cardiologist's retainer covers them. AcreOS has no agency-staff utilization view. I'd pay real money for: a per-associate dashboard showing hours-this-week × bill-rate / cost-rate per client, a realization-rate column (billed-hours / worked-hours), and a flag when an associate's work is being absorbed (not billable to any active mandate). That's how an agency stays solvent. Today I track it in a spreadsheet I update on the 1st of each month, badly. Mara could be 30% under-utilized or 30% over-allocated to the unprofitable Knoxville client and I'd know neither for two more weeks.

**6:15 PM.** End of day. Bill the day's hours. Today this is a manual transcription exercise: I stare at my calendar, re-type into Harvest, push to QuickBooks, generate the invoice on the 15th. **The agency revenue model is hours × rate + retainer + per-deal acquisition fee + percentage-of-spread on closed parcels.** AcreOS has Stripe billing for SaaS subscriptions (`routes-billing.ts`), connected accounts for borrower payments, and revenue-share JSON for white-label resellers. It has *no* invoicing primitive that says "agency charges client X at rate Y for activity Z plus retainer carryforward." That is its own domain — closer to a professional-services-automation tool (Mavenlink, Kantata, Accelo) than a CRM. Without it, my AcreOS subscription is overhead I can't bill against.

---

## 3. The agency test — what passed, what didn't

**Pass:**
- White-label tenant model with parent_organization_id, custom_domain, brand_name, primary_color, support_email (`schema.ts:258-284`)
- Reseller dashboard surface (`client/src/pages/reseller-dashboard.tsx`) — tenant list, status, plan, MRR, AI-credits-used
- Custom-domain routing middleware exists (`middleware/customDomainRouter.ts`, `middleware/white-label-domain.ts`)
- Org-scoped data isolation enforced everywhere via `organizationId` foreign keys and `getOrganization(req)` (per CLAUDE.md)
- Reseller revenue-share JSON (platformFeePercent, resellerFeePercent) — primitive of agency-platform split
- Borrower-portal pattern proves AcreOS can render a narrow non-operator surface (`borrower-portal.tsx`)
- Investor-profile + investor-verification schemas exist (`schema.ts:9133-10262`) — KYC primitives I could repurpose for client onboarding
- Deal-room versioning + signed-URL document download — usable for client deliverables in a pinch

**Fail or Missing:**
- **No client-mandate object.** Geography, size, price, hold horizon, restrictions — the scope-of-work primitive every agency activity should reference. Doesn't exist.
- **No time tracking.** Zero references to `billable`, `timesheet`, `hours_logged`, `time_entry`. I cannot capture professional-services labor inside AcreOS.
- **No engagement-letter primitive.** No retainer-agreement object, no fee-schedule object distinct from SaaS subscription billing, no client-acceptance flow.
- **No client portal.** White-label tenants land clients in the *full operator UI* — wrong surface for a fiduciary read-only consumer. The narrow 6-tab client portal does not exist.
- **No deliverable workflow.** Quarterly memo, annual portfolio review, parcel diligence pack, market scan — no template engine, no due-date tracking, no client-acceptance signature on a deliverable.
- **No agency-owner cross-client overlay.** The reseller dashboard shows SaaS metrics (MRR, tenant count, AI credits), not agency metrics (WIP, unbilled hours, retainer burn-down, deliverable backlog).
- **No client-funds / trust-account primitive.** No segregated escrow, no IOLTA-style ledger, no fiduciary-controls audit log on client capital movement.
- **No professional-services invoicing.** Hours × rate + retainer + per-deal fee + spread carry — none of it expressible in AcreOS's billing surface, which is built for SaaS subscriptions (Stripe price IDs).
- **No cross-client conflict-of-interest detector.** If I'm sourcing the same parcel for two clients with overlapping mandates I should be alerted. AcreOS has no surface for it.
- **No client-tagging on activities.** Every parcel/lead/deal lives in *an organization*; there's no second axis tagging it as work-for-client-X.
- **No fiduciary role.** team_members role enum (`schema.ts:124`) is `owner, admin, acquisitions, marketing, finance, member` — no `client_principal`, `client_delegate`, `successor_trustee`, or `fiduciary_observer`.
- **No agency staff utilization view.** If I hire a junior associate to underwrite at $45/hr and bill out at $125/hr, I need utilization rate, realization rate, and gross margin per associate per client. Not built.
- **No deliverable history per client.** No "show me every memo I've delivered to the Knoxville client over four years" view. The data could exist; the surface doesn't.
- **No mandate-violation guardrails.** When I underwrite a parcel that violates the active mandate (too big, wrong county, wrong price band), nothing flags it.
- **Permission walls inside one org.** If I tried to run all seven clients inside *one* org with client-tagged data instead of seven child orgs, AcreOS has no row-level authorization to keep client A's user from seeing client B's parcels. The architecture is org-scoped, not client-scoped-within-org.

---

## 4. Per-surface friction (agency view)

**`/reseller-dashboard`** — Built for SaaS reselling, not for service delivery. Wants an alternate "agency mode" that swaps tenant-MRR for retainer-balance, tenant-AI-credits for billable-hours-this-period, and tenant-status for deliverable-backlog. Same data model (parent_organization_id), different presentation.

**`/dashboard`** (operator) — When I'm logged in as the agency owner I want a client switcher in the topbar (the new `PageTopbar` in commit `e315df9` is the right place to drop it). Today every action implicitly belongs to the active org; I want a per-action client tag that overrides the implicit org context for billing purposes.

**`/avm` and `/deal-underwriting`** — No mandate sidebar. When I open a parcel for analysis I want a banner: *"Active client: Knoxville (Mandate: 40-80ac, $200-300K, GA mountains). This parcel: 108ac, $410K, Tennessee — 2 of 3 mandate constraints violated."* The data exists. The surface to present it doesn't.

**`/portfolio`** — Single-org portfolio view. Needs a client filter: show me Knoxville's 4 parcels separately from Birmingham RIA's 11 parcels. Or: a roll-up across all clients with client-attribution per row.

**`/bookkeeping`** — Built for deal P&L, not agency P&L. Agency P&L = (hours × rate) + retainer + acquisition-fee + spread-carry minus (cost of deliverables, junior associate cost, AcreOS subscription, marketing). The bookkeeping module doesn't model professional-services revenue.

**`/borrower-portal`** — Architecturally the closest cousin to what a client-portal should be: scoped, narrow, non-operator UI, magic-link-style access (`routes-borrower.ts:78-94` — 24-hour token). Clone the pattern: `/client-portal/:clientId` with the 6-tab narrow surface.

**`/onboarding`** — There's no agency-firm persona. When I signed up I clicked "Land Flipper" because there was no "Land Investor agency / fee-for-service / multiple clients" option. The businessType enum at `schema.ts:41` lists 14 categories, none of which is "agency" or "advisor" or "fiduciary services." Wrong onboarding leads me down an operator path instead of a multi-client setup wizard.

**`/pricing`** — The Enterprise tier ($899/mo, `schema.ts:3081-3110`) is the closest thing to an agency tier and it's still operator-shaped. Imagine instead: "Agency" tier at $1,500-$3,000/mo with N child-org workspaces included, mandate management, time tracking, deliverable templates, professional-services invoicing, fiduciary trust ledger. That's the price I'd pay because it replaces my Harvest + QuickBooks + Mercury + Notion stack — not because it's a SaaS markup.

**`/team`** — team_members role enum is operator-shaped. Need an agency-staff schema overlay: `bill_rate`, `cost_rate`, `utilization_target`, `client_assignments[]`, `time_tracker_active_entry`. Today an "acquisitions" team member has no rate concept.

**`/compliance`** — The compliance surface (`compliance.tsx`) is operator-compliance (TCPA, fair-housing, do-not-call). Agency compliance is *different*: state advisor registration, fiduciary-duty acknowledgments, conflict-of-interest disclosures, client-funds audit trail. None of it surfaced.

**`/marketplace`** — Operator-side. As an agency I want a *client-facing* marketplace mode: my Birmingham RIA logs into their portal, sees the three parcels I've sourced for their mandate this quarter, and clicks accept/decline on each. That's a different surface than the existing marketplace which is buyer-meets-seller in a one-shot transaction. Closer to a curated allocation queue. Not built.

**`/closing`** — The closing module (`routes-closing.ts`) tracks closing tasks per deal. For an agency, closing-tasks have an extra axis: which client is the buyer, who signs (the client principal, a delegated trustee, the client's RIA on their behalf), where do funds come from (client wire, retainer draw, escrow account), and where do post-close documents route (client portal? client's CPA? both?). The current closing surface is single-buyer-shape; it needs a fiduciary-buyer overlay.

**`/agent-command-center`** — Founder-side AI. For an agency this surface should be reframed: "What does my AI know about each client's mandate, and is it producing client-attributed work I can bill against?" Persona-architecture rule (Pax for customers, Sophie/Forge/Atlas for founder per memory) implies clients see Pax — but Pax doesn't know about *their* mandate when it's me using Pax for them. The mandate context wants to be a Pax variable, not a per-org AI memory.

---

## 5. What's missing — agency priority order

1. **Client mandate object + mandate-violation guardrails.** `clientMandates` table: geography (counties, states, polygons), size band, price band, hold horizon, exit strategy, exclusions, retainer-coverage period. Surface as a banner on every underwriting/AVM/parcel page. Without this everything else is ad-hoc.
2. **Time tracking with client attribution.** `billableEntries` table tied to (clientId, mandateId, artifactType, artifactId, durationSeconds, rate, billableFlag). One-click timer in the topbar. Auto-categorize against active client. Roll up into deliverables and invoices. This single feature is what differentiates "agency back-office" from "operator CRM."
3. **Client portal — narrow 6-tab surface.** Tabs: Mandate, Pipeline, Portfolio, Statements, Deliverables, Documents. Use the borrower-portal pattern (`borrower-portal.tsx`, `routes-borrower.ts`). Magic-link access. Read-only by default. Custom-domain via the existing `whiteLabelConfigs.customDomain` plumbing.
4. **Deliverable workflow with templates.** Quarterly memo, annual portfolio review, parcel diligence pack, market scan, mandate-update letter. Auto-populate from underlying data. Status: drafting / under-review / delivered / accepted / rejected. Client-acceptance signature via the native esign stack (per the memory note: AcreOS ships its own signing — don't propose DocuSign).
5. **Professional-services invoicing.** Hours × rate + retainer + per-deal acquisition fee + spread carry. Stripe Connect-backed, with retainer-balance carryforward and the ability to draw from retainer before billing time. Distinct from the existing SaaS-subscription billing path. Probably a `/billing/agency-invoices` surface.
6. **Agency-owner overlay across clients.** Cross-client dashboard: WIP by client, unbilled hours by client, retainer burn-down by client, deliverable backlog by client, mandate-violation alerts, conflict-of-interest hits. This is the Tuesday-morning page I'd live on. The reseller dashboard is the wrong cousin; this is closer in shape to a Kantata or Accelo home page.
7. **Fiduciary trust ledger.** Segregated client-funds account integration (Mercury or Modern Treasury), per-client sub-ledger, deposit/draw/return audit trail, monthly reconciliation report. State-regulator-aware controls.
8. **Conflict-of-interest detector.** When two active mandates overlap on geography + size + price band, flag it. When the same parcel appears in two clients' pipelines, force a disclosure decision before progressing either.
9. **Agency-staff schema overlay.** Bill rate, cost rate, utilization target, client assignments. Realization-rate report (billed-hours / worked-hours), gross-margin-per-associate-per-client view.
10. **Onboarding branch for agency-firm persona.** Add `land_investor_agency` or `advisor` to the businessType enum (`schema.ts:41`) and wire a wizard that asks "how many clients?" upfront, then provisions parent + child orgs, mandate templates, billing rates, and a starter deliverable template library.

---

## 6. Pricing reaction (agency math)

My P&L for 2025: $620K revenue ($310K retainer + $185K acquisition fees + $125K spread carry on six closed flips), $410K cost (one junior associate at $58K, contract paralegal $14K, marketing $32K, travel $19K, software $24K, owner draw $263K), so ~$210K net of owner draw. The $24K software line is Harvest ($1,440), QuickBooks ($1,080), Mercury (free), Notion ($800), DocuSign ($2,400), Calendly ($240), Carta ($3,600 — for client cap-table tracking on a few syndicated deals), CoreLogic ($6,000), miscellaneous ($8,440 — Zapier, Loom, Granola, scheduling tools, mailers).

If AcreOS shipped an "Agency" tier at $1,500-$2,500/mo ($18K-$30K/yr) that replaced Harvest + DocuSign + Carta-for-clients + CoreLogic + the Notion deliverable tracking, I'd pay $24K-$36K instantly and feel like I came out ahead because I'd save ~6 hours/month of reconciliation time (≈ $9K/yr at my $125/hr bill rate). The Enterprise tier today at $899/mo is *too cheap* for what an agency actually needs — and it's underbuilt for what an agency actually does. Re-tier: keep Enterprise at $899 for the SaaS reseller use case (which `/reseller-dashboard` already serves); add Agency at $1,800/mo with the six features above; add Fiduciary at $4,500/mo with the trust ledger, AML/KYC client-side, and state-regulator-ready audit exports for RIAs and advisors who custody client capital.

The agency-firm market is bigger than it looks. Land Investor agencies are nascent — maybe 200 in the US today — but the *agriculture-buyer's-agent* market (Hall, Whitetail Properties, AgWest, etc.) has hundreds of firms. The *recreational-buyer's-agent* market has more. A platform that ships agency primitives and white-labels the buyer's-agent surface plausibly captures 1,000-2,000 paying agency-firms at $1,800-$4,500/mo — that's $20M-$100M ARR by itself, and it sits on top of the existing operator-tier base as an upsell rather than a parallel build. The reseller-tenant primitive is the seed.

---

## 7. The deal-killer — and the fix

For an agency specifically, the deal-killer is *data-co-mingling risk*. If I run all seven clients inside one parent org with client-tagging on activities, AcreOS has no row-level authorization keeping the cardiologist's wife (when she eventually gets read-only access after he dies) from seeing the Birmingham RIA's deals. That's a fiduciary breach on day one. So I'm forced into the seven-child-org model — which works, but makes cross-client work (the agency-owner overlay, cross-client conflict detection, agency-staff utilization across clients) much harder because AcreOS has to walk parent → children → aggregate per query, and the existing route layer is single-org-scoped.

The fix is hybrid: keep the child-org model as the data-isolation boundary (it's correct for fiduciary), and add an agency-aggregation layer that the parent_organization_id can query *across* its tenants with cached, materialized views. The reseller-dashboard already does some of this (tenant list, MRR roll-up). It needs to be expanded to surface mandate, time, deliverables, and trust-ledger across tenants for the agency-owner role, while every individual tenant remains opaque to every other tenant. Six months of careful work.

The bigger opportunity: AcreOS could be the *first credible* operating system for fee-for-service Land Investor agencies. There's no incumbent. Hall and Whitetail use Salesforce + DocuSign + QuickBooks + a Notion wiki and they all hate it. If AcreOS ships features 1-6 from the priority list, the agency segment is *won* before anyone else builds it — and once an agency is on AcreOS, every one of their clients is exposed to AcreOS's portfolio surfaces, which is a high-quality user-acquisition channel into the institutional buyer segment Camille's audit already maps out.

---

## 8. Three things AcreOS gets right that other agency platforms don't

Because the missing list is long, fairness:

First, **the white-label tenant primitive is structurally correct.** parent_organization_id + custom_domain + brand_name + revenue_share is exactly the right schema for an agency owner provisioning workspaces per client. Most platforms force you into single-tenant or full-fork; AcreOS's hybrid is the right shape. It just needs the agency-aggregation layer above it.

Second, **the borrower-portal proves AcreOS can ship narrow external-user surfaces** without leaking the operator UI. That pattern (token-based access, scoped routes, distinct visual shell, magic-link auth at `routes-borrower.ts:78-94`) is the template for a client portal. Reuse, don't redesign.

Third, **org-scoped data isolation is enforced consistently.** Every route handler keys off `organizationId`; the `AuthenticatedRequest` type and `getOrganization(req)` helper (per CLAUDE.md) make it hard to leak across orgs. That's the security foundation an agency model requires. The teams that try to retrofit cross-tenant safety lose a year. AcreOS already has it.

These three together mean the agency layer is a *features-on-top* problem, not an architecture-rewrite. That's a 2-quarter ship, not a 2-year one. Worth doing.

P.S. — One non-obvious wedge: the persona-architecture rule (Pax for customers, founder-only Sophie/Forge/Atlas) means my *clients* see Pax in their portals. Pax should know each client's mandate as context — and never know about other clients of mine. That's a per-client AI-memory partition inside Pax, not just an org-scoped one. Build that and the AI feels custom-tailored to each client without me lifting a finger. Skip it and Pax feels generic.

— Toren
