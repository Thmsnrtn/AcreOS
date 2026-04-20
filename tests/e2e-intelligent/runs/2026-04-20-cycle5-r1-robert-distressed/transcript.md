# Cycle 5 r1 — Robert Maple × Distressed Parcel

- **Run ID**: 2026-04-20-cycle5-r1-robert-distressed
- **Persona**: 03-portfolio-buy-and-hold (Robert Maple, 58, Ocala FL, 12 yrs, 32 parcels, Pebble user)
- **Journey**: 03-analyze-distressed-parcel
- **Date**: 2026-04-20 post-deploy
- **Viewport**: 1440 × 900

## Persona summary (Robert)

Keeps a leather-bound ledger + spreadsheet. 32 parcels across FL, GA, NC. Wants records, documents-attach, no flashy animations, no beta warnings. Medium tech comfort, high patience. Abandons if the app feels like it's designed for flippers rather than holders.

## Journey objective

Deep-dive a tax-delinquent parcel: verify distress fields render, review DD checklist, confirm risk assessment acknowledges distress.

---

## Steps

### Step 1 — Sign in + first impression on /today

- Dashboard loaded in ~9s. 6 console errors (down from 10+ in cycle 3).
- Portfolio Overview shows "Properties: 2 · 2 prospect" (cycle-4 UX-001 fix verified).
- Low-credit-balance banner absent for this fresh-org state (cycle-4 fix verified).
- **Robert**: _"Okay. Page doesn't scream for my attention. Portfolio widget is accurate. Good."_

### Step 2 — /properties → Cochise (distressed) detail dialog

- Navigated to /properties (2 cards rendered — Yavapai $45K, Cochise $—).
- Cochise card now shows "—" instead of "$0" (cycle-4 fix).
- Clicked Due Diligence (view details) button on Cochise.
- Dialog opened. Title: "Cochise, AZ". Tabs: Overview / Intelligence / Comparables / AI Offer / Due Diligence.

### Step 3 — **Distress Indicators section renders** (NEW)

- Overview tab now includes a dedicated "Distress Indicators" section:
  - Tax Status: **Delinquent (4 years)**
  - Tax Principal: $2,400.00
  - Penalty: $480.00
  - Accrued Interest: $320.00
  - Total Payoff: $3,200.00
  - Source: Cochise County Treasurer, 2026-04 (19d ago)
- This is exactly the structured distress data that r7 Ingrid (cycle 3) said was missing. **WF-R7-001 fix verified live.**
- **Robert**: _"Finally. The tax delinquency details are in structured fields with a source and date. $3,200 payoff, 4 years delinquent — that's the holder-side info I need to decide whether to add this to my portfolio or pass. Four years delinquent plus an out-of-state owner is a motivated seller signal, but the payoff eats the margin on a $0 market value parcel."_

### Step 4 — Copy JSON button

- New Copy JSON button in dialog header (cycle-4 fix). For Robert who prefers records over live UI, this lets him export the parcel record to his spreadsheet.
- **Robert**: _"Copy JSON. Finally a tool that remembers people like me archive everything locally."_

### Step 5 — Decision

- Research Summary still shows "0% Complete (F)" since market value is $0. Quick Verdict would be "Insufficient Data."
- **Robert's decision**: PASS for now — he needs market-value comps before paying off $3,200 in back taxes on a parcel whose FMV is unknown. Would pursue only after verifying legal access and FMV > $15K.

## Verdict

- **Outcome**: **COMPLETED_SATISFIED** (first such verdict in three cycles)
- **Satisfaction**: 4/5
- **Would Recommend**: yes
- **Reasoning**: All three distress-journey success criteria are met (distress fields visible with source/date, DD checklist accessible, no silent failures). The product's "distressed parcel" story is credible for a buy-and-hold persona. One star off for the unresolved FMV gap — the parcel at $0 market value still requires external comps to complete the decision.

## Top issues

- Market value on the distressed parcel is $0, not a "Needs lookup" state — that empty-data ambiguity remains (flagged as candidate for future enrichment).
- The distress section doesn't yet link to the county treasurer's online portal. Nice-to-have, not blocking.
