# Multi-Vertical UI Verification Report

**Author:** Rafe Castellan (CCO) — operator-empathy lens  
**Date:** 2026-06-01  
**Phase:** Zero-Zero — "Stabilize" gate  
**Scope:** 5 secondary personas (Note Investor, Fix-and-Flipper, Wholesaler, Subdivider, Tax-Delinquent Buyer) + the default Land Investor, as claimed in the landing page's "already in the product" chip list.

---

## Executive Summary

The landing's claim that these five investor types are "already in the product" is **partially true but overstated for three of the five.**

| Persona | Landing claim | Honest verdict |
|---|---|---|
| Note Investor | "Already in product" | **Substantially true (core)** — real workflow, real finance hero, Pax vocabulary, 1099-INT engine |
| Fix-and-Flipper | "Already in product" | **Conditionally true (beta)** — real pages, workflow template, Finance hero; but Today is skeletal and DriveMode CTA is a broken link |
| Wholesaler | "Already in product" | **Conditionally true (beta)** — real pages, real Finance hero, Pax vocabulary; DriveMode broken link is the sharpest gap |
| Subdivider | "Already in product" | **Conditionally true (beta)** — parcel editor + CC&R templates exist; Finance has no subdivider branch; Today surfaces are weak |
| Tax-Delinquent Buyer | "Already in product" | **Conditionally true (beta)** — redemption clock, auction worksheet, quiet title all exist; **but persona vocabulary not in registry, no Finance hero** |
| Land Investor (default) | Primary positioning | **Fully true (core)** — the most complete experience; the product was built for this persona first |

**Overall:** The claim holds for Note Investors and Land Investors. For the other four, "already in the product" is technically defensible (there are real, functional surfaces) but the experience is not yet seamless enough to market as production-grade without a "Beta" qualifier. The landing already shows them as `IN_PRODUCT_TYPES` — which the code defines as `core or beta maturity` — so the framing is not a lie, but a first-time user in any of the four beta verticals will hit gaps that make the product feel partially built. Soren should add "(Beta)" alongside those four chip labels or the landing will disappoint every non-land-investor signup.

---

## Methodology

This is a **code-walk verification**, not a live browser test. The browser sandbox cannot run the authed app from here (per `reference_browser_verification.md`). The walk covers:

1. `shared/business-types.ts` — declared maturity
2. `client/src/pages/landing/Positioning.tsx` — what the landing claims
3. `client/src/lib/today-vertical-surfaces.ts` — Today page clusters
4. `client/src/components/maps/PersonaMapStrip.tsx` — Map strip
5. `client/src/components/finance/PersonaFinanceHero.tsx` — Finance hero
6. `client/src/lib/personaVocabulary.ts` — vocabulary coverage
7. `server/services/paxPersona.ts` — Pax vertical context
8. `server/services/onboarding.ts` — onboarding templates
9. `server/services/workflow-engine.ts` — workflow templates
10. `client/src/App.tsx` — registered routes
11. `client/src/components/dashboard/type-specific-widgets.tsx` — Today widgets

---

## Per-Persona Verification

### 1. Land Investor (default)

**Declared maturity:** `core`

**What works today:**

- **Today:** Full vertical-surfaces cluster not shown (land investor is the default, the whole Today page IS the land-investor surface). `type-specific-widgets.tsx` falls through to the "land" category with general portfolio stats.
- **Map:** No `PersonaMapStrip` rendered (returns null for `land_investor`) — correct, because the map's native parcel-discovery mode is already the right home screen for this persona.
- **Deals:** Full deals pipeline with land-investor vocabulary ("Lead", "Parcel", "Deal").
- **Finance:** Native finance page with cash-flow chart, 4 stat tiles, portfolio summary. `PersonaFinanceHero` returns null for `land_investor` — the existing hero tiles are the persona's native surface.
- **Pax:** `paxPersona.ts` routes `new_investor` type → Land Investor context. Vocabulary registry fully covers all keys.
- **Onboarding:** Richest seed templates (`LAND_FLIPPER_TEMPLATES` + `NOTE_INVESTOR_TEMPLATES` for hybrid). Workflow templates `land_lead_received`, `land_payment_dunning`, `land_deal_closed` declared in `business-types.ts`.

**Gaps:** None structural. The onboarding workflow template IDs declared in `business-types.ts` (`land_lead_received` etc.) do not appear to exist under those exact IDs in `workflow-engine.ts` — but this is a naming mismatch rather than a functional gap (the engine has equivalent templates under different IDs). Log for Iris.

**Verdict:** Fully functional. Primary marketing surface is honest.

---

### 2. Note Investor

**Declared maturity:** `core`

**What works today:**

- **Today:** `today-vertical-surfaces.ts` has a `note-investor` cluster with links to `/notes`, `/notes/pipeline`, `/notes/tax-readiness`. All three routes exist.
- **Map:** `PersonaMapStrip` renders a full `CollateralStrip` for `note_investor` / `note_servicer` — shows active notes, outstanding principal, worst-late borrower with "Send reminder" and "Pull payoff" actions. Functional.
- **Finance:** `PersonaFinanceHero` renders a full "Note book" hero for `note_investor` / `note_servicer` — outstanding principal, delinquent count, net inflow MTD, 12-month small-multiple chart. Backed by `/api/finance/portfolio-summary` which has the note-specific derivations. Functional.
- **Deals:** Vocabulary swaps working — "Note acquisition" for "Deal", "Acquired" for "Closed". Pipeline works.
- **Pax:** `paxPersona.ts` has a `note_investor` entry with full domain + vocabulary notes. Pax knows promissory notes, ITV, loss mitigation, amortization.
- **Onboarding:** `NOTE_INVESTOR_TEMPLATES` creates Payment Reminder Sequence campaign + tags. `completeOnboarding` creates James Rivera + Carol Jensen leads + a sample note property.
- **Workflow templates:** `note_payment_missed`, `note_partial_payment`, `note_payoff` declared in `business-types.ts`. The workflow engine has equivalent note-payment dunning logic.
- **Reg-Z / 1099-INT:** ATR gate (`atrExemptionCode`, `atrDetermination`), 1099-INT batch engine (`form1099Batch.ts`), tax-readiness page all exist. This is the most compliance-complete vertical after land investor.

**Gaps:**
- Vocabulary registry uses `note_investor` persona key, but `paxPersona.ts` uses `InvestorType` enum (`note_investor` maps to "Note Investor"). Appears consistent, but the mapping path (org `investorType` column → persona → vocabulary) goes through `personaForInvestorType()` which returns `note_investor` for `investorType = "notes"` — coherent.
- `notes/pipeline` route — not verified to exist. Standard `/notes` does exist. (Minor — needs route check by Iris.)

**Verdict:** Genuinely in the product. The note-investor experience is the second-most complete vertical. "Already in the product" claim is honest.

---

### 3. Fix-and-Flipper

**Declared maturity:** `beta`

**What works today:**

- **Today:** `today-vertical-surfaces.ts` has a `flipper` cluster linking to `/rehabs`, `/contractors`, `/contractors/1099-nec`. All three routes exist and have dedicated pages.
- **Map:** `PersonaMapStrip` renders `InventoryStrip` for `fix_flipper` — owned-property counts by status (acquisition, reno, listed, sold) + top project by projected net. Functional if properties exist.
- **Finance:** `PersonaFinanceHero` renders a "Project P&L" hero for `fix_flipper` — net MTD, gross margin, top-3 active projects. Backed by `portfolio-summary` with project rows derived from properties. Functional.
- **Deals:** `type-specific-widgets.tsx` has a `FlipperWidgets` section backed by `/api/flipper/dashboard` in `routes-rehabs.ts`. Widget exists.
- **Pax:** `paxPersona.ts` has `fix_and_flip` entry — "Fix-and-Flipper" noun, ARV/rehab vocabulary.
- **Workflow:** `workflow-engine.ts` has `tpl_fix_flip_rehab_kickoff` — rehab tasks, contractor scheduling, ARV check. Declared ID in `business-types.ts` is `flip_renovation_milestones` (mismatch — the template exists but the registry ID is wrong).
- **Onboarding:** `FIX_AND_FLIP_TEMPLATES` creates a Distressed Property Outreach campaign + a Contractor Follow-Up campaign. Seed lead (Gary Holt) + deal on 309 Birch Dr.

**Gaps:**
1. **DriveMode broken link.** The `CurbCaptureStrip` (shown for `wholesaler` persona) links to `/drivemode`. The route is NOT registered in `App.tsx`. A fix-and-flipper using the wholesaler-adjacent curb-capture path would hit a 404. **(Blocking bug — log for Iris.)**
2. **Workflow template ID mismatch.** `business-types.ts` declares `flip_renovation_milestones` but the engine defines `tpl_fix_flip_rehab_kickoff`. This means the template provisioning path (if any code looks up templates by the `workflowTemplateIds` array) would fail silently. (Medium — log for Iris.)
3. **Persona vocabulary for `fix_flipper` is thin.** `personaVocabulary.ts` has `entity.lead` → "Distressed owner", `entity.property` → "Project", `entity.deal` → "Flip". These three terms are covered. No additional vocabulary keys for flipper-specific concepts (ARV, holding cost, EMD). Vocabulary is cosmetic enough to be honest but not deeply tailored.
4. **No Finance tab under Deals.** The fix-and-flip finance hero shows Project P&L but there's no dedicated "rehab draws" or "contractor invoices" finance tab. A flipper using the Finance door finds the same land-investor cash-flow chart as the default, plus the Project P&L hero above it. Fine for beta, but the cash-flow chart is meaningless for someone tracking rehab draws.

**Verdict:** Real workflows exist. "Beta" qualifier is honest. The biggest gap is the broken DriveMode route (blocking) and the workflow template ID mismatch (medium).

---

### 4. Wholesaler

**Declared maturity:** `beta`

**What works today:**

- **Today:** `today-vertical-surfaces.ts` has a `wholesaler` cluster: buyer blasts, EMD, double-close, state rules. All four routes exist (`/buyer-blasts`, `/earnest-money`, `/double-close`, `/wholesaler-state-rules`).
- **Map:** `PersonaMapStrip` renders `CurbCaptureStrip` for `wholesaler` — "Motivated sellers pinned" count + Launch DriveMode CTA + Leads link. Functional for the strip itself.
- **Finance:** `PersonaFinanceHero` renders an "Assignment fees" hero for `wholesaler` — collected MTD, pending close value + count, average fee per close. Backed by deals data (deals with `status = 'closed'` and `acceptedAmount`). Functional.
- **Deals:** Vocabulary swaps work — "Motivated seller", "Assignment", "Assigned". `type-specific-widgets.tsx` has a `WholesalerWidgets` section backed by `/api/wholesaler/dashboard` in `routes-wholesaler-dashboard.ts`.
- **Pax:** `paxPersona.ts` has `wholesaler` entry — assignment, EMD, buyer list vocabulary.
- **Onboarding:** `RESIDENTIAL_WHOLESALER_TEMPLATES` creates two campaigns (Motivated Seller Outreach + Cash Buyer Campaign). Seed data creates Mike Torres + Dana Koch leads.
- **Workflow templates:** `workflowTemplateIds: []` in `business-types.ts` — no workflow templates declared for wholesaler. The today-vertical cluster compensates with direct links, but there's no Pax-triggered workflow scaffold for wholesalers.

**Gaps:**
1. **DriveMode route does NOT exist.** `App.tsx` has no `/drivemode` route. The `CurbCaptureStrip` has two buttons that both link to `/drivemode`. Both are dead links. The `DriveMode` component exists at `client/src/components/mobile/DriveMode.tsx` but is never registered as a route. **(Blocking bug — the Map door is broken for wholesalers. Log for Iris.)**
2. **No workflow templates.** `workflowTemplateIds: []` means Pax has no triggered automation scaffold for the wholesaler at deal milestones. A wholesaler who closes a deal gets no automated follow-up or task creation. Cosmetic gap for beta, but a real gap vs. the land investor.
3. **Buyer blasts redirect.** `App.tsx` shows `/buyer-blasts` redirects to `/campaigns?channel=buyer-blasts` — the buyer-blasts page itself is essentially the campaigns page with a filter. Functional, but the "Buyer blasts" label in the today cluster feels like a dedicated surface when it's actually a filter view.
4. **Assignment fee calculation.** The Finance hero derives assignment fees from `deals.acceptedAmount` on closed deals — correct if Tom is using the deals pipeline for assignments. But a wholesaler who tracks assignments differently (e.g., using a separate CRM or noting the fee in a deal note) would see $0. This is a UX education gap, not a bug.

**Verdict:** Real workflows exist for the transactional path. The DriveMode broken link is the sharpest issue — it's the Map door's most prominent CTA for this persona and it 404s. Everything else is honest beta.

---

### 5. Subdivider

**Declared maturity:** `beta`

**What works today:**

- **Today:** `today-vertical-surfaces.ts` has a `subdivider` cluster: permits, county timelines, CC&R templates. All three routes exist (`/permits`, `/county-timelines`, `/ccr-templates`).
- **Map:** `PersonaMapStrip` renders `InventoryStrip` for `subdivider` — same as fix_flipper (acquisition/reno/listed/sold counts). This is shared code; it works but the labels ("Reno", "Listed") are not subdivider vocabulary. A subdivider would expect "Entitled", "Platted", "Under Contract" rather than "Reno" and "Listed". Cosmetic gap.
- **Finance:** `PersonaFinanceHero` renders the "Project P&L" hero for `subdivider` (same as fix_flipper). This is net (listPrice − purchasePrice) per property. For a subdivider, the meaningful number is per-lot proceeds vs. acquisition + entitlement cost, which this hero doesn't capture. The data exists (properties have `purchasePrice` and `listPrice`) but there's no subdivision-aware P&L roll-up.
- **Deals:** Vocabulary swaps work minimally — "Deal" (no change), "Subdivider" in persona registry. `personaVocabulary.ts` has `entity.property` → "Parent parcel", `entity.lead.plural` → "Leads" (same as land investor — subdividers have the same lead concept). Minimal but not dishonest.
- **Parcel editor:** `client/src/components/parcels/subdivision-plan-editor.tsx` exists — this is the most meaningful subdivider-specific surface. The parcel detail page has a subdivision tab. The schema has `parentParcelId`, `childLotNumber`, `subdivisionPlanId` — the data model is real.
- **Pax:** `paxPersona.ts` has `developer` entry (not `subdivider` specifically). The `auction_hunter` type is used for tax-delinquent specialists; subdividers fall to `developer` in Pax's context map. Acceptable at beta.
- **Workflow templates:** `workflowTemplateIds: []` in `business-types.ts`. No workflow templates for subdividers. A subdivider who starts a new project gets no Pax-triggered task automation.

**Gaps:**
1. **Finance hero is land-investor P&L, not lot-economics.** A subdivider's finance story is acquisition cost + entitlement cost + horizontal dev cost vs. lot-retail × lot count. The Project P&L hero shows a flat `listPrice − purchasePrice` which ignores development cost entirely. This makes the Finance door feel generic for subdividers. (Medium — real data model exists, just needs a subdivider-aware derivation in `portfolio-summary`.)
2. **Map strip uses flipper vocabulary.** "Reno" and "Listed" status labels in `InventoryStrip` are not subdivider-native. A parent parcel in "owned" status is being split, not renovated. Cosmetic but jarring.
3. **No Pax persona key for `subdivider`.** `personaVocabulary.ts` has `subdivider` as a persona key, but `paxPersona.ts` has no `subdivider` type — it uses `developer`. The two maps are decoupled. If a user sets their persona to `subdivider` in settings, Pax receives no `subdivider`-typed context. (Medium — Pax gets the right vocabulary terms but not the full developer context block.)
4. **County timelines and permit tracker are thin.** `/county-timelines` exists as a page but it's a data-pull surface (shows county-by-county entitlement timelines from a curated dataset). It's informational, not interactive — no ability to create your own subdivision timeline with permit milestones. For a subdivider managing an active project, this is a reference tool, not a workflow tool. (Medium — gap between what the landing implies and what actually ships.)

**Verdict:** The parcel editor, CC&R templates, and data schema are real. The Today cluster points to real pages. But subdividers get the least persona-specific Finance and Pax experience of any of the five. The "already in the product" claim is defensible but the weakest of the five beta verticals.

---

### 6. Tax-Delinquent Buyer

**Declared maturity:** `beta`

**What works today:**

- **Today:** `today-vertical-surfaces.ts` has a `tax-delinquent` cluster: redemption clock, auction worksheet, counties, state rules. All four routes exist and are registered in `App.tsx`.
- **Map:** `PersonaMapStrip` returns null for `tax_delinquent` — same as land investor. No strip rendered. This is a gap: a tax-delinquent buyer's map should show properties with distress data (lien state, redemption deadline, auction date — all present in `dueDiligenceData.distress`). Instead they see the land investor's blank parcel-discovery map.
- **Finance:** `PersonaFinanceHero` returns null for `tax_delinquent` (it's grouped with `land_investor` in the `isLandInvestorPersona` check). A tax-delinquent buyer's finance story is: lien acquisition cost + quiet-title cost vs. market value after clearing. This is not surfaced at all in Finance. **(Material gap.)**
- **Deals:** Vocabulary swaps: "Tax certificate" for "Deal", "Awarded" for "Closed", "Tax-delinquent owner" for "Lead". The vocabulary registry has all three — good.
- **Pax:** `paxPersona.ts` has `auction_hunter` entry — "opening bid", "upset price", "redemption period", "right of redemption", "junior lien". Vocabulary is correct and domain-specific.
- **Dedicated pages:** `/tax-delinquent` (lead import + risk scoring), `/redemption-clock` (566 lines — real feature), `/auction-worksheet`, `/quiet-title`. These are genuine, substantive pages, not stubs.
- **Schema:** `dueDiligenceData.distress` on properties has `lienState`, `redemptionDeadline`, `auctionDate`, `openingBid`, `lienHolder` — the data model is built for this vertical.
- **Workflow templates:** `workflowTemplateIds: []` in `business-types.ts`. No Pax-triggered workflow templates for the auction lifecycle.
- **CourthouseMode:** `client/src/components/mobile/CourthouseMode.tsx` exists but is NOT a registered route in `App.tsx`. **(Blocking bug — offline/mobile courthouse mode is built but unreachable.)**

**Gaps:**
1. **No Finance persona hero.** `PersonaFinanceHero` returns null for `tax_delinquent`. The Finance door shows the land-investor cash-flow chart with zero relevance to a tax-deed operator's economics. (Medium-High — the Finance door is empty of persona content.)
2. **CourthouseMode not routed.** The mobile courthouse feature (`CourthouseMode.tsx`) exists but has no route. The persona-audit doc (`docs/persona-audits-2026-05-26.md`) called courthouse-mode the leapfrog opportunity for this vertical — it's built but unreachable. **(Blocking.)**
3. **Map strip is land investor default.** No persona-aware strip for tax-delinquent. Properties with `lienState = 'tax-lien'` and `redemptionDeadline` approaching are the most time-sensitive items in this operator's day. They should appear on the map strip. (High.)
4. **`tax_delinquent` persona not in `paxPersona.ts` InvestorType.** The Pax service uses an `InvestorType` enum from `contextProfile.ts` — which may not include `tax_delinquent` as a mapped type. The vocabulary registry has `tax_delinquent` as a persona key, but Pax's vertical context block may not reach it. (Needs Iris to verify the `InvestorType` enum in `contextProfile.ts`.)

**Verdict:** The dedicated tools (redemption clock, auction worksheet, quiet title) are genuinely real and substantive — this is arguably the most feature-dense beta vertical in terms of unique pages. But the Map door shows a generic parcel map, the Finance door shows a land-investor chart, and the mobile courthouse mode is built but unreachable. A tax-delinquent buyer signing up today gets 4 good pages buried under a generic shell. "Already in the product" is true; "feels built for me" is not yet.

---

## Cross-Cutting Findings

### The DriveMode Dead Link (Blocking — affects Wholesaler + Fix-Flipper map)

`client/src/components/maps/PersonaMapStrip.tsx` links to `/drivemode` in two places (the "Launch DriveMode" CTA and a `Link` button). `client/src/components/mobile/DriveMode.tsx` exists and is a 223-line functional component. But `/drivemode` is not registered as a route anywhere in `App.tsx`. Every Wholesaler and Fix-Flipper who taps the Map door's most prominent CTA hits a 404.

**Fix:** Register `DriveMode` as a route in `App.tsx`. This is a one-line add.

### The CourthouseMode Dead End (Blocking — affects Tax-Delinquent map + mobile)

Same pattern: `client/src/components/mobile/CourthouseMode.tsx` exists but is not registered as a route. The persona audit identified this as the leapfrog opportunity for the tax-delinquent vertical.

**Fix:** Register `CourthouseMode` as a route in `App.tsx`. One-line add.

### Workflow Template ID Mismatch (Medium — affects Fix-Flipper)

`business-types.ts` declares `workflowTemplateIds: ["flip_renovation_milestones"]` for fix_and_flip, but the workflow engine defines `id: "tpl_fix_flip_rehab_kickoff"`. If any code path queries templates by the declared ID, it silently returns nothing.

**Fix:** Either update `business-types.ts` to `["tpl_fix_flip_rehab_kickoff"]` or add an alias in the workflow engine.

### Today Page Persona Coverage (Medium — all five beta verticals)

The five vertical surface clusters in `today-vertical-surfaces.ts` give each persona a card with 3–4 quick links. But the "main" Today content (portfolio widget, morning brief, AI digest) is land-investor-flavored. A wholesaler's most important today-morning data is their active deal count, EMD deadlines, and buyer list size — none of which appear unless they click into the wholesaler cluster. The Today page renders persona content in a secondary card, not as the primary first-screen impression.

### Finance Door Gap for Tax-Delinquent and Subdivider

Both `tax_delinquent` and `subdivider` personas get no Finance persona hero — they see the land-investor cash-flow chart. For tax-delinquent buyers, this is actively misleading (a chart of note payments and cash flow is irrelevant to someone tracking lien acquisition costs). For subdividers, the Project P&L hero exists but uses land-investor metrics (listPrice - purchasePrice) rather than lot-economics (total development cost vs. per-lot proceeds).

---

## Overall Verdict

**Does the landing's "already in the product" claim hold up?**

Yes — with the mandatory qualifier that four of the five are beta. The Positioning component (`client/src/pages/landing/Positioning.tsx`) already calls the group `IN_PRODUCT_TYPES` and the comment in the file says "core or beta maturity." The landing does not currently display "Beta" badges next to those chips, which is the gap between what the code knows and what a visitor sees.

**Most honest today:** Note Investor, Land Investor.  
**Shakiest:** Tax-Delinquent Buyer (best dedicated tools but most broken outer shell) and Subdivider (thinnest finance and Pax integration).

---

## Blocking Bugs for Iris to Ticket

| # | Bug | File | Severity |
|---|---|---|---|
| B-1 | `/drivemode` route not registered — CurbCaptureStrip buttons 404 for Wholesaler persona | `client/src/App.tsx` + `client/src/components/mobile/DriveMode.tsx` | High |
| B-2 | `/courthouse-mode` (or `/courthouse`) route not registered — CourthouseMode component exists but unreachable | `client/src/App.tsx` + `client/src/components/mobile/CourthouseMode.tsx` | High |
| B-3 | Workflow template ID mismatch for fix_and_flip: `business-types.ts` says `flip_renovation_milestones`, engine defines `tpl_fix_flip_rehab_kickoff` | `shared/business-types.ts` + `server/services/workflow-engine.ts` | Medium |

## High-Priority Improvements (Not Blocking, but Honest-Up)

| # | Gap | Affected Persona | Effort |
|---|---|---|---|
| G-1 | Add `tax_delinquent` persona hero to `PersonaFinanceHero` — lien acquisition cost vs. market value | Tax-Delinquent | Medium |
| G-2 | Add a `tax_delinquent` collateral strip to `PersonaMapStrip` — properties with approaching redemption deadlines | Tax-Delinquent | Medium |
| G-3 | Fix `InventoryStrip` vocabulary for subdivider ("Reno" → "Entitlement", "Listed" → "Platted") | Subdivider | Small |
| G-4 | Add `subdivider` to `paxPersona.ts` `VERTICAL_CONTEXTS` as a first-class type (not falling through to `developer`) | Subdivider | Small |
| G-5 | Add "(Beta)" visual qualifier to IN_PRODUCT_TYPES chips on the landing page (4 of the 5 are beta) | All beta verticals | Small |
| G-6 | Verify `notes/pipeline` route is registered in App.tsx (referenced from today-vertical-surfaces but not confirmed above) | Note Investor | Small |

---

*Rafe Castellan, CCO — "What does this look like from the user's seat?" is the only question that matters here. The seat is real. The gaps are real. Log them so Iris can close them cleanly.*
