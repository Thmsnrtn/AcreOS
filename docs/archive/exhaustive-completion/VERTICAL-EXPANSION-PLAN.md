# Vertical Expansion Plan

Written 2026-04-30 during the autonomous refinement run. Founder
explicitly authorized this analysis: *"vertical expansions to other
investor / real estate professional profiles who could utilize this app."*

This is a **recommendation document**, not implementation. The
expansions below would each be 2–8 weeks of focused work; founder triages
which to schedule.

---

## What we have today

AcreOS is currently optimized for **Land Investors** (v6 positioning) —
the buy-cheap, sell-with-financing, manage-the-note workflow over raw
land parcels. The platform is unusually capable for this niche:

- Lead → property → deal pipeline with motivated-seller scoring
- Direct-mail campaigns with response tracking
- Property valuation (AVM), comps, county GIS overlays
- Native e-sign + offer generation
- Seller-financed note management + dunning
- Multi-tenant white-label
- Multi-agent AI roster (Pax customer-facing; Atlas/Sophie/Forge/Shield
  internal) with autonomy infrastructure (cascade, feedback loop, scoring)
- Tier 5 founder mode for autonomous-company operation

**Reality check**: ~70% of the infrastructure is generic real-estate
operating-system. ~30% is Land-Investor-specific (county GIS, raw-land
valuation, blind-offer wizard, parcel-detail flows).

---

## Adjacent personas, ranked by current platform fit

### 1. Note Investors — **70% built** · S effort

Buy/sell/manage promissory notes (often seller-financed mortgages secured
by real estate). Distinct from Land Investors but uses overlapping
infrastructure.

**Already supported:**
- `/finance` — seller-financed notes, payment tracking, escrow
- `/portfolio` — note portfolio rollups, principal/interest charts
- `/capital-markets` — note securitization, lender pipeline
- `/dunning` — delinquency management
- `/exchange-1031` — tax-deferred exchanges
- `migrations/seed-james-note.ts` — note seed data exists in repo

**Net-new for note investors:**
- Note acquisition pipeline (buying *existing* notes from other holders, not just creating from sales)
- BPO (broker price opinion) workflow for valuing notes
- Note assignment workflow + secondary-market listings
- Note-specific underwriting (LTV, payment history, borrower credit)
- Different KPIs: yield, cash-on-cash return, NPV vs. land-investor IRR

**Vocabulary swaps**: Property → Note · Parcel → Underlying property · Deal → Note acquisition · Pipeline stage names

**Why first**: highest infrastructure-overlap, smallest delta. Plus James-note seed data signals founder already considered this.

### 2. Tax-Delinquent / Pre-Foreclosure Specialists — **60% built** · M effort

Buy properties from owners behind on taxes (before foreclosure) or at the
tax sale itself. Investor profile is different from generic land
investors but uses similar property-acquisition tools.

**Already supported:**
- `/tax-delinquent` — page exists
- `/property-tax` — property-tax tracking
- `/dodd-frank` — regulatory checks
- `/leads` — lead management with motivation scoring

**Net-new:**
- Tax-sale calendar integration (county-by-county auction dates)
- Tax-certificate vs. tax-deed flow (different states have different rules)
- Pre-foreclosure outreach templates (specific compliance rules)
- Bidding-at-auction tooling
- Title-clearing workflow post-acquisition
- Quiet-title automation

**Vocabulary swaps**: Lead → Tax-delinquent owner · Deal → Tax certificate / tax deed · Marketplace → Tax sale calendar

**Why second**: page already exists, half the data infrastructure exists, but the workflow differs enough that it needs persona-specific UX.

### 3. Wholesalers — **50% built** · M effort

Find motivated sellers, get under contract at low price, **assign the
contract** to an end buyer for an assignment fee. Don't actually own
the property. Different from Land Investors mostly in the
**assignment/dispo half** of the workflow.

**Already supported:**
- Lead → motivated seller pipeline (full reuse)
- Direct mail / SMS / cold-calling campaigns
- Offer generation
- Native e-sign for purchase contracts
- `/marketplace` — buy/sell deals (closest to wholesaler dispo)
- `/listings` — property listings

**Net-new:**
- Assignment contract templates + e-sign flow (assignment fee + buyer)
- Buyer's list / buyer matching (currently tilted toward seller-financed end-buyer; wholesalers need cash-buyer matching)
- Double-close flow (some wholesalers "double close" instead of assigning)
- Earnest money deposit tracking
- Wholesaler-specific KPIs: assignment fee, days-on-contract, buyer match rate
- Per-state assignment legality flags (some states restrict assignment without a real-estate license)

**Vocabulary swaps**: Property → Subject property · Deal → Assignment · Pipeline final stage: "Closed" → "Assigned"

**Why third**: leverages the most lead-gen infrastructure but the dispo half is largely missing.

### 4. Subdividers — **45% built** · M effort

Buy large parcels, subdivide into smaller lots, sell smaller lots
individually. Variant of Land Investing with subdivision/entitlement
workflow added.

**Already supported:**
- Land-investor lead gen + acquisition (full reuse)
- AVM, comps, county data (full reuse)
- Direct mail (full reuse)
- `/maps` — parcel mapping
- Native e-sign

**Net-new:**
- Subdivision plan / lot configuration tooling (visual lot drawing on parcel)
- Permit-tracking workflow per county (zoning, planning, utilities, surveys)
- Per-lot pipeline (one parent property → N child lots, each in its own pipeline stage)
- Survey + plat-map upload + version tracking
- Lot-by-lot pricing strategies (corner lots, road frontage, etc.)
- HOA / CC&R drafting
- Per-county subdivision approval timelines

**Why fourth**: shares acquisition + outreach with land investors, but subdivision execution is its own complex sub-workflow. Worth doing only if there's known demand.

### 5. Fix-and-Flippers — **30% built** · L effort

Buy distressed property, rehab, resell at higher price. Workflow
emphasis is rehab + budget + contractors.

**Already supported:**
- Lead gen → motivated seller (full reuse with vocabulary tweaks)
- Property valuation (AVM)
- Native e-sign for purchase + sale contracts
- `/finance` — could cover rehab loan tracking with extension

**Net-new (significant):**
- After-repair value (ARV) calculation distinct from current AVM
- Rehab budget builder with line-item tracking (materials, labor, permits)
- Contractor management (1099 contractors, schedules, payments)
- Bid management (multiple contractor bids per scope)
- Construction-draw schedule integration with rehab loan
- Project management (Gantt-ish view of rehab timeline)
- Receipts/photos upload per line item
- Final-sale dispo workflow with MLS integration

**Why fifth**: the rehab-execution layer is genuinely absent. Building it is real product work, not vocabulary swaps.

### 6. Buy-and-Hold Landlords — **20% built** · L effort

Long-term rentals. Tenant management, rent rolls, maintenance.
Workflow shifts from acquisition-driven to operations-driven.

**Already supported:**
- Acquisition pipeline (lead → property)
- Property valuation
- `/finance` — could cover rental P&L with major extension

**Net-new (very significant):**
- Tenant CRM (renters as a separate entity; current Lead model is acquisition-side)
- Lease management + e-sign of leases
- Rent collection (Stripe integration for ACH, check-tracking)
- Late-rent dunning (existing dunning is for note borrowers, similar pattern)
- Maintenance request portal
- Vendor / repair tracking
- Tenant screening (background, credit, income)
- Section 8 / housing-voucher workflow
- Per-property rent roll / occupancy / NOI / cap rate

**Why sixth**: largest infrastructure delta. Almost a separate product. Probably out of scope for AcreOS-as-currently-positioned.

### 7. Real Estate Agents (Brokerage) — **15% built** · XL effort

MLS-driven, commission-based, buyer-and-seller-rep workflow. Very
different from investor workflow.

**Net-new:**
- MLS integration (RETS/RESO feed)
- Commission tracking (split with broker, refer fees)
- CMA (comparative market analysis) tooling
- Showings calendar
- Open-house management
- Buyer-broker agreements
- Per-MLS compliance (each MLS has its own rules)

**Why last**: this is essentially "compete with Compass / Lofty / Sierra," a different product category. Recommend against unless founder explicitly wants to enter brokerage software.

---

## Architecture for multi-persona platform

To support more than one persona without forking the codebase, the
architecture needs three primitives:

### Primitive 1 — Persona setting

Single field on `users.appearance_preferences` (or its own column):
`persona: "land_investor" | "note_investor" | "tax_delinquent" | "wholesaler" | "subdivider" | "fix_flipper" | "landlord"`

User picks at signup; affects:
- Default onboarding path (the 3-path picker in onboarding-v2 expands)
- Default sidebar nav structure (some surfaces appear, others don't)
- Default vocabulary substitutions

Stored alongside other user prefs; switchable from Settings (low-friction
because we'd want users to try multiple modes before committing).

### Primitive 2 — Vocabulary adapter

A typed lookup function: `t(key, persona)` returns persona-specific copy
for shared concepts. Like i18n but personalized.

```ts
// Example
t("entity.lead", "wholesaler") → "Motivated seller"
t("entity.lead", "note_investor") → "Note seller"
t("entity.lead", "land_investor") → "Lead"

t("entity.property", "note_investor") → "Note"
t("entity.property", "subdivider") → "Parent parcel"

t("pipeline.stage.closed", "wholesaler") → "Assigned"
t("pipeline.stage.closed", "land_investor") → "Closed"
```

Implementation: a single `personaVocabulary.ts` registry + `useTerm(key)`
hook reading from `useAuth().user.persona`. Gradual rollout — pages
opt-in to using the hook.

### Primitive 3 — Persona-gated routes / surfaces

Extend the existing `FlaggedRoute` pattern in App.tsx to support persona
filtering:

```tsx
<PersonaRoute personas={["wholesaler", "land_investor"]} component={Marketplace} />
```

Routes gated by persona return `<NotFound />` (or redirect to
`/explore-feature`) for users whose persona doesn't fit. Same approach
as feature flags but on the persona axis.

---

## Recommended sequence

If the goal is "make AcreOS the operating system for *every* small-scale
real estate investor" rather than just Land Investors, the right order
is:

**Quarter 1 (lowest risk, highest win-rate):**
1. Add the three primitives (persona setting, vocabulary adapter, persona-gated routes) — 1–2 weeks
2. Note Investors (70% built — fill gaps + vocabulary) — 2 weeks
3. Tax-Delinquent specialists (60% built — fill auction-calendar + state-rules gaps) — 3 weeks

**Quarter 2 (medium risk, real product additions):**
4. Wholesalers (assignment contracts + cash buyer's list) — 3–4 weeks
5. Subdividers (subdivision tooling + permit workflow) — 4 weeks

**Quarter 3+ (large product additions, evaluate based on Q1–Q2 traction):**
6. Fix-and-Flippers (rehab budget + contractor management) — 6–8 weeks
7. Buy-and-Hold (tenant + rent management) — 8–12 weeks

**Skip unless the strategy explicitly shifts:**
- Real Estate Agents (Brokerage) — different product category

---

## What not to do

**Don't build a "real estate agent CRM."** That market is crowded,
margins are squeezed, and the workflow has nothing to do with what
AcreOS is good at (autonomous operation, motivated-seller mining,
seller-financed-note management). Stay in *investor*-side tooling.

**Don't bolt persona-specific surfaces onto the current UI without the
persona adapter primitives first.** It will feel inconsistent and you'll
end up with a Land-Investor-shaped UI everywhere with persona logic
sprinkled inconsistently — exactly the opposite of "rock solid."

**Don't expand horizontally before the activation arc for current
Land Investors is rock-solid.** The polish work shipped in this run
+ the deferred items (founder-dashboard rebuild, onboarding-v2
redesign, sidebar restructure) should land before the persona
expansion starts. Otherwise each new persona inherits a not-quite-finished
foundation.

---

## What this commit *did* ship vs. what it *plans*

This document is plan only — no vertical-expansion code is shipped.
The autonomous refinement run focused on Wave 1 + Wave 2 + Wave 3 polish
that lifts every persona-future work begins on (the chrome, copy,
mobile, persona-architecture pieces).

If founder authorizes Quarter 1 sequence, the next concrete commits
would be:

1. `users.persona` column + migration
2. `personaVocabulary.ts` registry + `useTerm` hook
3. `<PersonaRoute>` wrapper in App.tsx
4. Settings UI for persona switch
5. Note-investor vocabulary pass on /finance, /portfolio, /dunning, /capital-markets
6. Note-acquisition pipeline (the genuine gap for note investors)

Each is a focused commit with type-check + curl/screenshot verification,
matching the discipline established this run.
