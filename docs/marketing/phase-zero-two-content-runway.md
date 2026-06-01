# Phase Zero-Two — Content Runway (Strategy, Not Cargo)

Author: Soren (CGO)
Status: scaffold — bodies deferred. This file is the 6-week runway plan: titles, hooks, templates. Each item maps to a primary persona (of nine), the truth-engine sources it would need to clear, and the keyword/intent shape it targets. No bodies are written here. When bodies ship, every numeric claim cycles through `server/services/truth-engine/verifyClaim.ts` and Beatrice's review before publish.

## Personas (canonical, from `shared/business-types.ts`)

| # | id                    | tier    | landing chip      |
|---|-----------------------|---------|-------------------|
| 1 | land_investor         | primary | "for Land Investors." |
| 2 | note_investor         | core    | solid chip        |
| 3 | fix_and_flip          | beta    | "Beta"            |
| 4 | residential_wholesaler| beta    | "Beta"            |
| 5 | tax_lien_deed         | beta    | "Beta"            |
| 6 | subdivider            | roadmap | muted chip        |
| 7 | buy_and_hold          | roadmap | muted chip        |
| 8 | note_originator       | adjacent| (not landing-listed; in onboarding) |
| 9 | note_servicer         | adjacent| (not landing-listed; in onboarding) |

Every runway item below names a primary persona explicitly. Items targeting "all" are forbidden — each piece must feel written for one operator.

---

## 1. Twelve Blog Posts — Titles + Angles

Voice rule: mechanics-first, third-person, no founder voice. Each draws from public records, the AcreOS production data corpus (anonymized counts only, no customer names), or named third-party research. **No numerical claim ships without a truth-engine pass.**

| # | Title | Angle (one sentence) | Persona | Truth-engine sources | Keyword intent |
|---|-------|----------------------|---------|----------------------|----------------|
| 1 | The Buy-Box, Defined: Six Filters Every Land Investor Sets Before the First List | Walks the six filter dimensions AcreOS exposes (county, acreage, price band, owner profile, road access, encumbrances) and why each kills bad leads cheaply. | land_investor | AcreOS buy-box schema (`shared/buy-box.ts`); REtipster public buy-box framework | informational; "land investing buy box," "land flip filters" |
| 2 | Why Zillow Estimates Are Wrong on Vacant Land (and What Replaces Them) | Explains the comp-data gap on parcels with no structure: why AVMs miss, what county+sale-record overlays do instead. | land_investor | ATTOM Data product docs; Zillow Zestimate methodology page; AcreOS comp engine README | informational; "vacant land comps," "land valuation methods" |
| 3 | County GIS in 10 Minutes: From Parcel Click to Buy-Box-Filtered List | Mechanics walkthrough of pulling a county list, filtering, and shipping mail — using the 10-minute setup latency target. | land_investor | AcreOS list-pull job latency baseline; production county-GIS registry (`docs/county-gis-coverage.md`) | how-to; "county parcel list," "land investing software" |
| 4 | The Note That Stopped Paying: What a Land Investor Does the Same Day | Workflow walkthrough for `note_payment_missed` template — the exact sequence AcreOS automates. | note_investor | AcreOS workflow registry (`tpl_note_payment_missed`); UCC enforcement basics from named legal source | informational; "note investing missed payment," "owner-financed land collection" |
| 5 | Discount, Yield, and the Mistake of Buying Notes by Face Value | Mechanics of pricing a performing note: discount math, yield math, the trap of paying par. | note_investor | Public note-investing primers (named); AcreOS Finance hero "note investor" calculations | informational; "note investing math," "buying performing notes" |
| 6 | Direct Mail Without Spray: How a Wholesaler Picks 200 Owners From 50,000 | The targeting layer between county list and mail merge — concentration over volume. | residential_wholesaler | AcreOS skip-trace cost data; USPS bulk-mail rate sheet (named); wholesaler-targeting frameworks (public) | how-to; "wholesale direct mail," "motivated seller list" |
| 7 | The Redemption Clock: A Tax-Delinquent Workflow That Doesn't Miss Dates | The dated-event automation the platform owns: redemption windows, quiet-title checkpoints. | tax_lien_deed | County redemption-period statutes (named state list); AcreOS redemption-clock spec | informational; "tax deed investing," "tax lien redemption period" |
| 8 | A Fix-and-Flip Rehab Kickoff in 30 Minutes Without Spreadsheets | Walks `tpl_fix_flip_rehab_kickoff` and the swap-out from Excel coordination to platform coordination. | fix_and_flip | AcreOS workflow template registry; named industry comp on rehab task overhead | how-to; "fix and flip rehab checklist," "rehab project management" |
| 9 | Why a Land Investor Should Be Boring About Comps (and Aggressive About Outreach) | Argues the asymmetry: comp accuracy is bounded, outreach volume is not — where AI helps and where it doesn't. | land_investor | AcreOS comp-engine accuracy benchmark (internal, named source on publish); production outreach throughput data | thought-leadership; "land investing strategy" |
| 10 | The Pax Reply, Annotated: What a Seller Receives at 6:00 AM | One real anonymized reply drafted by Pax, with the data trace shown — comps cited, confidence, edit history. | land_investor | Live Pax reply trace from anonymized production thread; AcreOS Pax draft schema | demo; "AI seller outreach," "real estate AI assistant" |
| 11 | Single-Seat vs. Team: When a Land Operator Adds a Virtual Assistant | Mechanics of multi-seat AcreOS — role gates, what a VA can see, what stays with the principal. | land_investor + note_investor (multi-seat) | AcreOS RBAC permissions matrix (`server/utils/permissions.ts`); named industry VA-cost benchmark | informational; "virtual assistant for real estate investors" |
| 12 | The Honest Roadmap: What AcreOS Ships for Fix-Flips Today vs. What's in Beta | Mirrors the landing's beta honesty — what's live, what's maturing, what's roadmap. Builds trust by not overselling. | fix_and_flip + residential_wholesaler + subdivider | `shared/business-types.ts` registry; landing Positioning.tsx; AcreOS roadmap doc | trust-building; "AcreOS features," "land investing platform comparison" |

**Production cadence target.** Two posts per week × 6 weeks = 12. Items 1–4 are the wedge (Land Investor + Note Investor — core tiers). Items 5–9 broaden into beta personas. Items 10–12 are credibility / demo.

---

## 2. Eight LinkedIn Org-Page Post Hooks

Mechanics-first. No "I built this," no founder voice. Each hook is a single defensible opening line — the kind that earns the scroll-stop without manipulation. Bodies deferred.

| # | Hook | Persona | Truth-engine sources |
|---|------|---------|----------------------|
| 1 | "A land investor's buy-box has six filters. Most software exposes two." | land_investor | AcreOS buy-box schema vs. named competitor feature pages (PropStream, DealMachine) |
| 2 | "Zillow doesn't price vacant land. Here's what county sale records actually say." | land_investor | ATTOM + named county-recorder source on parcel sale records |
| 3 | "A missed note payment generates four tasks. AcreOS runs them in the order they pay off." | note_investor | `tpl_note_payment_missed` workflow registry |
| 4 | "Direct mail volume is a lazy metric. Owner-concentration ratio is the real one." | residential_wholesaler | USPS bulk rate sheet; named wholesaler-targeting study |
| 5 | "Tax-deed redemption periods range from 60 days to 3 years. The platform tracks each one." | tax_lien_deed | Named multi-state statute table |
| 6 | "A rehab kickoff used to need a 14-tab spreadsheet. The template is 11 tasks. That's it." | fix_and_flip | `tpl_fix_flip_rehab_kickoff` registry |
| 7 | "Pax doesn't write replies in a vacuum. Every draft cites the comps it used." | land_investor + note_investor | Pax draft schema; sample anonymized trace |
| 8 | "AcreOS lists fix-flippers, wholesalers, and tax-delinquent buyers as 'Beta' on the landing. Honesty scales better than feature inflation." | fix_and_flip + residential_wholesaler + tax_lien_deed | Landing `Positioning.tsx` tier chips |

**Cadence target.** Three posts per week × first 3 weeks of Phase Zero-Two = 9; eight defined here, the ninth slot is a reactive post tied to whatever the truth engine + Solene approve in-week.

---

## 3. Six Outreach Email Templates (Trial → Paid)

CAN-SPAM compliant: every template includes physical address + one-click unsubscribe. No dark-pattern urgency. No fake scarcity. Beatrice signs off before any of these ships through Resend.

Each template below is **subject + opener + value + CTA**. Body deferred to draft + truth-engine pass.

| # | When fires | Subject | Opener | Value | CTA | Persona |
|---|------------|---------|--------|-------|-----|---------|
| 1 | Day 1 post-signup | "Your buy-box is saved. Here's what runs overnight." | "The buy-box you set on signup is now active across [county count] counties." | What Pax ran in the first 24h: lists pulled, mail prepped, replies drafted. | "See your overnight queue → /today" | land_investor (default) |
| 2 | Day 3, no buy-box defined | "The setup that takes 10 minutes" | "Pax can't pull lists until the buy-box is defined. Here's what to fill in." | The six filters, why each matters, the 10-minute target. | "Finish setup → /onboarding-v2" | land_investor |
| 3 | Day 5, first parcel viewed but no mail sent | "The mail draft Pax wrote for [APN]" | "Pax drafted a mail piece for the parcel you opened yesterday." | The drafted copy + the comp data behind it. | "Review the draft → /deals/[id]" | land_investor |
| 4 | Day 7, multi-vertical signal in onboarding | "AcreOS sees note investors, too — and three other types in beta" | "The onboarding data showed you also work [vertical]. Here's what's live for that type today." | Honest tier — what's core, what's beta, what's roadmap. | "Switch persona in Settings → /settings/persona" | note_investor / fix_and_flip / residential_wholesaler / tax_lien_deed |
| 5 | Day 10, trial day 10/14 | "Four days left on your trial. Here's the math on Pro." | "Trial ends [date]. Pro is $41/mo billed annually." | What Pro unlocks (Pax, unlimited counties, BYOK), what trial keeps if downgraded. | "Upgrade to Pro → /pricing" | all 9 |
| 6 | Day 13, trial expiring tomorrow | "Tomorrow your trial ends. Two ways forward." | "Your trial ends tomorrow. You can upgrade, or downgrade to Free and keep your saved data." | Free tier scope vs. Pro tier scope; no data deletion. | "Upgrade → /pricing  ·  Downgrade → /settings/billing" | all 9 |

**Send guardrails (Beatrice's rules).**
- All sends gated on `users.email_marketing_opt_in = true` (default false on signup; set on the onboarding step).
- Frequency cap: max 1 marketing email per 48h.
- Suppression list checked against `users.unsubscribed_at IS NOT NULL` on every send.
- No template fires after Day 13 — trial-expiry day; the in-app billing surface owns it from there.

---

## 4. What This Runway Is Not

- **Not the bodies.** Twelve full blog posts is ~24,000 words; that's a separate workstream gated on truth-engine readiness.
- **Not the schedule.** The cadence targets above are realistic but not committed; Solene confirms when Phase 0 activates.
- **Not the SEO playbook.** Keyword research above is intent-shape, not a Ahrefs export. Lena owns the deep keyword work at Phase 1.
- **Not the launch.** Nothing here gets published until: truth-engine pass + Beatrice compliance pass + Solene approve. The runway is the runway, not the takeoff.

---

## 5. The Truth-Engine Contract on Every Item

For each piece above, before publish:

1. Extract every numeric claim, comparison, and capability statement.
2. Call `verifyClaim(claim, sources[])` from `server/services/truth-engine/` (see Pillar 5).
3. If any claim returns `verified: false`, rewrite or cut.
4. The published piece includes a "Sources" footer with each truth-engine-verified citation.

The runway is content; the truth engine is the rail. Neither ships without the other.
